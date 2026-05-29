'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const eloMath = require('../lib/ml/eloMath');

// International model Elo bootstrap seeder. Replays the committed
// international_match_archive/results.csv chronologically and writes each
// nation's resulting Elo into the `teams` table under the existing `WC`
// league row. The runtime cascade in PredictionService.onResultUpdated
// then takes over for every subsequent captured result.
//
// Mirrors ml/scorecast_ml/elo/engine.py `batch_compute()` and the Python
// ingest module's K-multiplier + neutral-flag logic exactly. To
// structurally eliminate the parity drift loophole the PL seeder is
// grandfathered into (open-coded math), this seeder calls
// lib/ml/eloMath.js eloDelta(..., { kMultiplier, neutral }) directly —
// the same function PredictionService uses for the runtime cascade. So
// drift can only happen via the K-mult table or the former-names table,
// both of which mirror the Python sources and cite each other.
//
// Idempotency: `ON CONFLICT (name, leagueId) DO NOTHING` preserves the
// live Elo accumulated by the reactive cascade since the initial seed.
//
// Missing archive directory = warn-and-skip. CI environments without the
// dataset shouldn't hard-fail the seeder; LeagueService.upsertFixture
// auto-inserts new teams at min(elo) when the first INT fixture syncs.

const RECONCILE_MAP = require('./reconcileMap.json');

const INITIAL_RATING = eloMath.INITIAL_RATING; // 1500

// ---------------------------------------------------------------------------
// FIFA-style K-multiplier table. MIRROR of
// ml/scorecast_ml/ingest/international.py `_KMULT_TABLE` — both files cite
// each other; a change here MUST land alongside the Python table edit so
// the bootstrap walk and the trainer use identical weights.
// ---------------------------------------------------------------------------

const KMULT_TABLE = {
  // Tier 1 (×3.0) — World Cup finals.
  'FIFA World Cup': 3.0,
  // Tier 2 (×2.5) — WC qualifiers + continental finals.
  'FIFA World Cup qualification': 2.5,
  'UEFA Euro': 2.5,
  'Copa América': 2.5,
  'African Cup of Nations': 2.5,
  'AFC Asian Cup': 2.5,
  'Gold Cup': 2.5,
  'CONCACAF Championship': 2.5,
  'Oceania Nations Cup': 2.5,
  // Tier 3 (×2.0) — continental qualifiers + Nations League formats.
  'UEFA Euro qualification': 2.0,
  'African Cup of Nations qualification': 2.0,
  'AFC Asian Cup qualification': 2.0,
  'Gold Cup qualification': 2.0,
  'CONCACAF Championship qualification': 2.0,
  'UEFA Nations League': 2.0,
  'CONCACAF Nations League': 2.0,
  // Tier 4 (×1.5) — global tier-2 competitions.
  'Confederations Cup': 1.5,
  'FIFA Confederations Cup': 1.5,
  // Tier 5 (×1.0) — friendlies + everything not explicitly mapped above.
  Friendly: 1.0,
};

function deriveKMultiplier(tournament) {
  const t = String(tournament || '');
  if (KMULT_TABLE[t] !== undefined) return KMULT_TABLE[t];
  if (t.includes('Olympic')) return 1.5;
  return 1.0;
}

// Permissive canonicalize — identity fallback for unmapped names. Matches
// the Python cli.py `_canonicalize_frame(strict=False)` semantic.
function canonicalize(rawName) {
  const trimmed = String(rawName).trim();
  if (!trimmed) return trimmed;
  const aliases = (RECONCILE_MAP.INT && RECONCILE_MAP.INT.aliases) || {};
  return aliases[trimmed] || trimmed;
}

// ---------------------------------------------------------------------------
// Former-names date-windowed rewriter. Mirror of
// ml/scorecast_ml/ingest/international.py `apply_former_names` — reads the
// committed former_names.csv (current, former, start_date, end_date) and
// rewrites historical team names to their modern equivalents BEFORE Elo
// is calculated.
// ---------------------------------------------------------------------------

