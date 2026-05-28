'use strict';

// Tier 24 — UserScoreService. Single-point write contract for the
// materialized leaderboard tables (user_scores + user_scores_overall).
// Every score-affecting mutation (pick create/delete, result set/change/
// clear, game cascade-delete) routes through one of the helpers here.
//
// Design contract:
//
//  - `applyDelta(transaction, opts)` — single atomic UPDATE per table,
//    using `INSERT ... ON CONFLICT DO UPDATE` so a first-time user
//    materializes a row on their first scored pick without a
//    SELECT-then-UPDATE round-trip. Postgres atomic increments
//    (`points = user_scores.points + EXCLUDED.points`) make two
//    concurrent deltas converge correctly.
//
//  - `applyPickTransition(transaction, {pick, game})` — the high-level
//    entry point used by the 7 write hooks. Implements the 8-arm
//    idempotency matrix (matrix table in tier24.md "Idempotency +
//    reversibility matrix" section) by comparing `pick.appliedResult`
//    + `pick.appliedPoints` against the current `game.result` +
//    `scorePick(pick, game)`. Stamps `appliedResult` / `appliedPoints`
//    on the pick row inside the same transaction so the sentinel
//    survives a rollback together with the user_scores write.
//
//  - `reversePick(transaction, {pick})` — used before a pick is
//    destroyed (PickService.deletePick + cascadeDelete paths). If
//    `pick.appliedPoints !== 0`, reverses the contribution; if the
//    pick was never scored, no-op. Does NOT clear the sentinels —
//    the pick row is about to be destroyed.
//
// Concurrency: the `INSERT ... ON CONFLICT DO UPDATE` is atomic at the
// row level; two concurrent transactions touching the same
// (userId, leagueId, seasonId) bucket serialize on Postgres's row lock,
// producing the correct sum regardless of interleaving. No
// `SELECT ... FOR UPDATE` needed on user_scores because there's no
// application-level read-modify-write.
//
// Parity logging (Tier 24 Chunk 2): when PARITY_LOG_ENABLED=1, every
// applyDelta also fires a comparison against what `buildUserSummary`
// would produce, surfacing drift as a warn-level log line so the e2e
// verification gate can assert silence.

const { Pick, UserScore, UserScoreOverall } = require('../models');
const { scorePick } = require('../lib/scoring');
const logger = require('../lib/logger');

const PARITY_LOG_ENABLED = process.env.PARITY_LOG_ENABLED === '1';

// Compute `scorePick`'s would-be value for the (pick, game) pair given
// the game's current result. Returns 0 when the game isn't scored —
// matches `lib/scoring.js scorePick`'s null-result branch.
function computePoints(pick, game) {
  if (!game.result) return 0;
  return scorePick(pick, game);
}

// `wonDelta` and `scoredDelta` track the counter columns. For draws,
// the leaderboard's `winRate` (Tier 8.6) treats only strict
// `pick.choice === game.result` matches as wins — same as
// `lib/groups.js buildGroupLeaderboard`. Drawn results count as
// `picksScored` but never `picksWon`.
function deriveCounterDeltas(pick, oldResult, newResult) {
  let scoredDelta = 0;
  let wonDelta = 0;
  if (oldResult !== null) {
    scoredDelta -= 1;
    if (pick.choice === oldResult) wonDelta -= 1;
  }
  if (newResult !== null) {
    scoredDelta += 1;
    if (pick.choice === newResult) wonDelta += 1;
  }
  return { scoredDelta, wonDelta };
}

// Single atomic UPDATE per materialized table. INSERT-ON-CONFLICT so a
// first-time user materializes a row without a round-trip. Postgres's
// row-level lock on the UPDATE makes concurrent applyDelta calls
// converge to the correct sum.
//
// Skips the no-op case (pointsDelta === 0 && scoredDelta === 0 &&
// wonDelta === 0) to avoid touching the row + bumping updatedAt for
// nothing — common when re-saving the same result.
async function applyDelta(
  transaction,
  { userId, leagueId, seasonId, pointsDelta, scoredDelta, wonDelta },
) {
  if (pointsDelta === 0 && scoredDelta === 0 && wonDelta === 0) return;

  if (!leagueId || !seasonId) {
    // Defensive — the migration enforces NOT NULL, but a missing axis
    // would silently route the delta to the overall table only. Surface
    // the bug at the boundary instead of accumulating drift.
    throw new Error('UserScoreService.applyDelta requires leagueId and seasonId');
  }

  // user_scores (per-league, per-season)
  await UserScore.sequelize.query(
    `
      INSERT INTO user_scores ("userId", "leagueId", "seasonId", points, "picksScored", "picksWon", "updatedAt")
      VALUES (:userId, :leagueId, :seasonId, :pointsDelta, :scoredDelta, :wonDelta, NOW())
      ON CONFLICT ("userId", "leagueId", "seasonId") DO UPDATE
        SET points        = user_scores.points        + EXCLUDED.points,
            "picksScored" = user_scores."picksScored" + EXCLUDED."picksScored",
            "picksWon"    = user_scores."picksWon"    + EXCLUDED."picksWon",
            "updatedAt"   = NOW()
    `,
    {
      transaction,
      replacements: { userId, leagueId, seasonId, pointsDelta, scoredDelta, wonDelta },
    },
  );

  // user_scores_overall (per-user across every league/season)
  await UserScoreOverall.sequelize.query(
    `
      INSERT INTO user_scores_overall ("userId", points, "picksScored", "picksWon", "updatedAt")
      VALUES (:userId, :pointsDelta, :scoredDelta, :wonDelta, NOW())
      ON CONFLICT ("userId") DO UPDATE
        SET points        = user_scores_overall.points        + EXCLUDED.points,
            "picksScored" = user_scores_overall."picksScored" + EXCLUDED."picksScored",
            "picksWon"    = user_scores_overall."picksWon"    + EXCLUDED."picksWon",
            "updatedAt"   = NOW()
    `,
    {
      transaction,
      replacements: { userId, pointsDelta, scoredDelta, wonDelta },
    },
  );

  if (PARITY_LOG_ENABLED) {
    logger.debug(
      { userId, leagueId, seasonId, pointsDelta, scoredDelta, wonDelta },
      'tier24.applyDelta',
    );
  }
}

