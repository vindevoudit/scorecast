// Operator inspection script — prints ASCII-only WC league state so it
// can be invoked via `az containerapp exec` on Windows (cp1252-bound)
// hosts. Reports total game count, scheduled count, sample fixtures with
// current probabilities, total team count, and any TBD/placeholder team
// rows that should NOT receive probability rewrites.

import { Sequelize } from 'sequelize';

const url = process.env.DATABASE_URL;
if (!url) {
  process.stdout.write('STATUS=FAIL REASON=missing_database_url\n');
  process.exit(1);
}

const opts = url.includes('sslmode=require')
  ? {
      dialect: 'postgres',
      dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
      logging: false,
    }
  : { dialect: 'postgres', logging: false };

const sequelize = new Sequelize(url, opts);

const ascii = (s) => String(s ?? '').replace(/[^ -~]/g, '');

try {
  const [leagueRows] = await sequelize.query(
    `SELECT id, name, active FROM leagues WHERE "sourceProvider" = 'football-data.org' AND "sourceLeagueId" = 'WC' LIMIT 1`,
  );
  if (leagueRows.length === 0) {
    process.stdout.write('STATUS=FAIL REASON=no_wc_league\n');
    await sequelize.close();
    process.exit(1);
  }
  const wc = leagueRows[0];
  process.stdout.write(`WC_LEAGUE_ID=${wc.id} ACTIVE=${wc.active}\n`);

  const [[gamesTotalRow]] = await sequelize.query(
    `SELECT COUNT(*)::int AS c FROM games WHERE "leagueId" = :id`,
    { replacements: { id: wc.id } },
  );
  process.stdout.write(`GAMES_TOTAL=${gamesTotalRow.c}\n`);

  const [[gamesScheduledRow]] = await sequelize.query(
    `SELECT COUNT(*)::int AS c FROM games WHERE "leagueId" = :id AND status = 'scheduled'`,
    { replacements: { id: wc.id } },
  );
  process.stdout.write(`GAMES_SCHEDULED=${gamesScheduledRow.c}\n`);

  const [[teamsRow]] = await sequelize.query(
    `SELECT COUNT(*)::int AS c FROM teams WHERE "leagueId" = :id`,
    { replacements: { id: wc.id } },
  );
  process.stdout.write(`TEAMS_TOTAL=${teamsRow.c}\n`);

  // Look for TBD / placeholder team rows: TBD, Winner of, Loser of, Group A, etc.
  const [tbdTeams] = await sequelize.query(
    `SELECT name, elo, "gamesPlayed" FROM teams
     WHERE "leagueId" = :id
       AND (name ILIKE '%tbd%' OR name ILIKE '%winner%' OR name ILIKE '%loser%' OR name ILIKE 'group %' OR name ILIKE 'group_%' OR name ILIKE 'placeholder%')
     ORDER BY name`,
    { replacements: { id: wc.id } },
  );
  process.stdout.write(`TBD_TEAM_ROWS=${tbdTeams.length}\n`);
  for (const t of tbdTeams) {
    process.stdout.write(`TBD_TEAM=${ascii(t.name)} elo=${t.elo} games=${t.gamesPlayed}\n`);
  }

  // Sample of scheduled games: home/away names, probabilities, neutralVenue + kMult stamps.
  const [sampleGames] = await sequelize.query(
    `SELECT "homeTeam", "awayTeam", "homeProbability", "drawProbability", "awayProbability", "neutralVenue", "eloKMultiplier", date
     FROM games
     WHERE "leagueId" = :id AND status = 'scheduled'
     ORDER BY date ASC
     LIMIT 12`,
    { replacements: { id: wc.id } },
  );
  for (const g of sampleGames) {
    process.stdout.write(
      `SAMPLE=${ascii(g.homeTeam)}|vs|${ascii(g.awayTeam)} H=${g.homeProbability} D=${g.drawProbability} A=${g.awayProbability} neutral=${g.neutralVenue} kmult=${g.eloKMultiplier} date=${new Date(g.date).toISOString().slice(0, 10)}\n`,
    );
  }

  // Sample of teams that aren't TBD-like.
  const [topTeams] = await sequelize.query(
    `SELECT name, elo, "gamesPlayed" FROM teams
     WHERE "leagueId" = :id
       AND name NOT ILIKE '%tbd%' AND name NOT ILIKE '%winner%' AND name NOT ILIKE '%loser%'
     ORDER BY elo DESC LIMIT 5`,
    { replacements: { id: wc.id } },
  );
  for (const t of topTeams) {
    process.stdout.write(`TOP_TEAM=${ascii(t.name)} elo=${t.elo} games=${t.gamesPlayed}\n`);
  }

  await sequelize.close();
  process.exit(0);
} catch (err) {
  process.stdout.write(`STATUS=FAIL EXCEPTION=${ascii(err.message)}\n`);
  try {
    await sequelize.close();
  } catch (closeErr) {
    process.stderr.write(`CLOSE_FAILED=${closeErr.message}\n`);
  }
  process.exit(1);
}
