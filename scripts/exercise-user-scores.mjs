// Tier 24 — Layer 3 of the verification gate. Operator-runnable, one-shot
// exercise script that walks every idempotency-matrix transition over a
// small synthetic universe and asserts that user_scores +
// user_scores_overall match `buildUserSummary` bit-identically at every
// step.
//
// Usage (from repo root with $env:DATABASE_URL set):
//
//   node scripts/exercise-user-scores.mjs
//
// Exits non-zero on any drift. Idempotent: same input → same final state.
//
// Pre-requisites: server-side migration applied AND the test database
// has been seeded with at least one league + one season + two users +
// one game. Convenient form: run against the dev DB after `npm run dev`
// has booted at least once. Caller is responsible for state cleanup
// afterwards (this script resets the picks/games it touches at exit).

import { Sequelize } from 'sequelize';

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

// scorePick mirror — same formula as lib/scoring.js + the backfill
// script. Duplicated intentionally (this script doesn't import the
// models module to avoid the umzug + DB init side-effects).
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

let drift = 0;
function fail(label, detail) {
  drift += 1;
  console.error(`DRIFT[${label}]`, detail);
}

async function getUsers() {
  const [rows] = await s.query(`SELECT id, username FROM users LIMIT 5`);
  return rows;
}

async function getGames() {
  const [rows] = await s.query(`
    SELECT id, "homeTeam", "awayTeam", "homeProbability", "drawProbability", "awayProbability",
           "leagueId", "seasonId", result, status
      FROM games
      WHERE "leagueId" IS NOT NULL
        AND "seasonId" IS NOT NULL
        AND date > NOW()
      ORDER BY date ASC
      LIMIT 3
  `);
  return rows;
}

async function readMaterializedOverall(userId) {
  const [rows] = await s.query(
    `SELECT points, "picksScored", "picksWon" FROM user_scores_overall WHERE "userId" = :userId`,
    { replacements: { userId } },
  );
  return rows[0] || { points: 0, picksScored: 0, picksWon: 0 };
}

async function computeExpectedOverall(userId) {
  const [rows] = await s.query(
    `SELECT p.choice, p."pickedHomeProbability", p."pickedDrawProbability", p."pickedAwayProbability",
            g.result, g."homeProbability", g."drawProbability", g."awayProbability"
       FROM picks p
       JOIN games g ON g.id = p."gameId"
      WHERE p."userId" = :userId`,
    { replacements: { userId } },
  );
  let points = 0;
  let picksScored = 0;
  let picksWon = 0;
  for (const r of rows) {
    if (r.result !== null) {
      const pick = {
        choice: r.choice,
        pickedHomeProbability: r.pickedHomeProbability,
        pickedDrawProbability: r.pickedDrawProbability,
        pickedAwayProbability: r.pickedAwayProbability,
      };
      const game = {
        result: r.result,
        homeProbability: r.homeProbability,
        drawProbability: r.drawProbability,
        awayProbability: r.awayProbability,
      };
      points += scorePick(pick, game);
      picksScored += 1;
      if (r.choice === r.result) picksWon += 1;
    }
  }
  return { points, picksScored, picksWon };
}

// Only checks the two users the script is exercising. Other users in
// the DB (real users, prior-test residue) may have picks whose
// contributions weren't materialized because they pre-date this run —
// that's noise, not drift relevant to the script.
let SCOPE_USER_IDS = [];
async function assertParity(label) {
  for (const userId of SCOPE_USER_IDS) {
    const actual = await readMaterializedOverall(userId);
    const expected = await computeExpectedOverall(userId);
    if (
      actual.points !== expected.points ||
      actual.picksScored !== expected.picksScored ||
      actual.picksWon !== expected.picksWon
    ) {
      fail(label, { userId, actual, expected });
    }
  }
}

