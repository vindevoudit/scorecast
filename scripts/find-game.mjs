// One-off operator helper: look up the most recent game between two
// named teams + print its full Elo-cascade state. Useful for finding the
// gameId you need to feed into repair-test-game-elo.mjs.
//
// Usage:
//   node scripts/find-game.mjs "Home FC" "Away FC"

import { Sequelize } from 'sequelize';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set in env');
  process.exit(1);
}

const [, , homeTeam, awayTeam] = process.argv;
if (!homeTeam || !awayTeam) {
  console.error('Usage: node scripts/find-game.mjs "<homeTeam>" "<awayTeam>"');
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

try {
  const [rows] = await s.query(
    `SELECT id, "homeTeam", "awayTeam", date, status, result,
            "appliedResult", "homeEloPre", "awayEloPre",
            "homeProbability", "drawProbability", "awayProbability"
       FROM games
      WHERE "homeTeam" = :home AND "awayTeam" = :away
      ORDER BY date DESC
      LIMIT 5`,
    { replacements: { home: homeTeam, away: awayTeam } },
  );
  if (rows.length === 0) {
    console.log('(no matching games)');
  }
  for (const r of rows) {
    console.log(r);
  }
} finally {
  await s.close();
}
