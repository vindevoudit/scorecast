// Tier 24 backfill: populate user_scores + user_scores_overall +
// picks.{appliedResult, appliedPoints} from existing pick + game state.
//
// Walks every Pick where the game has a non-null result, computes
// scorePick (using the pick-time probability snapshot when present —
// matches lib/scoring.js + Tier 17 invariant), then sums into
// (userId, leagueId, seasonId) buckets and writes:
//   - one user_scores row per (userId, leagueId, seasonId)
//   - one user_scores_overall row per userId
//   - picks.appliedResult / picks.appliedPoints stamped
//
// Idempotent: re-running produces identical state. Safe to run multiple
// times. Uses INSERT ... ON CONFLICT DO UPDATE so a re-run on a fresh
// row-set against an already-populated table reconciles to the right
// totals (= last-write-wins, which is correct because the input picks +
// games are the source of truth).
//
// Usage (from repo root with $env:DATABASE_URL set):
//
//   node scripts/backfill-user-scores.mjs [--dry-run]
//
// --dry-run      — log what WOULD be written, don't touch the DB
//
// Pre-launch context: the picks table is ~empty, so this runs in
// seconds. Required after Chunk 1's migration deploys; the
// dual-writer phase (Chunk 2) assumes the backfill has already
// populated the sentinels on existing picks so the idempotency
// matrix's "first transition" case behaves correctly.

import { Sequelize } from 'sequelize';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set in env');
  process.exit(1);
}

const opts = url.includes('sslmode=require')
  ? {
      dialect: 'postgres',
      dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
      logging: false,
    }
  : { logging: false };
const s = new Sequelize(url, opts);

// Mirror of lib/scoring.js `scorePick` — kept verbatim instead of
// importing so this script doesn't pull the full CommonJS models
// module (which would trigger the umzug + DB-init side effects). The
// duplicated formula is acceptable here because the script's purpose
// is exactly to backfill state that the live scorer produces — if
// they diverge, the parity log in Chunk 2 catches it before Chunk 3
// trusts the table.
function scorePick(pick, game) {
  if (!game.result) return 0;
  const usesSnapshot = pick && pick.pickedHomeProbability != null;
  const ph = parseFloat(usesSnapshot ? pick.pickedHomeProbability : game.homeProbability);
  const pd = parseFloat(usesSnapshot ? pick.pickedDrawProbability : game.drawProbability);
  const pa = parseFloat(usesSnapshot ? pick.pickedAwayProbability : game.awayProbability);
  if (game.result === 'draw') {
    const denom = ph + pa;
    if (denom <= 0 || Number.isNaN(pd)) return 0;
    const opposite = pick.choice === 'home' ? pa : ph;
    return Math.round(((pd * opposite) / denom) * 100);
  }
  const isWinningChoice =
    (pick.choice === 'home' && game.result === 'home') ||
    (pick.choice === 'away' && game.result === 'away');
  if (!isWinningChoice) return 0;
  const probability = pick.choice === 'home' ? ph : pa;
  return Math.round((1 - probability) * 100);
}

