// Tier 30 Phase 3 A1 Revision (2026-05-31) — Win-streak backfill.
//
// Recomputes currentWinStreak + longestWinStreak + lastMilestoneFired for
// every user from their full scored-pick history. Required once after the
// migration deploys to populate the new columns; subsequent updates are
// driven automatically by the GameService result-scoring hooks.
//
// Idempotent: re-running produces identical state. Safe to run any number
// of times. Uses the same pure logic as services/StreakService.js (mirror
// kept here to avoid pulling the full CommonJS models module).
//
// ASCII-only stdout: this is meant to run via `az containerapp exec`, whose
// Windows-side CLI hardcodes cp1252 and crashes on non-cp1252 bytes (the
// documented "Azure CLI cp1252 crash" invariant). No emoji / unicode here.
//
// Usage (from repo root, or inside the container, with DATABASE_URL set):
//
//   node scripts/recompute-streaks.mjs [--dry-run]
//
//   --dry-run     compute + print what WOULD change, then ROLLBACK.

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

// Mirror of services/StreakService.js pure logic. Kept in sync by hand —
// the surface is small (~30 LOC) and the script's purpose is exactly to
// reproduce the runtime computation.
const STREAK_MILESTONES = [5, 10, 15, 20, 30, 50];
const RESULT_PRIORITY = { win: 0, draw: 1, loss: 2 };

function classify(choice, result) {
  if (result === 'draw') return 'draw';
  if (choice === result) return 'win';
  return 'loss';
}

function computeStreakFromRows(rows) {
  const classified = rows.map((r) => ({
    kind: classify(r.choice, r.result),
    date: new Date(r.date).getTime(),
    gameId: r.gameId,
  }));
  classified.sort((a, b) => {
    if (a.date !== b.date) return a.date - b.date;
    const pa = RESULT_PRIORITY[a.kind];
    const pb = RESULT_PRIORITY[b.kind];
    if (pa !== pb) return pa - pb;
    if (a.gameId < b.gameId) return -1;
    if (a.gameId > b.gameId) return 1;
    return 0;
  });
  let current = 0;
  let longest = 0;
  for (const row of classified) {
    if (row.kind === 'win') {
      current += 1;
      if (current > longest) longest = current;
    } else if (row.kind === 'loss') {
      current = 0;
    }
  }
  return { current, longest };
}

function resolveMilestoneStamp(newCurrent) {
  // For backfill we compute the natural stamp from scratch — the largest
  // milestone the user has reached given their current value. Pushing
  // milestones retroactively would spam every user with all the badges
  // they passed historically, which is not what we want from a one-shot
  // backfill. Notifications fire from the live hook on subsequent
  // crossings, not from this script.
  const reachable = STREAK_MILESTONES.filter((M) => M <= newCurrent);
  return reachable.length > 0 ? Math.max(...reachable) : 0;
}

const tx = await s.transaction();
try {
  const [users] = await s.query(
    `SELECT id, username, "currentWinStreak", "longestWinStreak", "lastMilestoneFired" FROM users ORDER BY username`,
    { transaction: tx },
  );

  console.log('--- recompute-streaks ---');
  console.log('users to process: ' + users.length);
  if (dryRun) console.log('DRY RUN — changes will be rolled back');
  console.log('');

  let changedCount = 0;
  let unchangedCount = 0;

  for (const user of users) {
    // Pull every scored pick for the user, joined with the relevant game
    // columns. Sequelize is overkill here — a single raw query keeps the
    // script's surface area minimal.
    const [rows] = await s.query(
      `
        SELECT p.choice AS choice, g.id AS "gameId", g.date AS date, g.result AS result
        FROM picks p
        INNER JOIN games g ON g.id = p."gameId"
        WHERE p."userId" = :userId
          AND g.result IS NOT NULL
      `,
      {
        replacements: { userId: user.id },
        transaction: tx,
      },
    );

    const { current, longest } = computeStreakFromRows(rows);
    const prevCurrent = user.currentWinStreak || 0;
    const prevLongest = user.longestWinStreak || 0;
    const prevStamp = user.lastMilestoneFired || 0;

    // Monotonic longest: never decrease.
    const nextLongest = Math.max(prevLongest, longest);
    const nextStamp = resolveMilestoneStamp(current);

    const changed =
      prevCurrent !== current || prevLongest !== nextLongest || prevStamp !== nextStamp;

    if (!changed) {
      unchangedCount += 1;
      continue;
    }

    changedCount += 1;
    console.log(
      `${user.username.padEnd(20)}  ` +
        `current ${prevCurrent} -> ${current}   ` +
        `longest ${prevLongest} -> ${nextLongest}   ` +
        `stamp ${prevStamp} -> ${nextStamp}   ` +
        `(scored picks: ${rows.length})`,
    );

    if (!dryRun) {
      await s.query(
        `
          UPDATE users
          SET "currentWinStreak" = :current,
              "longestWinStreak" = :longest,
              "lastMilestoneFired" = :stamp
          WHERE id = :id
        `,
        {
          replacements: { id: user.id, current, longest: nextLongest, stamp: nextStamp },
          transaction: tx,
        },
      );
    }
  }

  console.log('');
  console.log('--- summary ---');
  console.log('changed:   ' + changedCount);
  console.log('unchanged: ' + unchangedCount);

  if (dryRun) {
    await tx.rollback();
    console.log('DRY RUN complete (rolled back).');
  } else {
    await tx.commit();
    console.log('committed.');
  }
} catch (err) {
  await tx.rollback();
  console.error('recompute-streaks failed:', err.message);
  process.exit(1);
} finally {
  await s.close();
}