function parseDate(s) {
  // ISO YYYY-MM-DD (martj42 standard).
  const [y, m, d] = String(s)
    .split('-')
    .map((v) => parseInt(v, 10));
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
    throw new Error(`parseDate: bad ISO date ${JSON.stringify(s)}`);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

function loadFormerNames(csvPath) {
  if (!fs.existsSync(csvPath)) return [];
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',');
  const idx = {
    current: header.indexOf('current'),
    former: header.indexOf('former'),
    start: header.indexOf('start_date'),
    end: header.indexOf('end_date'),
  };
  if (idx.current < 0 || idx.former < 0 || idx.start < 0 || idx.end < 0) {
    throw new Error(`${csvPath}: missing current/former/start_date/end_date columns`);
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const current = (cells[idx.current] ?? '').trim();
    const former = (cells[idx.former] ?? '').trim();
    const startStr = (cells[idx.start] ?? '').trim();
    const endStr = (cells[idx.end] ?? '').trim();
    if (!current || !former || !startStr || !endStr) continue;
    try {
      rows.push({ current, former, start: parseDate(startStr), end: parseDate(endStr) });
    } catch {
      continue;
    }
  }
  return rows;
}

// Apply date-windowed rewrites to a single match row's team names. Returns
// the rewritten home/away pair (does NOT mutate input).
function rewriteNames(home, away, date, formerNames) {
  let h = home;
  let a = away;
  for (const rule of formerNames) {
    if (date >= rule.start && date <= rule.end) {
      if (h === rule.former) h = rule.current;
      if (a === rule.former) a = rule.current;
    }
  }
  return [h, a];
}

// ---------------------------------------------------------------------------
// Results CSV parser — single file, ISO date column, derives FTR from
// home_score vs away_score, drops future fixtures (literal 'NA' scores).
// ---------------------------------------------------------------------------

function parseResultsCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',');
  const idx = {
    date: header.indexOf('date'),
    home: header.indexOf('home_team'),
    away: header.indexOf('away_team'),
    homeScore: header.indexOf('home_score'),
    awayScore: header.indexOf('away_score'),
    tournament: header.indexOf('tournament'),
    neutral: header.indexOf('neutral'),
  };
  for (const [k, v] of Object.entries(idx)) {
    if (v < 0) {
      throw new Error(
        `${filePath}: missing required column "${k}". Got header: ${header.slice(0, 10).join(',')}...`,
      );
    }
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const dateStr = (cells[idx.date] ?? '').trim();
    const home = (cells[idx.home] ?? '').trim();
    const away = (cells[idx.away] ?? '').trim();
    const hsStr = (cells[idx.homeScore] ?? '').trim();
    const asStr = (cells[idx.awayScore] ?? '').trim();
    const tournament = (cells[idx.tournament] ?? '').trim();
    const neutralStr = (cells[idx.neutral] ?? '').trim().toUpperCase();
    if (!dateStr || !home || !away) continue;
    if (hsStr === '' || hsStr === 'NA' || asStr === '' || asStr === 'NA') continue;
    const hs = parseInt(hsStr, 10);
    const as = parseInt(asStr, 10);
    if (Number.isNaN(hs) || Number.isNaN(as)) continue;
    if (home === away) continue;
    let date;
    try {
      date = parseDate(dateStr);
    } catch {
      continue;
    }
    let ftr;
    if (hs > as) ftr = 'H';
    else if (hs < as) ftr = 'A';
    else ftr = 'D';
    rows.push({
      date,
      home,
      away,
      ftr,
      tournament,
      neutral: neutralStr === 'TRUE',
      kMultiplier: deriveKMultiplier(tournament),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Result code → eloMath.eloDelta result string.
// ---------------------------------------------------------------------------

function ftrToResult(ftr) {
  if (ftr === 'H') return 'home';
  if (ftr === 'A') return 'away';
  if (ftr === 'D') return 'draw';
  throw new Error(`ftrToResult: expected H/D/A, got ${JSON.stringify(ftr)}`);
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const archiveDir = path.join(__dirname, '..', 'international_match_archive');
    const resultsPath = path.join(archiveDir, 'results.csv');
    const formerNamesPath = path.join(archiveDir, 'former_names.csv');

    // Locate the WC league row (the meta-pool for international teams in V1).
    const [leagueRows] = await sequelize.query(
      `SELECT id FROM leagues WHERE "sourceProvider" = 'football-data.org' AND "sourceLeagueId" = 'WC' LIMIT 1`,
    );
    if (leagueRows.length === 0) {
      throw new Error(
        'seed-teams-from-intl-elo-history: WC league row missing from leagues table. Run migration 20260518000001-create-leagues first.',
      );
    }
    const wcLeagueId = leagueRows[0].id;

    if (!fs.existsSync(resultsPath)) {
      logger.warn(
        { resultsPath },
        'seed-teams-intl: international_match_archive/results.csv missing — skipping Elo bootstrap (LeagueService.upsertFixture will auto-insert at min(elo) when WC fixtures first sync)',
      );
      return;
    }

    const formerNames = loadFormerNames(formerNamesPath);
    const rows = parseResultsCsv(resultsPath);
    // Chronological order for batch_compute equivalence.
    rows.sort((x, y) => x.date - y.date);

    const state = new Map(); // canonicalName → { rating, gamesPlayed, lastMatchDate }
    let totalMatches = 0;
    let unknownTournamentRows = 0;

    for (const row of rows) {
      // Apply former-names rewrite first.
      const [homeAfterRewrite, awayAfterRewrite] = rewriteNames(
        row.home,
        row.away,
        row.date,
        formerNames,
      );
      // Permissive canonicalize (identity fallback for unmapped names).
      const home = canonicalize(homeAfterRewrite);
      const away = canonicalize(awayAfterRewrite);
      if (!home || !away || home === away) continue;

      // International model — promoted_team_strategy = "initial" (every
      // new nation enters at 1500, no min(current) bootstrap). Different
      // from PL which uses min(current) past season 1.
      if (!state.has(home)) {
        state.set(home, { rating: INITIAL_RATING, gamesPlayed: 0, lastMatchDate: null });
      }
      if (!state.has(away)) {
        state.set(away, { rating: INITIAL_RATING, gamesPlayed: 0, lastMatchDate: null });
      }

      const h = state.get(home);
      const a = state.get(away);

      // Call into lib/ml/eloMath.js directly — this is the SAME function
      // PredictionService uses for the runtime cascade, so the bootstrap
      // walk and the cascade are bit-identical on every match. Closes the
      // open-coded-math drift loophole the PL seeder is grandfathered into.
      const delta = eloMath.eloDelta(h.rating, a.rating, ftrToResult(row.ftr), {
        kMultiplier: row.kMultiplier,
        neutral: row.neutral,
      });
      h.rating = h.rating + delta.home;
      a.rating = a.rating + delta.away;
      h.gamesPlayed += 1;
      a.gamesPlayed += 1;
      h.lastMatchDate = row.date;
      a.lastMatchDate = row.date;
      totalMatches += 1;
      if (
        row.kMultiplier === 1.0 &&
        row.tournament &&
        row.tournament !== 'Friendly' &&
        !row.tournament.includes('Olympic')
      ) {
        unknownTournamentRows += 1;
      }
    }

    logger.info(
      {
        matches: totalMatches,
        teams: state.size,
        unknownTournamentRows,
        topTeam:
          state.size > 0
            ? [...state.entries()].reduce((best, cur) =>
                cur[1].rating > best[1].rating ? cur : best,
              )[0]
            : null,
      },
      'seed-teams-intl: Elo bootstrap walk complete',
    );

    if (state.size === 0) return;

    // Insert in a single INSERT with chunked VALUES — same pattern as PL
    // seeder. ON CONFLICT DO NOTHING preserves cascade-accumulated state.
    const inserts = [];
    for (const [name, s] of state) {
      inserts.push({
        name,
        leagueId: wcLeagueId,
        elo: s.rating.toFixed(2),
        gamesPlayed: s.gamesPlayed,
        lastMatchDate: s.lastMatchDate ? s.lastMatchDate.toISOString().slice(0, 10) : null,
      });
    }
    const valuesSql = inserts
      .map(
        (_, i) =>
          `(gen_random_uuid(), :name${i}, :leagueId${i}, :elo${i}, :gp${i}, :lmd${i}, NOW(), NOW())`,
      )
      .join(',');
    const replacements = {};
    inserts.forEach((row, i) => {
      replacements[`name${i}`] = row.name;
      replacements[`leagueId${i}`] = row.leagueId;
      replacements[`elo${i}`] = row.elo;
      replacements[`gp${i}`] = row.gamesPlayed;
      replacements[`lmd${i}`] = row.lastMatchDate;
    });

    await sequelize.query(
      `INSERT INTO teams (id, name, "leagueId", elo, "gamesPlayed", "lastMatchDate", "createdAt", "updatedAt")
       VALUES ${valuesSql}
       ON CONFLICT (name, "leagueId") DO NOTHING`,
      { replacements },
    );
    logger.info(
      { rows: inserts.length },
      'seed-teams-intl: upsert complete (ON CONFLICT DO NOTHING)',
    );
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query(
      `DELETE FROM teams WHERE "leagueId" IN (
         SELECT id FROM leagues
         WHERE "sourceProvider" = 'football-data.org' AND "sourceLeagueId" = 'WC'
       )`,
    );
  },
};
