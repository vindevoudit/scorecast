'use strict';

// Tier 17 — PredictionService. The reactive bridge between a captured
// match result and the probability rewrites for every upcoming fixture
// involving either team.
//
// Two-step shape (mirrors Tier 5.3 notify/badge fan-out pattern):
//
//   1. onResultCaptured(game, { transaction }) — runs INSIDE the
//      result-capture transaction. Locks both team rows with
//      SELECT ... FOR UPDATE, updates Elo via lib/ml/eloMath. If
//      the result rolls back, the Elo updates roll back too.
//      Returns { affectedTeams, leagueId } | null (null when a team
//      is missing from the teams table — graceful skip, logged warn).
//
//   2. rePredictFutureFixtures({ affectedTeams, leagueId }) — runs
//      AFTER the result transaction commits. Reads the just-committed
//      Elo from teams + writes new probabilities to every upcoming
//      fixture in the same league involving any affected team. NOT
//      transactional w.r.t. the result; a partial failure here doesn't
//      roll back the result. Caller wraps in .catch() so a model-load
//      error never breaks the result-capture flow.
//
// Graceful no-ops:
//  - missing model file (PR B → PR C handoff before training): loadModel
//    returns null → rePredictFutureFixtures logs warn + returns
//    { rewritten: 0 } without touching any rows.
//  - missing team row: onResultCaptured logs warn + returns null →
//    cascade skipped. LeagueService.upsertFixture's auto-insert closes
//    this gap going forward for newly-synced teams.

const path = require('path');
const { Op } = require('sequelize');

const { Team, Game } = require('../models');
const logger = require('../lib/logger');
const eloMath = require('../lib/ml/eloMath');
const xgboost = require('../lib/ml/xgboostInference');
const normalize = require('../lib/ml/normalize');
const { isPlaceholderTeam } = require('../lib/placeholderTeam');

// Per-league model cache. Models are loaded lazily on first access so
// boot doesn't fail when the JSON file is missing (PR B → PR C handoff)
// — instead, getModel returns null and the cascade no-ops cleanly. Once
// the trained PL_elo.json is committed and the new image rolls out, the
// cache populates on the first cascade call.
const MODEL_PATHS = {
  PL: path.join(__dirname, '..', 'lib', 'ml', 'models', 'PL_elo.json'),
  // International model — covers WC fixtures + (future) Euros/Copa via the
  // INTL meta-pool. The WC league row is the V1 host; rePredictFutureFixtures
  // also runs symmetrization for fixtures marked `neutralVenue=true` to
  // guarantee predict(A,B) === predict(B,A) on neutral pitches.
  WC: path.join(__dirname, '..', 'lib', 'ml', 'models', 'INT_elo.json'),
};
const modelCache = new Map();

function getModelForSourceLeagueCode(code) {
  if (modelCache.has(code)) return modelCache.get(code);
  const p = MODEL_PATHS[code];
  if (!p) {
    // No model defined for this league at all. Cache the null so we
    // don't re-warn on every cascade.
    modelCache.set(code, null);
    return null;
  }
  // numFeatures: 2 (homeElo, awayElo). Bumping this requires retraining
  // + updating the feature vector below in rePredictFutureFixtures.
  const model = xgboost.loadModel(p, { numFeatures: 2 });
  modelCache.set(code, model);
  return model;
}

// Reset the per-league cache. Mostly useful for tests that drop a model
// file in and out at runtime. Production code path doesn't call this.
function _resetModelCache() {
  modelCache.clear();
}

