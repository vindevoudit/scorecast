// One-off operator helper: diagnose a "my picks disappeared" report.
//
// Prints, for a given username:
//   1. the user row (id, createdAt) so we know we matched the right account
//   2. every pick they own, joined to its game (team names, kickoff, status,
//      result) -- newest kickoff first
//   3. today's games (UTC) with a flag for whether THIS user has a pick on
//      each, so we can see picks-that-should-exist-but-don't at a glance
//   4. their materialized user_scores_overall row
//
// This distinguishes real data loss (no pick rows) from a display/bucketing
// bug (rows exist but the UI isn't showing them).
//
// Usage (local with prod DATABASE_URL, or via `az containerapp exec`):
//   node scripts/diagnose-user-picks.mjs Vanz
//
// ASCII-only stdout so it survives the Azure CLI cp1252 codec crash.

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
const ascii = (x) => String(x ?? '').replace(/[^ -~]/g, '');
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : 'null');

const username = process.argv[2];
if (!username) {
  console.error('Usage: node scripts/diagnose-user-picks.mjs <username>');
  process.exit(1);
}

try {
  // 1. user
  const [users] = await s.query(
    `SELECT id, username, "displayName", "createdAt"
       FROM users WHERE LOWER(username) = LOWER(:u)`,
    { replacements: { u: username } },
  );
  if (users.length === 0) {
    console.log(`NO USER matching username='${ascii(username)}'`);
    process.exit(0);
  }
  const user = users[0];
  console.log(
    `USER id=${user.id} username=${ascii(user.username)} displayName=${ascii(user.displayName)} createdAt=${iso(user.createdAt)}`,
  );

  // 2. every pick this user owns
  const [picks] = await s.query(
    `SELECT p.id, p.choice, p."submittedAt",
            p."appliedResult", p."appliedPoints",
            g.id AS "gameId", g."homeTeam", g."awayTeam", g.date,
            g.status, g.result
       FROM picks p
       JOIN games g ON g.id = p."gameId"
      WHERE p."userId" = :uid
      ORDER BY g.date DESC`,
    { replacements: { uid: user.id } },
  );
  console.log(`\nPICKS (${picks.length} total):`);
  for (const p of picks) {
    console.log(
      `  ${iso(p.date)} ${ascii(p.homeTeam)} vs ${ascii(p.awayTeam)} | choice=${p.choice} st=${p.status} res=${p.result ?? 'null'} submittedAt=${iso(p.submittedAt)} pickId=${p.id}`,
    );
  }

  // 3. today's games (UTC) + whether this user has a pick
  const [today] = await s.query(
    `SELECT g.id, g."homeTeam", g."awayTeam", g.date, g.status, g.result,
            EXISTS (SELECT 1 FROM picks p WHERE p."gameId" = g.id AND p."userId" = :uid) AS "userPicked",
            (SELECT COUNT(*) FROM picks p WHERE p."gameId" = g.id) AS "totalPicks"
       FROM games g
      WHERE g.date >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
        AND g.date <  date_trunc('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day'
      ORDER BY g.date ASC`,
    { replacements: { uid: user.id } },
  );
  console.log(`\nTODAY'S GAMES (UTC, ${today.length}):`);
  for (const g of today) {
    console.log(
      `  ${iso(g.date)} ${ascii(g.homeTeam)} vs ${ascii(g.awayTeam)} | st=${g.status} res=${g.result ?? 'null'} userPicked=${g.userPicked} totalPicks=${g.totalPicks} gameId=${g.id}`,
    );
  }

  // 4. materialized overall score
  const [scores] = await s.query(
    `SELECT points, "picksScored", "picksWon", "updatedAt"
       FROM user_scores_overall WHERE "userId" = :uid`,
    { replacements: { uid: user.id } },
  );
  console.log('\nUSER_SCORES_OVERALL:', scores[0] ? JSON.stringify(scores[0]) : '(no row)');
} finally {
  await s.close();
}
