// Operator query: list every team that's actually a participant in the
// 104 scheduled WC fixtures, sorted by Elo descending. The 2026 World
// Cup is the first expanded 48-team format so this should return ~48
// real nations (after excluding TBD and other placeholder slot strings).
//
// ASCII-only output for the az containerapp exec Windows cp1252 workaround.

import { Sequelize } from 'sequelize';

const url = process.env.DATABASE_URL;
const opts = url.includes('sslmode=require')
  ? {
      dialect: 'postgres',
      dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
      logging: false,
    }
  : { dialect: 'postgres', logging: false };
const sequelize = new Sequelize(url, opts);

try {
  const [rows] = await sequelize.query(`
    WITH wc AS (
      SELECT id FROM leagues
      WHERE "sourceProvider" = 'football-data.org' AND "sourceLeagueId" = 'WC'
      LIMIT 1
    ),
    participants AS (
      SELECT DISTINCT team FROM (
        SELECT "homeTeam" AS team FROM games
        WHERE "leagueId" = (SELECT id FROM wc)
        UNION
        SELECT "awayTeam" AS team FROM games
        WHERE "leagueId" = (SELECT id FROM wc)
      ) AS u
      WHERE team IS NOT NULL
        AND team <> 'TBD'
        AND team NOT ILIKE 'winner %'
        AND team NOT ILIKE 'loser %'
        AND team NOT ILIKE 'group %'
        AND team NOT ILIKE 'runner-up %'
        AND team NOT ILIKE 'placeholder%'
    )
    SELECT t.name, t.elo, t."gamesPlayed", t."lastMatchDate"
    FROM teams t
    JOIN wc ON t."leagueId" = wc.id
    JOIN participants p ON p.team = t.name
    ORDER BY t.elo DESC
  `);

  process.stdout.write(`PARTICIPANT_COUNT=${rows.length}\n`);
  let rank = 1;
  for (const r of rows) {
    const safeName = String(r.name).replace(/[^ -~]/g, '');
    const lmd = r.lastMatchDate ? new Date(r.lastMatchDate).toISOString().slice(0, 10) : 'null';
    process.stdout.write(
      `${String(rank).padStart(2, ' ')}. ${safeName.padEnd(28, ' ')} elo=${r.elo} games=${r.gamesPlayed} last=${lmd}\n`,
    );
    rank += 1;
  }
  await sequelize.close();
  process.exit(0);
} catch (err) {
  process.stdout.write(
    `STATUS=FAIL EXCEPTION=${String(err.message || err).replace(/[^ -~]/g, '')}\n`,
  );
  try {
    await sequelize.close();
  } catch (closeErr) {
    process.stderr.write(`CLOSE_FAILED=${closeErr.message}\n`);
  }
  process.exit(1);
}
