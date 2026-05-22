'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

// Tier 17 — Elo bootstrap seeder. Replays the committed Football-Data.co.uk
// PL CSV history chronologically and writes each team's resulting Elo into
// the `teams` table. The runtime cascade in PredictionService.onResultCaptured
// then takes over for every subsequent result.
//
// Mirrors ml/scorecast_ml/elo/engine.py `batch_compute()` exactly so
// training (Python) and runtime (JS) share the same Elo state at handoff:
//  - K = 20, INITIAL = 1500, HFA = 0
//  - Per match: e_home = 1 / (1 + 10^((r_away - (r_home + HFA)) / 400))
//                r' = r + K * (actual - expected); actual ∈ {1, 0.5, 0}.
//  - Unseen team in season 1 → initial_rating (1500).
//  - Unseen team in season 2+ → min(current ratings)  ("min_rating"
//    promoted-team strategy — captures the empirical fact that promoted
//    sides underperform the bottom of the league they join).
//  - The min snapshot is taken BEFORE initializing either of THIS match's
//    teams — otherwise a brand-new home team's 1500 would influence its
//    own opponent's starting rating.
//
// Idempotency: `ON CONFLICT (name, leagueId) DO NOTHING` preserves the
// live Elo that the reactive cascade has built up since the initial seed.
// A re-run after live results is a no-op for existing teams; new teams
// (added by LeagueService.upsertFixture auto-insert) are left untouched.
//
// Empty raw/ dir = warn-and-skip. CI environments that don't ship the CSV
// corpus shouldn't hard-fail the seeder; LeagueService.upsertFixture will
// auto-insert teams at min(elo) the first time it sees them anyway.

const RECONCILE_MAP = require('./reconcileMap.json');

const K_FACTOR = 20;
const INITIAL_RATING = 1500;
const HFA = 0;

function expectedHomeScore(homeElo, awayElo) {
  return 1 / (1 + Math.pow(10, (awayElo - (homeElo + HFA)) / 400));
}

function actualScoresFromFtr(ftr) {
  if (ftr === 'H') return [1.0, 0.0];
  if (ftr === 'A') return [0.0, 1.0];
  if (ftr === 'D') return [0.5, 0.5];
  throw new Error(`actualScoresFromFtr: expected H/D/A, got ${JSON.stringify(ftr)}`);
}

function canonicalize(rawName) {
  const trimmed = String(rawName).trim();
  const mapped = RECONCILE_MAP.PL.aliases[trimmed];
  if (!mapped) {
    throw new Error(
      `reconcileMap.json: no PL alias for CSV team "${trimmed}". Add an entry under seeders/reconcileMap.json → PL.aliases (value should match what football-data.org's API sends — usually "<Club> FC" or similar).`,
    );
  }
  return mapped;
}

// Parse DD/MM/YYYY or DD/MM/YY into a UTC Date. Two-digit years in the
// 70–99 range → 19xx; 00–69 → 20xx. (Football-Data.co.uk has used DD/MM/YY
// historically and switched to DD/MM/YYYY around 2002.)
function parseCsvDate(s) {
  const parts = String(s).split('/');
  if (parts.length !== 3) throw new Error(`parseCsvDate: bad date ${JSON.stringify(s)}`);
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  let year = parseInt(parts[2], 10);
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
    throw new Error(`parseCsvDate: non-numeric ${JSON.stringify(s)}`);
  }
  if (parts[2].length === 2) year += year >= 70 ? 1900 : 2000;
  return new Date(Date.UTC(year, month - 1, day));
}

// Season-start year from the 4-char season code in the filename. "9394" →
// 1993, "9900" → 1999, "0001" → 2000, "2425" → 2024. Used to sort CSV
// files chronologically; alphabetical sort on the 4-char code would put
// 2000-era seasons BEFORE 1990s because of the two-digit-year wrap-around.
function seasonStartYear(seasonCode) {
  const yy = parseInt(seasonCode.slice(0, 2), 10);
  if (Number.isNaN(yy)) throw new Error(`seasonStartYear: bad code ${JSON.stringify(seasonCode)}`);
  return yy >= 70 ? 1900 + yy : 2000 + yy;
}