try {
  // Load every pick joined with its game. Includes scheduled-game picks
  // (game.result IS NULL) so we can explicitly stamp appliedResult=NULL
  // / appliedPoints=0 on them — the schema default already does this,
  // but stamping explicitly means a re-run after a corrupted state can
  // converge.
  const [rows] = await s.query(`
    SELECT
      p.id              AS pick_id,
      p."userId"        AS user_id,
      p."gameId"        AS game_id,
      p.choice          AS choice,
      p."pickedHomeProbability" AS picked_home,
      p."pickedDrawProbability" AS picked_draw,
      p."pickedAwayProbability" AS picked_away,
      p."appliedResult" AS applied_result,
      p."appliedPoints" AS applied_points,
      g.result          AS game_result,
      g."leagueId"      AS league_id,
      g."seasonId"      AS season_id,
      g."homeProbability" AS home_p,
      g."drawProbability" AS draw_p,
      g."awayProbability" AS away_p
    FROM picks p
    JOIN games g ON g.id = p."gameId"
  `);
  console.log(`Loaded ${rows.length} picks`);

  // Build per-(userId, leagueId, seasonId) buckets + overall sums by
  // replaying scorePick over every row. Then diff against existing
  // user_scores / user_scores_overall state to compute the exact
  // deltas to write.
  const buckets = new Map(); // key = userId|leagueId|seasonId → {points, scored, won}
  const overall = new Map(); // key = userId               → {points, scored, won}
  const pickUpdates = []; // rows whose appliedResult / appliedPoints need to flip

  for (const r of rows) {
    const pick = {
      choice: r.choice,
      pickedHomeProbability: r.picked_home,
      pickedDrawProbability: r.picked_draw,
      pickedAwayProbability: r.picked_away,
    };
    const game = {
      result: r.game_result,
      homeProbability: r.home_p,
      drawProbability: r.draw_p,
      awayProbability: r.away_p,
    };
    const points = scorePick(pick, game);
    const scored = r.game_result !== null ? 1 : 0;
    const won = r.game_result !== null && r.choice === r.game_result ? 1 : 0;

    if (r.game_result !== null) {
      const key = `${r.user_id}|${r.league_id}|${r.season_id}`;
      const cur = buckets.get(key) || {
        userId: r.user_id,
        leagueId: r.league_id,
        seasonId: r.season_id,
        points: 0,
        scored: 0,
        won: 0,
      };
      cur.points += points;
      cur.scored += scored;
      cur.won += won;
      buckets.set(key, cur);

      const oCur = overall.get(r.user_id) || {
        userId: r.user_id,
        points: 0,
        scored: 0,
        won: 0,
      };
      oCur.points += points;
      oCur.scored += scored;
      oCur.won += won;
      overall.set(r.user_id, oCur);
    }

    const targetAppliedResult = r.game_result;
    const targetAppliedPoints = points;
    if (r.applied_result !== targetAppliedResult || r.applied_points !== targetAppliedPoints) {
      pickUpdates.push({
        id: r.pick_id,
        appliedResult: targetAppliedResult,
        appliedPoints: targetAppliedPoints,
      });
    }
  }

  console.log(
    `Computed ${buckets.size} (userId, leagueId, seasonId) rows; ${overall.size} overall rows; ${pickUpdates.length} pick sentinel updates`,
  );

  if (dryRun) {
    console.log('DRY RUN — no DB writes');
    process.exit(0);
  }

  // Atomic transaction so a mid-write interrupt leaves the prior state
  // intact. Pre-launch the picks table is small, so wrapping the entire
  // backfill in one tx is cheap; in any future "rebuild from scratch"
  // operator scenario it's still bounded by the picks row count.
  const tx = await s.transaction();
  try {
    // Reset BOTH tables to a clean slate before re-inserting the
    // computed totals. Without this, a re-run after a corrupted state
    // would ADD to the corrupted values instead of overwriting them.
    // The ON CONFLICT DO UPDATE rules used at runtime use += (correct
    // for incremental deltas); a backfill is an absolute write.
    await s.query(`DELETE FROM user_scores`, { transaction: tx });
    await s.query(`DELETE FROM user_scores_overall`, { transaction: tx });

    for (const b of buckets.values()) {
      await s.query(
        `
          INSERT INTO user_scores ("userId", "leagueId", "seasonId", points, "picksScored", "picksWon", "updatedAt")
          VALUES (:userId, :leagueId, :seasonId, :points, :scored, :won, NOW())
        `,
        {
          transaction: tx,
          replacements: {
            userId: b.userId,
            leagueId: b.leagueId,
            seasonId: b.seasonId,
            points: b.points,
            scored: b.scored,
            won: b.won,
          },
        },
      );
    }

    for (const o of overall.values()) {
      await s.query(
        `
          INSERT INTO user_scores_overall ("userId", points, "picksScored", "picksWon", "updatedAt")
          VALUES (:userId, :points, :scored, :won, NOW())
        `,
        {
          transaction: tx,
          replacements: {
            userId: o.userId,
            points: o.points,
            scored: o.scored,
            won: o.won,
          },
        },
      );
    }

    for (const u of pickUpdates) {
      await s.query(
        `
          UPDATE picks
             SET "appliedResult" = :appliedResult,
                 "appliedPoints" = :appliedPoints
           WHERE id = :id
        `,
        {
          transaction: tx,
          replacements: {
            id: u.id,
            appliedResult: u.appliedResult,
            appliedPoints: u.appliedPoints,
          },
        },
      );
    }

    await tx.commit();
    console.log(
      `\nWrote user_scores=${buckets.size} user_scores_overall=${overall.size} pick_updates=${pickUpdates.length}`,
    );
  } catch (err) {
    await tx.rollback();
    throw err;
  }
} finally {
  await s.close();
}
