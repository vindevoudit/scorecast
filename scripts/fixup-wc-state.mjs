// Operator fix-up script for the intl-model rollout. Run ONCE after the
// INT seeder has populated 333 nations into the WC league. Addresses
// three issues that surfaced from inspect-wc-state.mjs against prod:
//
//   1. The 104 WC fixtures that were synced BEFORE the intl-model code
//      shipped don't have the WC-defaults stamp on them (neutralVenue=false,
//      eloKMultiplier=null). Without those, the cascade's K=20 math runs
//      instead of K=60, and rePredictFutureFixtures skips the symmetrization
//      branch. Idempotent backfill: UPDATE WHERE leagueId=WC.
//
//   2. The TBD team row exists at elo=1500 because LeagueService.upsertFixture's
//      ensureTeamExists auto-inserts a row for every fixture's home/away team
//      name string — including the literal "TBD" used for knockout-stage
//      placeholders. Leaving this row in place means rePredictFutureFixtures
//      would happily emit ~equal probabilities for TBD-vs-Real-Team games
//      (both teams resolve to Team rows with elo values). Delete it; the
//      cascade's `if (homeElo == null || awayElo == null)` skip then fires.
//
//   3. Mexico / Brazil / United States / etc. (any 2026 WC qualifier that
//      was already in the teams table from the fixture sync) have stuck-at-1500
//      Elo because the seeder's ON CONFLICT DO NOTHING preserved their auto-
//      inserted rows. Identify them via `gamesPlayed=0` (no result has fired
//      the runtime cascade against them since insertion) and overwrite their
//      Elo with the seeder's computed value by re-walking the international
//      history in-process. The 333 seeder-inserted teams stay untouched.
//
// Then optionally fire rePredictFutureFixtures for the affected league so
// the 104 fixtures get probabilities. Pass --rewrite-probs to enable; the
// default is dry-run on that step so the operator can inspect first.
//
// ASCII-only output for the az containerapp exec Windows cp1252 workaround.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Sequelize } from 'sequelize';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rewriteProbs = process.argv.includes('--rewrite-probs');

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

const K_FACTOR = 20;
const INITIAL_RATING = 1500;
const HFA = 0;

const KMULT_TABLE = {
  'FIFA World Cup': 3.0,
  'FIFA World Cup qualification': 2.5,
  'UEFA Euro': 2.5,
  'Copa América': 2.5,
  'African Cup of Nations': 2.5,
  'AFC Asian Cup': 2.5,
  'Gold Cup': 2.5,
  'CONCACAF Championship': 2.5,
  'Oceania Nations Cup': 2.5,
  'UEFA Euro qualification': 2.0,
  'African Cup of Nations qualification': 2.0,
  'AFC Asian Cup qualification': 2.0,
  'Gold Cup qualification': 2.0,
  'CONCACAF Championship qualification': 2.0,
  'UEFA Nations League': 2.0,
  'CONCACAF Nations League': 2.0,
  'Confederations Cup': 1.5,
  'FIFA Confederations Cup': 1.5,
  Friendly: 1.0,
};
function deriveKMult(t) {
  if (KMULT_TABLE[t] !== undefined) return KMULT_TABLE[t];
  if (String(t || '').includes('Olympic')) return 1.5;
  return 1.0;
}

function expectedHomeScore(homeElo, awayElo, hfa = HFA) {
  return 1 / (1 + Math.pow(10, (awayElo - (homeElo + hfa)) / 400));
}
function eloDelta(homeElo, awayElo, ftr, { kMultiplier = 1, neutral = false } = {}) {
  const eh = expectedHomeScore(homeElo, awayElo, neutral ? 0 : HFA);
  const ea = 1 - eh;
  let actH, actA;
  if (ftr === 'H') {
    actH = 1;
    actA = 0;
  } else if (ftr === 'A') {
    actH = 0;
    actA = 1;
  } else {
    actH = 0.5;
    actA = 0.5;
  }
  const k = K_FACTOR * kMultiplier;
  return { home: k * (actH - eh), away: k * (actA - ea) };
}