function parseCsv(filePath) {
  // FDCO CSVs are latin-1 encoded; readFileSync default is utf-8 which
  // mangles a small handful of historical team names with non-ASCII chars.
  const text = fs.readFileSync(filePath, 'latin1');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  // Strip BOM from the header line (some modern FDCO CSVs are exported
  // with a UTF-8 BOM even though the body is latin-1 — harmless legacy).
  const headerCells = lines[0].replace(/^\uFEFF/, '').split(',');
  const idx = {
    date: headerCells.indexOf('Date'),
    home: headerCells.indexOf('HomeTeam'),
    away: headerCells.indexOf('AwayTeam'),
    ftr: headerCells.indexOf('FTR'),
  };
  if (idx.date < 0 || idx.home < 0 || idx.away < 0 || idx.ftr < 0) {
    throw new Error(
      `${filePath}: missing one of Date/HomeTeam/AwayTeam/FTR (got: ${headerCells.slice(0, 10).join(',')}...)`,
    );
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    // Simple comma split is safe — Date/HomeTeam/AwayTeam/FTR never contain
    // embedded commas in FDCO data. Mid-season extra-column rows just have
    // extra trailing cells we ignore by indexing into the columns we want.
    const cells = lines[i].split(',');
    const dateStr = (cells[idx.date] ?? '').trim();
    const home = (cells[idx.home] ?? '').trim();
    const away = (cells[idx.away] ?? '').trim();
    const ftr = (cells[idx.ftr] ?? '').trim().toUpperCase();
    if (!dateStr || !home || !away || !ftr) continue;
    if (ftr !== 'H' && ftr !== 'D' && ftr !== 'A') continue;
    let date;
    try {
      date = parseCsvDate(dateStr);
    } catch {
      continue; // skip malformed dates (rare; trailing empty rows)
    }
    rows.push({ date, home, away, ftr });
  }
  return rows;
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const csvDir = path.join(__dirname, '..', 'ml', 'data', 'raw');

    // Locate the PL league row. Migration 20260518000001-create-leagues
    // must have run first (which is enforced by umzug's filename ordering).
    const [leagueRows] = await sequelize.query(
      `SELECT id FROM leagues WHERE "sourceProvider" = 'football-data.org' AND "sourceLeagueId" = 'PL' LIMIT 1`,
    );
    if (leagueRows.length === 0) {
      throw new Error(
        'seed-teams-from-elo-history: Premier League row missing from leagues table. Run migration 20260518000001-create-leagues first.',
      );
    }
    const plLeagueId = leagueRows[0].id;

    if (!fs.existsSync(csvDir)) {
      logger.warn(
        { csvDir },
        'seed-teams: ml/data/raw/ missing — skipping Elo bootstrap (auto-insert at min(elo) will populate teams at first fixture sync)',
      );
      return;
    }
    const files = fs
      .readdirSync(csvDir)
      .filter((f) => /^PL_\d{4}\.csv$/.test(f))
      .sort((a, b) => seasonStartYear(a.slice(3, 7)) - seasonStartYear(b.slice(3, 7)));
    if (files.length === 0) {
      logger.warn({ csvDir }, 'seed-teams: no PL_*.csv files found — skipping Elo bootstrap');
      return;
    }

    // Walk seasons in chronological order. Each file = one season; that's
    // why the file-level loop drives the "past first season" boundary.
    const state = new Map(); // canonicalName → { rating, gamesPlayed, lastMatchDate }
    let seasonIndex = 0;
    let totalMatches = 0;

    for (const file of files) {
      const filePath = path.join(csvDir, file);
      const rows = parseCsv(filePath);
      // Within-season chronological sort (FDCO files are mostly ordered
      // but a few have out-of-sequence replayed/rescheduled rows).
      rows.sort((a, b) => a.date - b.date);

      for (const row of rows) {
        let home;
        let away;
        try {
          home = canonicalize(row.home);
          away = canonicalize(row.away);
        } catch (err) {
          // Loud-fail on unmapped team — matches the Python pipeline's
          // strict behavior. Better to abort the seeder than silently
          // drop a club's history.
          logger.error(
            { err, file, row },
            'seed-teams: unmapped CSV team — aborting bootstrap so the alias gap surfaces immediately',
          );
          throw err;
        }

        // Snapshot the min rating BEFORE either team is initialized for
        // this match. Past season 1 → use min(current); season 1 → 1500.
        let startingRating = INITIAL_RATING;
        if (seasonIndex > 0 && state.size > 0) {
          let min = Infinity;
          for (const s of state.values()) if (s.rating < min) min = s.rating;
          startingRating = min;
        }

        if (!state.has(home)) {
          state.set(home, { rating: startingRating, gamesPlayed: 0, lastMatchDate: null });
        }
        if (!state.has(away)) {
          state.set(away, { rating: startingRating, gamesPlayed: 0, lastMatchDate: null });
        }

        const h = state.get(home);
        const a = state.get(away);
        const eh = expectedHomeScore(h.rating, a.rating);
        const ea = 1 - eh;
        const [actH, actA] = actualScoresFromFtr(row.ftr);
        h.rating = h.rating + K_FACTOR * (actH - eh);
        a.rating = a.rating + K_FACTOR * (actA - ea);
        h.gamesPlayed += 1;
        a.gamesPlayed += 1;
        h.lastMatchDate = row.date;
        a.lastMatchDate = row.date;
        totalMatches += 1;
      }
      seasonIndex += 1;
    }

    logger.info(
      { matches: totalMatches, seasons: files.length, teams: state.size },
      'seed-teams: Elo bootstrap walk complete',
    );

    // Insert in chunks to keep the SQL statement size reasonable; ~50
    // teams × ~6 columns is well under any limit but stay defensive.
    const inserts = [];
    for (const [name, s] of state) {
      inserts.push({
        name,
        leagueId: plLeagueId,
        elo: s.rating.toFixed(2),
        gamesPlayed: s.gamesPlayed,
        lastMatchDate: s.lastMatchDate ? s.lastMatchDate.toISOString().slice(0, 10) : null,
      });
    }
    if (inserts.length === 0) return;

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
    logger.info({ rows: inserts.length }, 'seed-teams: upsert complete (ON CONFLICT DO NOTHING)');
  },

  // Reverse: delete only PL bootstrap rows. Won't be perfectly idempotent
  // if a non-PL league shares this teams table — but the table is scoped
  // by leagueId so we're safe to target by league.
  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query(
      `DELETE FROM teams WHERE "leagueId" IN (
         SELECT id FROM leagues
         WHERE "sourceProvider" = 'football-data.org' AND "sourceLeagueId" = 'PL'
       )`,
    );
  },
};