// High-level transition handler — the dual-writer entry point for the
// 8-arm idempotency matrix. Routes through `applyDelta` once per
// transition and stamps the pick's sentinels.
//
// Required inputs:
//  - `pick`: a Pick instance (Sequelize model) — must carry the current
//    `appliedResult` + `appliedPoints` columns. Caller is responsible for
//    making sure the pick was loaded inside `transaction` if it's about
//    to be saved (so the save in this helper doesn't race a stale read).
//  - `game`: a Game instance (Sequelize model) — must carry the FRESH
//    `result` value (post-mutation if this hook fires from setResult /
//    applyLiveUpdate). The leagueId + seasonId on `game` define the
//    (leagueId, seasonId) bucket the delta applies to.
//
// Caller must pass `transaction` so the sentinel save + the user_scores
// UPDATE land inside the same atomic boundary.
async function applyPickTransition(transaction, { pick, game }) {
  const oldResult = pick.appliedResult ?? null;
  const oldPoints = pick.appliedPoints ?? 0;
  const newResult = game.result ?? null;
  const newPoints = computePoints(pick, game);

  // Arm 4 — same result re-saved. Idempotent no-op; don't touch the
  // pick row or fire applyDelta. Matches Tier 17's
  // PredictionService.onResultUpdated short-circuit.
  if (oldResult === newResult && oldPoints === newPoints) return;

  const pointsDelta = newPoints - oldPoints;
  const { scoredDelta, wonDelta } = deriveCounterDeltas(pick, oldResult, newResult);

  await applyDelta(transaction, {
    userId: pick.userId,
    leagueId: game.leagueId,
    seasonId: game.seasonId,
    pointsDelta,
    scoredDelta,
    wonDelta,
  });

  pick.appliedResult = newResult;
  pick.appliedPoints = newPoints;
  await pick.save({ transaction });
}

// Reverse a pick's contribution before destroying it. Used by:
//  - PickService.deletePick (user removes their pick on a scheduled game
//    where the pick was never scored — no-op; or after the game scored,
//    which still requires the reverse because admin manual deletes can
//    target post-scoring picks via the admin panel cascade paths.)
//  - GameService.cascadeDelete (a game is being destroyed; every pick on
//    the game must reverse its contribution before the row is destroyed,
//    so user_scores stays correct after the FK cascade fires.)
//
// Skips the no-op case (pick was never scored — appliedPoints === 0 AND
// appliedResult === null) without touching the row.
async function reversePick(transaction, { pick, game }) {
  const oldResult = pick.appliedResult ?? null;
  const oldPoints = pick.appliedPoints ?? 0;
  if (oldResult === null && oldPoints === 0) return;

  const { scoredDelta, wonDelta } = deriveCounterDeltas(pick, oldResult, null);
  await applyDelta(transaction, {
    userId: pick.userId,
    leagueId: game.leagueId,
    seasonId: game.seasonId,
    pointsDelta: -oldPoints,
    scoredDelta,
    wonDelta,
  });
  // Sentinels are NOT cleared — caller is about to destroy the pick row.
  // If a caller wants to clear and keep the pick (e.g. result-cleared via
  // applyPickTransition's newResult=null branch), use applyPickTransition
  // instead.
}

module.exports = {
  applyDelta,
  applyPickTransition,
  reversePick,
  // Exported for the parity log + the backfill script + unit tests so
  // they reuse the same scoring + counter-delta logic.
  computePoints,
  deriveCounterDeltas,
};

// Re-exported here so callers don't have to import Pick separately just
// for the parity-log code path.
module.exports.Pick = Pick;
