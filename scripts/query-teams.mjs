// Quick prod-safe team-row inspector. Reads $env:DATABASE_URL, opts into
// SSL when the URL includes `sslmode=require` (mirrors models/index.js
// behavior so prod Azure connections work). Pass team names as args:
//
//   node scripts/query-teams.mjs "West Ham United FC" "Newcastle United FC"
//
// With no args, prints the top 10 + a row count.

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

const names = process.argv.slice(2);

try {
  if (names.length === 0) {
    const [cnt] = await s.query('SELECT COUNT(*) AS team_count FROM teams');
    console.log('teams:', cnt[0].team_count);
    const [top] = await s.query(
      'SELECT name, elo, "gamesPlayed", "lastMatchDate" FROM teams ORDER BY elo DESC LIMIT 10',
    );
    for (const r of top) {
      console.log(
        ' ',
        r.name.padEnd(34),
        'elo=' + r.elo,
        'gp=' + r.gamesPlayed,
        'last=' + (r.lastMatchDate ?? 'null'),
      );
    }
  } else {
    const [rows] = await s.query(
      'SELECT name, elo, "gamesPlayed", "lastMatchDate" FROM teams WHERE name = ANY($names) ORDER BY name',
      { bind: { names } },
    );
    if (rows.length === 0) {
      console.log('(no matching rows)');
    }
    for (const r of rows) {
      console.log(
        r.name.padEnd(34),
        'elo=' + r.elo,
        'gp=' + r.gamesPlayed,
        'last=' + (r.lastMatchDate ?? 'null'),
      );
    }
  }
} finally {
  await s.close();
}
