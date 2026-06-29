// One-off operator helper: look up the most recent game between two
// named teams + print its full Elo-cascade state. Useful for finding the
// gameId you need to feed into repair-test-game-elo.mjs.
//
// Usage:
//   node scripts/find-game.mjs "Home FC" "Away FC"
//
// --like mode (single substring, no spaces needed — survives `az containerapp
// exec`, which word-splits quoted spaced args): list every game where EITHER
// team name ILIKE %<substr>%, with stored odds + status + date. ASCII-only
// output so it survives the Azure CLI cp1252 codec.
//
//   node scripts/find-game.mjs --like bosnia

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

try {
  const [, , arg1, arg2] = process.argv;

  if (arg1 === '--like') {
    if (!arg2) {
      console.error('Usage: node scripts/find-game.mjs --like <substring>');
      process.exit(1);
    }
    const [rows] = await s.query(
      `SELECT id, "homeTeam" ht, "awayTeam" at, date, status, result,
              "homeProbability" h, "drawProbability" d, "awayProbability" a,
              "neutralVenue" nv, "pickProbabilitiesLockedAt" locked
         FROM games
        WHERE "homeTeam" ILIKE :pat OR "awayTeam" ILIKE :pat
        ORDER BY date ASC`,
      { replacements: { pat: `%${arg2}%` } },
    );
    if (rows.length === 0) console.log('(no matching games)');
    for (const r of rows) {
      console.log(
        `GAME ${ascii(r.ht)} vs ${ascii(r.at)} | ${r.h}/${r.d}/${r.a} | st=${r.status} res=${r.result ?? 'null'} nv=${r.nv} locked=${r.locked ? 'yes' : 'no'} date=${new Date(r.date).toISOString().slice(0, 10)} id=${r.id}`,
      );
    }
  } else {
    const homeTeam = arg1;
    const awayTeam = arg2;
    if (!homeTeam || !awayTeam) {
      console.error('Usage: node scripts/find-game.mjs "<homeTeam>" "<awayTeam>"   (or --like <substr>)');
      process.exit(1);
    }
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
  }
} finally {
  await s.close();
}