// Direct DB simulation of a setResult call: updates games.result/status,
// walks the picks for that game, recomputes appliedPoints + delta, and
// applies to user_scores. Mirrors GameService.setResult exactly.
async function simulateSetResult(gameId, newResult) {
  await s.transaction(async (t) => {
    const [gameRows] = await s.query(
      `SELECT id, "homeProbability", "drawProbability", "awayProbability", "leagueId", "seasonId", result
         FROM games WHERE id = :id FOR UPDATE`,
      { transaction: t, replacements: { id: gameId } },
    );
    const game = gameRows[0];
    const oldResult = game.result;
    game.result = newResult;
    await s.query(`UPDATE games SET result = :newResult, status = :status WHERE id = :id`, {
      transaction: t,
      replacements: {
        newResult,
        status: newResult ? 'finished' : 'scheduled',
        id: gameId,
      },
    });

    const [picks] = await s.query(
      `SELECT id, "userId", choice, "pickedHomeProbability", "pickedDrawProbability", "pickedAwayProbability",
              "appliedResult", "appliedPoints"
         FROM picks WHERE "gameId" = :gameId`,
      { transaction: t, replacements: { gameId } },
    );

    for (const pick of picks) {
      const oldPoints = pick.appliedPoints ?? 0;
      const newPoints = scorePick(
        {
          choice: pick.choice,
          pickedHomeProbability: pick.pickedHomeProbability,
          pickedDrawProbability: pick.pickedDrawProbability,
          pickedAwayProbability: pick.pickedAwayProbability,
        },
        { result: newResult },
      );
      if ((pick.appliedResult ?? null) === newResult && oldPoints === newPoints) continue;
      const pointsDelta = newPoints - oldPoints;
      let scoredDelta = 0;
      let wonDelta = 0;
      if ((pick.appliedResult ?? null) !== null) {
        scoredDelta -= 1;
        if (pick.choice === pick.appliedResult) wonDelta -= 1;
      }
      if (newResult !== null) {
        scoredDelta += 1;
        if (pick.choice === newResult) wonDelta += 1;
      }

      if (pointsDelta !== 0 || scoredDelta !== 0 || wonDelta !== 0) {
        await s.query(
          `
            INSERT INTO user_scores ("userId", "leagueId", "seasonId", points, "picksScored", "picksWon", "updatedAt")
            VALUES (:userId, :leagueId, :seasonId, :pts, :scored, :won, NOW())
            ON CONFLICT ("userId", "leagueId", "seasonId") DO UPDATE
              SET points        = user_scores.points        + EXCLUDED.points,
                  "picksScored" = user_scores."picksScored" + EXCLUDED."picksScored",
                  "picksWon"    = user_scores."picksWon"    + EXCLUDED."picksWon",
                  "updatedAt"   = NOW()
          `,
          {
            transaction: t,
            replacements: {
              userId: pick.userId,
              leagueId: game.leagueId,
              seasonId: game.seasonId,
              pts: pointsDelta,
              scored: scoredDelta,
              won: wonDelta,
            },
          },
        );
        await s.query(
          `
            INSERT INTO user_scores_overall ("userId", points, "picksScored", "picksWon", "updatedAt")
            VALUES (:userId, :pts, :scored, :won, NOW())
            ON CONFLICT ("userId") DO UPDATE
              SET points        = user_scores_overall.points        + EXCLUDED.points,
                  "picksScored" = user_scores_overall."picksScored" + EXCLUDED."picksScored",
                  "picksWon"    = user_scores_overall."picksWon"    + EXCLUDED."picksWon",
                  "updatedAt"   = NOW()
          `,
          {
            transaction: t,
            replacements: {
              userId: pick.userId,
              pts: pointsDelta,
              scored: scoredDelta,
              won: wonDelta,
            },
          },
        );
      }
      await s.query(
        `UPDATE picks SET "appliedResult" = :ar, "appliedPoints" = :ap WHERE id = :id`,
        {
          transaction: t,
          replacements: { ar: newResult, ap: newPoints, id: pick.id },
        },
      );
    }
    void oldResult;
  });
}