// Tier 17 PR F — idempotent + reversible Elo update for a captured result.
// Runs INSIDE the caller's transaction; returns { affectedTeams, leagueId }
// when the cascade should re-predict downstream fixtures, or null when the
// call was a no-op (idempotent re-capture, missing team row, etc.).
//
// Behavior matrix (game.appliedResult is the value previously Elo-applied;
// game.result is the new value the caller just wrote):
//   - result === appliedResult  → no-op (idempotent; re-saving the same
//                                  result must NOT shift Elo again)
//   - appliedResult === null
//     and result !== null       → first capture. Snapshot current team Elo
//                                  onto game.homeEloPre + awayEloPre,
//                                  apply delta, stamp appliedResult
//   - appliedResult !== null
//     and result !== null       → change. Reverse prior delta against the
//                                  stored snapshot, apply new delta
//                                  against the SAME snapshot, update
//                                  appliedResult
//   - appliedResult !== null
//     and result === null       → clear. Reverse prior delta against the
//                                  snapshot, drop snapshot + appliedResult
//
// Snapshot is immutable for the life of the game once first stored — it
// represents pre-match strength, not post-revision strength, so reverse
// then re-apply always uses the same reference Elo pair regardless of
// what other games have shifted the team's live Elo in between. Net
// gamesPlayed change across reverse + reapply is 0 in the change case.
async function onResultUpdated(game, { transaction }) {
  if (!game || !game.leagueId) {
    return null;
  }
  const previous = game.appliedResult ?? null;
  const next = game.result ?? null;

  // Idempotent: same result re-captured. Nothing to do (no Elo shift, no
  // downstream cascade — probabilities already reflect this game's
  // contribution to the teams' Elo).
  if (previous === next) return null;

  const homeTeam = await Team.findOne({
    where: { name: game.homeTeam, leagueId: game.leagueId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const awayTeam = await Team.findOne({
    where: { name: game.awayTeam, leagueId: game.leagueId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!homeTeam || !awayTeam) {
    logger.warn(
      {
        gameId: game.id,
        leagueId: game.leagueId,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeTeamMissing: !homeTeam,
        awayTeamMissing: !awayTeam,
      },
      'onResultUpdated: team not in teams table; skipping Elo update. LeagueService.upsertFixture auto-insert should close this gap on next sync.',
    );
    return null;
  }

  // Sequelize returns DECIMAL as STRING — parseFloat for all math. The
  // snapshot fields go through the same conversion when present.
  let homeEloLive = parseFloat(homeTeam.elo);
  let awayEloLive = parseFloat(awayTeam.elo);

  // Resolve / establish the pre-match snapshot. If we've applied a result
  // before, the snapshot is locked in — reuse it for both reverse + new
  // delta so we never use a contaminated live-Elo as the reference.
  let homeEloPre = game.homeEloPre != null ? parseFloat(game.homeEloPre) : null;
  let awayEloPre = game.awayEloPre != null ? parseFloat(game.awayEloPre) : null;

  // International model: read per-game K-multiplier (null → 1.0) and
  // neutral-venue flag. These travel with the game row so a result change
  // on the same game (X → Y) reverses + reapplies with the same multiplier,
  // preserving the Tier 17 PR F reversal invariant. PL fixtures have
  // eloKMultiplier=NULL + neutralVenue=FALSE so the opts collapse to the
  // bit-identical pre-international-model path.
  const eloOpts = {
    kMultiplier: game.eloKMultiplier != null ? parseFloat(game.eloKMultiplier) : 1,
    neutral: !!game.neutralVenue,
  };

  // Reverse prior delta (against the locked snapshot) if there's one to
  // reverse. After this block, team Elo is "as if this game had never
  // contributed."
  let reversed = null;
  if (previous != null && homeEloPre != null && awayEloPre != null) {
    const revertDelta = eloMath.eloDelta(homeEloPre, awayEloPre, previous, eloOpts);
    homeEloLive -= revertDelta.home;
    awayEloLive -= revertDelta.away;
    reversed = { previous, deltaHome: revertDelta.home, deltaAway: revertDelta.away };
  }

  // Apply the new delta (if any) against the snapshot, then persist.
  let applied = null;
  if (next != null) {
    // First-ever capture: take the snapshot off CURRENT team Elo (post-
    // reverse, which is a no-op here since previous was null).
    if (homeEloPre == null || awayEloPre == null) {
      homeEloPre = homeEloLive;
      awayEloPre = awayEloLive;
    }
    const newDelta = eloMath.eloDelta(homeEloPre, awayEloPre, next, eloOpts);
    homeEloLive += newDelta.home;
    awayEloLive += newDelta.away;
    applied = { next, deltaHome: newDelta.home, deltaAway: newDelta.away };
  } else {
    // Result cleared — drop the snapshot so a future re-set takes a fresh one.
    homeEloPre = null;
    awayEloPre = null;
  }

  // Round to DECIMAL(8,2) for storage; next read will see the rounded value.
  const homeEloAfter = Math.round(homeEloLive * 100) / 100;
  const awayEloAfter = Math.round(awayEloLive * 100) / 100;

  // gamesPlayed accounting: +1 on first apply, 0 on change (reverse -1
  // + apply +1), -1 on clear, 0 on idempotent (already short-circuited).
  let gamesPlayedDelta = 0;
  if (previous == null && next != null) gamesPlayedDelta = 1;
  else if (previous != null && next == null) gamesPlayedDelta = -1;

  // game.date → DATEONLY-friendly string for lastMatchDate. Only stamp
  // it when we're applying a new result; on clear, leave existing value
  // (it might still be the most recent match the team played in another
  // game's capture).
  const matchDate = game.date instanceof Date ? game.date : new Date(game.date);
  const lastMatchDate =
    next != null && !Number.isNaN(matchDate.getTime())
      ? matchDate.toISOString().slice(0, 10)
      : undefined;

  const homePatch = { elo: homeEloAfter };
  const awayPatch = { elo: awayEloAfter };
  if (gamesPlayedDelta !== 0) {
    homePatch.gamesPlayed = Math.max(0, homeTeam.gamesPlayed + gamesPlayedDelta);
    awayPatch.gamesPlayed = Math.max(0, awayTeam.gamesPlayed + gamesPlayedDelta);
  }
  if (lastMatchDate !== undefined) {
    homePatch.lastMatchDate = lastMatchDate;
    awayPatch.lastMatchDate = lastMatchDate;
  }
  await homeTeam.update(homePatch, { transaction });
  await awayTeam.update(awayPatch, { transaction });

  // Persist snapshot + appliedResult on the game row inside the same tx.
  game.homeEloPre = homeEloPre;
  game.awayEloPre = awayEloPre;
  game.appliedResult = next;
  await game.save({ transaction });

  logger.info(
    {
      gameId: game.id,
      leagueId: game.leagueId,
      previous,
      next,
      reversed,
      applied,
      snapshot: { home: homeEloPre, away: awayEloPre },
      home: { team: game.homeTeam, after: homeEloAfter },
      away: { team: game.awayTeam, after: awayEloAfter },
    },
    'onResultUpdated: Elo cascade applied',
  );

  return { affectedTeams: [game.homeTeam, game.awayTeam], leagueId: game.leagueId };
}

// Resolve the league's source code (e.g. "PL") from the leagueId. Used
// to pick the right model file. Avoids importing LeagueService to dodge
// the dependency cycle; one extra query per cascade is cheap.
async function _resolveLeagueCode(leagueId) {
  // Models module is required at the top; pull League off it.
  const { League } = require('../models');
  const league = await League.findByPk(leagueId, { attributes: ['sourceLeagueId'] });
  return league ? league.sourceLeagueId : null;
}

// Rewrite probabilities for every upcoming fixture in `leagueId` that
// involves any team in `affectedTeams`. Runs OUTSIDE the result-capture
// transaction. Failures are logged and swallowed by the caller so they
// can't break the result commit.
async function rePredictFutureFixtures({ affectedTeams, leagueId }) {
  if (!leagueId || !Array.isArray(affectedTeams) || affectedTeams.length === 0) {
    return { rewritten: 0, skipped: 'no input' };
  }
  const leagueCode = await _resolveLeagueCode(leagueId);
  if (!leagueCode) {
    logger.warn({ leagueId }, 'rePredictFutureFixtures: league not found; skipping');
    return { rewritten: 0, skipped: 'no league' };
  }
  const model = getModelForSourceLeagueCode(leagueCode);
  if (!model) {
    logger.warn(
      { leagueCode, leagueId, affectedTeams },
      'rePredictFutureFixtures: no model file for league; cascade no-op until lib/ml/models/<code>_elo.json is committed',
    );
    return { rewritten: 0, skipped: 'no model' };
  }

  // Tier 19 Chunk 5 — extra guard: never rewrite a game whose pick
  // probabilities have already been locked at kickoff. The existing
  // `status='scheduled'` filter already covers this (lock fires on the
  // scheduled → in-progress transition, so a locked game is by then no
  // longer scheduled), but the paranoid `IS NULL` check makes the
  // contract explicit and survives any future change to status semantics.
  const games = await Game.findAll({
    where: {
      leagueId,
      status: 'scheduled',
      pickProbabilitiesLockedAt: null,
      [Op.or]: [{ homeTeam: { [Op.in]: affectedTeams } }, { awayTeam: { [Op.in]: affectedTeams } }],
    },
  });
  if (games.length === 0) return { rewritten: 0 };

  // Bulk-fetch every team referenced by these fixtures (the affected
  // team(s) plus their opponents) so we make one query instead of N.
  const teamNames = new Set();
  for (const g of games) {
    teamNames.add(g.homeTeam);
    teamNames.add(g.awayTeam);
  }
  const teams = await Team.findAll({
    where: { name: { [Op.in]: [...teamNames] }, leagueId },
  });
  const eloByName = new Map(teams.map((t) => [t.name, parseFloat(t.elo)]));

  let rewritten = 0;
  let skipped = 0;
  for (const g of games) {
    // Knockout-stage fixtures whose participants haven't advanced yet carry
    // placeholder names ("TBD" / "Winner Group A"). Leave them at the
    // (0.50, 0.00, 0.50) sentinel so the frontend placeholder-gate keeps
    // showing "Picks open once both teams advance." A real prediction would
    // be misleading (and a stale auto-inserted placeholder team row could
    // otherwise resolve to a real Elo, defeating the null-Elo skip below).
    if (isPlaceholderTeam(g.homeTeam) || isPlaceholderTeam(g.awayTeam)) {
      skipped += 1;
      continue;
    }
    const homeElo = eloByName.get(g.homeTeam);
    const awayElo = eloByName.get(g.awayTeam);
    if (homeElo == null || awayElo == null) {
      // Opponent team not in teams table — skip this fixture. Should be
      // rare after LeagueService.upsertFixture auto-inserts.
      skipped += 1;
      continue;
    }
    let probs;
    try {
      probs = xgboost.predict(model, [homeElo, awayElo]);
      // International model — neutral-venue symmetrization. For games
      // marked neutralVenue=true (WC, future Euros finals, etc.) we
      // GUARANTEE order-independence by averaging the forward prediction
      // with the swapped prediction (class labels swapped to compensate).
      // The model was trained on a mix of home/away/neutral matches so it
      // has learned some asymmetry that doesn't apply on a neutral pitch;
      // averaging fwd + swap cancels it exactly. PL games (neutralVenue
      // defaults to FALSE) skip this branch entirely.
      if (g.neutralVenue) {
        const probsSwap = xgboost.predict(model, [awayElo, homeElo]);
        // 3-class softmax output: [P(home), P(draw), P(away)]. When we
        // swap inputs, the model outputs probs for THE NEW HOME (= old
        // away). So probsSwap[0] = old P(away from old-home perspective),
        // probsSwap[2] = old P(home). Draw stays draw.
        probs = [
          (probs[0] + probsSwap[2]) / 2,
          (probs[1] + probsSwap[1]) / 2,
          (probs[2] + probsSwap[0]) / 2,
        ];
      }
    } catch (err) {
      logger.error(
        { err, gameId: g.id, homeElo, awayElo },
        'rePredictFutureFixtures: xgboost.predict threw; skipping fixture',
      );
      skipped += 1;
      continue;
    }
    let triple;
    try {
      triple = normalize.toThreeWay(probs[0], probs[1], probs[2]);
    } catch (err) {
      logger.error(
        { err, gameId: g.id, probs },
        'rePredictFutureFixtures: normalize.toThreeWay threw; skipping fixture',
      );
      skipped += 1;
      continue;
    }
    await g.update({
      homeProbability: triple.home,
      drawProbability: triple.draw,
      awayProbability: triple.away,
    });
    rewritten += 1;
  }
  logger.info(
    { leagueId, leagueCode, affectedTeams, rewritten, skipped },
    'rePredictFutureFixtures: cascade complete',
  );
  return { rewritten, skipped };
}

module.exports = {
  onResultUpdated,
  // Back-compat alias for the prior name. Existing callers (GameService)
  // will migrate to onResultUpdated in the same PR; the alias is left
  // here so any out-of-band callers (tests, debug scripts) keep working.
  onResultCaptured: onResultUpdated,
  rePredictFutureFixtures,
  // Test seam — production code paths don't call this.
  _resetModelCache,
};