function parseDate(s) {
  const [y, m, d] = String(s)
    .split('-')
    .map((v) => parseInt(v, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

function loadFormerNames(p) {
  const text = readFileSync(p, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(',');
  const idx = {
    current: header.indexOf('current'),
    former: header.indexOf('former'),
    start: header.indexOf('start_date'),
    end: header.indexOf('end_date'),
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    rows.push({
      current: c[idx.current].trim(),
      former: c[idx.former].trim(),
      start: parseDate(c[idx.start].trim()),
      end: parseDate(c[idx.end].trim()),
    });
  }
  return rows;
}

function rewriteNames(home, away, date, formerNames) {
  let h = home;
  let a = away;
  for (const r of formerNames) {
    if (date >= r.start && date <= r.end) {
      if (h === r.former) h = r.current;
      if (a === r.former) a = r.current;
    }
  }
  return [h, a];
}

function parseResults(p) {
  const text = readFileSync(p, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(',');
  const idx = {
    date: header.indexOf('date'),
    home: header.indexOf('home_team'),
    away: header.indexOf('away_team'),
    hs: header.indexOf('home_score'),
    as: header.indexOf('away_score'),
    tournament: header.indexOf('tournament'),
    neutral: header.indexOf('neutral'),
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const hsStr = c[idx.hs].trim();
    const asStr = c[idx.as].trim();
    if (hsStr === 'NA' || asStr === 'NA' || hsStr === '' || asStr === '') continue;
    const hs = parseInt(hsStr, 10);
    const as = parseInt(asStr, 10);
    if (Number.isNaN(hs) || Number.isNaN(as)) continue;
    const home = c[idx.home].trim();
    const away = c[idx.away].trim();
    if (!home || !away || home === away) continue;
    const t = c[idx.tournament].trim();
    rows.push({
      date: parseDate(c[idx.date].trim()),
      home,
      away,
      ftr: hs > as ? 'H' : hs < as ? 'A' : 'D',
      tournament: t,
      neutral: c[idx.neutral].trim().toUpperCase() === 'TRUE',
      kMultiplier: deriveKMult(t),
    });
  }
  rows.sort((x, y) => x.date - y.date);
  return rows;
}

async function main() {
  // -- Step 1: load WC league row + history.
  const [leagueRows] = await sequelize.query(
    `SELECT id FROM leagues WHERE "sourceProvider" = 'football-data.org' AND "sourceLeagueId" = 'WC' LIMIT 1`,
  );
  if (leagueRows.length === 0) {
    process.stdout.write('STATUS=FAIL REASON=no_wc_league\n');
    return 1;
  }
  const wcId = leagueRows[0].id;
  process.stdout.write(`WC_LEAGUE_ID=${wcId}\n`);

  // -- Step 2: backfill neutralVenue + eloKMultiplier on existing WC games.
  // (Note: games table has timestamps: false in the Sequelize model — there's
  // no updatedAt column, don't try to set one here.)
  const [, gameMeta] = await sequelize.query(
    `UPDATE games
       SET "neutralVenue" = true,
           "eloKMultiplier" = 3.0
     WHERE "leagueId" = :id
       AND ("neutralVenue" = false OR "eloKMultiplier" IS NULL)`,
    { replacements: { id: wcId } },
  );
  process.stdout.write(`GAMES_STAMPED=${gameMeta.rowCount ?? 'unknown'}\n`);

  // -- Step 3: delete TBD / placeholder team rows.
  const [, tbdMeta] = await sequelize.query(
    `DELETE FROM teams
     WHERE "leagueId" = :id
       AND (
         name = 'TBD'
         OR name ILIKE 'winner %'
         OR name ILIKE 'loser %'
         OR name ILIKE 'group %'
         OR name ILIKE 'runner-up %'
         OR name ILIKE 'placeholder%'
       )
       AND "gamesPlayed" = 0`,
    { replacements: { id: wcId } },
  );
  process.stdout.write(`TBD_TEAMS_DELETED=${tbdMeta.rowCount ?? 'unknown'}\n`);

  // -- Step 4: identify the stuck-at-1500 teams (gamesPlayed=0 after step 3).
  const [stuckTeams] = await sequelize.query(
    `SELECT name FROM teams WHERE "leagueId" = :id AND "gamesPlayed" = 0`,
    { replacements: { id: wcId } },
  );
  process.stdout.write(`STUCK_TEAM_COUNT=${stuckTeams.length}\n`);
  for (const t of stuckTeams) {
    process.stdout.write(`STUCK=${String(t.name).replace(/[^ -~]/g, '')}\n`);
  }

  if (stuckTeams.length === 0) {
    process.stdout.write('STATUS=OK PHASE=team-elo-fixup REASON=nothing_to_do\n');
  } else {
    // Walk the international history (same logic as the seeder) and update
    // only the stuck teams' Elo. Keeps the 333 seeder-inserted teams untouched.
    const archiveDir = resolve(__dirname, '..', 'international_match_archive');
    const formerNames = loadFormerNames(resolve(archiveDir, 'former_names.csv'));
    const rows = parseResults(resolve(archiveDir, 'results.csv'));
    process.stdout.write(`HISTORY_ROWS=${rows.length}\n`);

    const state = new Map();
    for (const row of rows) {
      const [home, away] = rewriteNames(row.home, row.away, row.date, formerNames);
      if (!home || !away || home === away) continue;
      if (!state.has(home))
        state.set(home, { rating: INITIAL_RATING, gamesPlayed: 0, lastMatchDate: null });
      if (!state.has(away))
        state.set(away, { rating: INITIAL_RATING, gamesPlayed: 0, lastMatchDate: null });
      const h = state.get(home);
      const a = state.get(away);
      const d = eloDelta(h.rating, a.rating, row.ftr, {
        kMultiplier: row.kMultiplier,
        neutral: row.neutral,
      });
      h.rating += d.home;
      a.rating += d.away;
      h.gamesPlayed += 1;
      a.gamesPlayed += 1;
      h.lastMatchDate = row.date;
      a.lastMatchDate = row.date;
    }

    // Synonym map: football-data.org uses some names that differ from the
    // martj42 dataset's canonical names. When we find a stuck team whose name
    // doesn't appear in `state`, fall back to the dataset-side name via this
    // map and use that team's Elo. The team row's `name` column (the one we
    // UPDATE) stays at the football-data.org form so the runtime cascade
    // continues to find it when WC fixtures arrive with those names.
    //
    // This is the inverse direction of seeders/reconcileMap.json which maps
    // dataset names → canonical; here we map canonical (football-data.org) →
    // dataset names so we can read the seeder-computed Elo.
    const HISTORY_SYNONYMS = {
      Czechia: 'Czech Republic',
      'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
      'Cape Verde Islands': 'Cape Verde',
      'Congo DR': 'DR Congo',
    };
    const stuckNames = stuckTeams.map((t) => t.name);
    let updated = 0;
    let missingFromHistory = 0;
    for (const name of stuckNames) {
      const lookupName = HISTORY_SYNONYMS[name] || name;
      const s = state.get(lookupName);
      if (!s) {
        missingFromHistory += 1;
        process.stdout.write(`MISSING_FROM_HISTORY=${String(name).replace(/[^ -~]/g, '')}\n`);
        continue;
      }
      await sequelize.query(
        `UPDATE teams
            SET elo = :elo,
                "gamesPlayed" = :gp,
                "lastMatchDate" = :lmd,
                "updatedAt" = NOW()
          WHERE "leagueId" = :id AND name = :name AND "gamesPlayed" = 0`,
        {
          replacements: {
            id: wcId,
            name,
            elo: s.rating.toFixed(2),
            gp: s.gamesPlayed,
            lmd: s.lastMatchDate ? s.lastMatchDate.toISOString().slice(0, 10) : null,
          },
        },
      );
      updated += 1;
    }
    process.stdout.write(`STUCK_UPDATED=${updated}\n`);
    process.stdout.write(`STUCK_MISSING_FROM_HISTORY=${missingFromHistory}\n`);
  }

  // -- Step 5: optional probability rewrite for WC fixtures.
  if (rewriteProbs) {
    process.stdout.write('PHASE=rewrite-probs\n');
    const [scheduledGames] = await sequelize.query(
      `SELECT "homeTeam", "awayTeam" FROM games WHERE "leagueId" = :id AND status = 'scheduled'`,
      { replacements: { id: wcId } },
    );
    const teamSet = new Set();
    for (const g of scheduledGames) {
      teamSet.add(g.homeTeam);
      teamSet.add(g.awayTeam);
    }
    process.stdout.write(`AFFECTED_TEAM_COUNT=${teamSet.size}\n`);

    // Spawn the cascade as a subprocess with stdio:pipe so all output
    // (including pino's fs.write(1, ...) JSON logs in production mode,
    // which bypasses any process.stdout.write interception) is captured
    // into THIS script's buffer. We then emit only ASCII to az's stdout.
    // Same subprocess-isolation pattern as scripts/run-int-seed.mjs.
    const { spawn } = await import('node:child_process');
    const { writeFileSync } = await import('node:fs');
    const cascadeBody = `
      const ps = require('./services/PredictionService');
      ps.rePredictFutureFixtures({
        affectedTeams: ${JSON.stringify([...teamSet])},
        leagueId: ${JSON.stringify(wcId)},
      }).then((r) => {
        process.stdout.write('RESULT_JSON=' + JSON.stringify(r) + '\\n');
        process.exit(0);
      }).catch((e) => {
        process.stdout.write('RESULT_ERROR=' + (e && e.message ? e.message : String(e)) + '\\n');
        process.exit(1);
      });
    `;
    await new Promise((resolveOuter) => {
      const child = spawn(process.execPath, ['-e', cascadeBody], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => {
        out += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        err += chunk.toString();
      });
      child.on('exit', (code) => {
        try {
          writeFileSync('/tmp/cascade.log', `STDOUT:\n${out}\nSTDERR:\n${err}\nEXIT: ${code}\n`);
        } catch (writeErr) {
          process.stderr.write(`CASCADE_LOG_WRITE_FAILED=${writeErr.message}\n`);
        }
        // Pull the RESULT_JSON / RESULT_ERROR line out of the child's
        // stdout. Everything else is pino's JSON noise, dumped to the
        // cascade log file for inspection.
        const resultMatch = out.match(/RESULT_JSON=(.+)/);
        const errorMatch = out.match(/RESULT_ERROR=(.+)/);
        if (resultMatch) {
          try {
            const parsed = JSON.parse(resultMatch[1]);
            process.stdout.write(`REWRITTEN=${parsed.rewritten} SKIPPED=${parsed.skipped ?? 0}\n`);
          } catch (parseErr) {
            process.stdout.write(`RESULT_PARSE_FAILED=${parseErr.message}\n`);
          }
        } else if (errorMatch) {
          process.stdout.write(
            `CASCADE_EXCEPTION=${String(errorMatch[1]).replace(/[^ -~]/g, '')}\n`,
          );
        } else {
          process.stdout.write(`CASCADE_NO_RESULT EXIT_CODE=${code}\n`);
        }
        process.stdout.write('CASCADE_LOG=/tmp/cascade.log\n');
        resolveOuter();
      });
    });
  } else {
    process.stdout.write('PHASE=rewrite-probs-skipped REASON=no_flag\n');
    process.stdout.write('NEXT_STEP=re-run_with_--rewrite-probs_to_fill_probabilities\n');
  }

  process.stdout.write('STATUS=OK\n');
  return 0;
}

try {
  const code = await main();
  await sequelize.close();
  process.exit(code);
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