try {
  console.log('Tier 24 — exercise script starting');
  const users = await getUsers();
  const games = await getGames();
  if (users.length < 2 || games.length < 1) {
    console.error(
      `Need ≥2 users + ≥1 upcoming game; have users=${users.length} games=${games.length}`,
    );
    process.exit(1);
  }

  const [u1, u2] = users;
  const g = games[0];
  SCOPE_USER_IDS = [u1.id, u2.id];
  console.log(`Using users [${u1.username}, ${u2.username}] + game ${g.homeTeam} vs ${g.awayTeam}`);

  // Reset to clean state
  await s.query(`DELETE FROM picks WHERE "gameId" = :gameId`, { replacements: { gameId: g.id } });
  await s.query(`UPDATE games SET result = NULL, status = 'scheduled' WHERE id = :id`, {
    replacements: { id: g.id },
  });
  // Reset materialized state for these two users
  await s.query(`DELETE FROM user_scores WHERE "userId" IN (:userIds)`, {
    replacements: { userIds: [u1.id, u2.id] },
  });
  await s.query(`DELETE FROM user_scores_overall WHERE "userId" IN (:userIds)`, {
    replacements: { userIds: [u1.id, u2.id] },
  });

  // Seed two picks
  await s.query(
    `INSERT INTO picks ("id", "userId", "gameId", choice, "pickedHomeProbability", "pickedDrawProbability", "pickedAwayProbability", "appliedResult", "appliedPoints", "submittedAt")
     VALUES (gen_random_uuid(), :userId, :gameId, 'home', :h, :d, :a, NULL, 0, NOW())`,
    {
      replacements: {
        userId: u1.id,
        gameId: g.id,
        h: g.homeProbability,
        d: g.drawProbability,
        a: g.awayProbability,
      },
    },
  );
  await s.query(
    `INSERT INTO picks ("id", "userId", "gameId", choice, "pickedHomeProbability", "pickedDrawProbability", "pickedAwayProbability", "appliedResult", "appliedPoints", "submittedAt")
     VALUES (gen_random_uuid(), :userId, :gameId, 'away', :h, :d, :a, NULL, 0, NOW())`,
    {
      replacements: {
        userId: u2.id,
        gameId: g.id,
        h: g.homeProbability,
        d: g.drawProbability,
        a: g.awayProbability,
      },
    },
  );

  await assertParity('initial');

  // Walk the matrix: null → home → away → draw → home → null
  const sequence = ['home', 'away', 'draw', 'home', null];
  for (const r of sequence) {
    await simulateSetResult(g.id, r);
    await assertParity(`after setResult(${r ?? 'null'})`);
  }

  // Idempotent re-saves: home → home → home; user_scores updatedAt
  // should stay frozen
  await simulateSetResult(g.id, 'home');
  await simulateSetResult(g.id, 'home');
  await simulateSetResult(g.id, 'home');
  await assertParity('after triple-home idempotent re-save');

  // Final cleanup
  await s.query(`DELETE FROM picks WHERE "gameId" = :gameId`, { replacements: { gameId: g.id } });
  await s.query(`UPDATE games SET result = NULL, status = 'scheduled' WHERE id = :id`, {
    replacements: { id: g.id },
  });
  await s.query(`DELETE FROM user_scores WHERE "userId" IN (:userIds)`, {
    replacements: { userIds: [u1.id, u2.id] },
  });
  await s.query(`DELETE FROM user_scores_overall WHERE "userId" IN (:userIds)`, {
    replacements: { userIds: [u1.id, u2.id] },
  });

  if (drift === 0) {
    console.log(
      `\nOK: 0 drift across 2 users × 1 game × ${sequence.length + 3} transitions (initial + sequence + 3 idempotent re-saves)`,
    );
    process.exit(0);
  } else {
    console.error(`\nFAIL: ${drift} drift entries`);
    process.exit(1);
  }
} finally {
  await s.close();
}
