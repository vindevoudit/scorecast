#!/usr/bin/env node
//
// Import a cricket fixture schedule from a JSON file.
//
//   node scripts/import-cricket-fixtures.mjs data/cpl-2026-fixtures.json [--dry-run] [--activate]
//
// There is no cricket fixture feed in scope, so the schedule is a committed
// data file (see data/cpl-2026-fixtures.json for the expected shape) and
// results are entered by hand through the admin panel. If a provider is wired
// later it can emit the same shape and reuse this importer unchanged.
//
// Idempotent: upserts on (leagueId, sourceId), so re-running after a schedule
// change updates kickoff times and matchups without duplicating anything.
//
// ASCII-ONLY STDOUT. The Azure CLI hardcodes cp1252 in its `az containerapp
// exec` stdout decoder; a single non-cp1252 character (an em dash, an accent
// in a venue name) crashes its reader thread and kills the connection
// mid-operation. Every line printed here is folded to ASCII, and the team
// names in the data file legitimately contain "&" and accented spellings.
// See the "Azure CLI cp1252 crash" invariant in CLAUDE.md.

import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { Sequelize } from 'sequelize';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const activate = args.includes('--activate');
const fileArg = args.find((a) => !a.startsWith('--'));

// Fold anything non-ASCII so the Azure CLI's cp1252 decoder cannot choke.
function toAscii(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\n]/g, '');
}
const say = (msg) => process.stdout.write(`${toAscii(msg)}\n`);
const die = (msg) => {
  process.stderr.write(`${toAscii(msg)}\n`);
  process.exit(1);
};

if (!fileArg) die('Usage: node scripts/import-cricket-fixtures.mjs <schedule.json> [--dry-run] [--activate]');

const filePath = path.resolve(process.cwd(), fileArg);
if (!fs.existsSync(filePath)) die(`Schedule file not found: ${filePath}`);

const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const { league, season, fixtures } = doc;
if (!league?.sourceLeagueId) die('Schedule file is missing league.sourceLeagueId');
if (!Array.isArray(fixtures) || fixtures.length === 0) die('Schedule file has no fixtures');

// Validate the whole file before touching the database, and report EVERY
// problem at once — a half-imported schedule is worse than none.
const problems = [];
const seenSourceIds = new Set();
for (const [i, f] of fixtures.entries()) {
  const at = `fixture[${i}]${f.sourceId ? ` (${f.sourceId})` : ''}`;
  // sourceId is the idempotency key. games_league_source_unique is PARTIAL
  // (WHERE "sourceId" IS NOT NULL), so a null does NOT dedupe — a re-import
  // would silently create a duplicate fixture carrying its own picks.
  if (!f.sourceId) problems.push(`${at}: missing sourceId (required as the import idempotency key)`);
  else if (seenSourceIds.has(f.sourceId)) problems.push(`${at}: duplicate sourceId within the file`);
  else seenSourceIds.add(f.sourceId);

  if (!f.home || !f.away) problems.push(`${at}: missing home or away team`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) problems.push(`${at}: date must be YYYY-MM-DD`);
  if (!/^\d{2}:\d{2}$/.test(f.time || '')) problems.push(`${at}: time must be HH:MM (venue local)`);
  if (!Number.isInteger(f.utcOffset)) problems.push(`${at}: utcOffset must be an integer`);
}
if (problems.length) {
  die(`Schedule file has ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
}

// Local wall-clock at the venue -> UTC instant. Written arithmetically rather
// than with a timezone library because every Caribbean venue is a fixed offset
// with no DST, and the offset is stated per fixture in the data file.
function toUtc(dateStr, timeStr, utcOffset) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - utcOffset, mm, 0, 0));
}

const url = process.env.DATABASE_URL;
if (!url) die('DATABASE_URL not set in env');
const s = new Sequelize(
  url,
  url.includes('sslmode=require')
    ? {
        dialect: 'postgres',
        dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
        logging: false,
      }
    : { logging: false },
);

let created = 0;
let updated = 0;

try {
  say(`Schedule: ${fixtures.length} fixtures from ${path.basename(filePath)}`);
  say(`League:   ${league.name} (${league.sourceProvider || 'manual'}/${league.sourceLeagueId})`);
  say(`Sport:    ${league.sport || 'cricket'}`);
  if (dryRun) say('MODE:     dry run - nothing will be written');

  // --- League -------------------------------------------------------------
  const [existingLeague] = await s.query(
    `SELECT id, sport, active FROM leagues WHERE "sourceProvider" = :provider AND "sourceLeagueId" = :code`,
    {
      replacements: {
        provider: league.sourceProvider || 'manual',
        code: league.sourceLeagueId,
      },
      type: Sequelize.QueryTypes.SELECT,
    },
  );

  let leagueId = existingLeague?.id;
  if (existingLeague) {
    say(`League exists: ${leagueId} (sport=${existingLeague.sport}, active=${existingLeague.active})`);
    // leagues.sport is immutable by design (games denormalise it at insert,
    // so flipping it would orphan every existing game on the old market).
    if (existingLeague.sport !== (league.sport || 'cricket')) {
      die(
        `League ${leagueId} is sport='${existingLeague.sport}' but the file says ` +
          `'${league.sport || 'cricket'}'. Sport is immutable - fix the file or the league row.`,
      );
    }
  } else if (dryRun) {
    say('League would be CREATED');
    leagueId = '<new>';
  } else {
    const [rows] = await s.query(
      `INSERT INTO leagues (id, name, sport, "sourceProvider", "sourceLeagueId", country, active, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), :name, :sport, :provider, :code, :country, :active, NOW(), NOW())
       RETURNING id`,
      {
        replacements: {
          name: league.name,
          sport: league.sport || 'cricket',
          provider: league.sourceProvider || 'manual',
          code: league.sourceLeagueId,
          country: league.country || null,
          // Default INACTIVE. `active` gates the four football cron jobs, and
          // although they now also filter on sport, leaving a manual league
          // inactive is the belt-and-braces position: nothing schedulable can
          // reach a league with no upstream feed. --activate opts in.
          active: activate,
        },
      },
    );
    leagueId = rows[0].id;
    say(`League CREATED: ${leagueId}`);
  }

  // --- Season -------------------------------------------------------------
  // Load-bearing. UserScoreService.applyDelta THROWS when seasonId is falsy,
  // so a season-less import looks completely fine right up until the first
  // result on a game somebody picked, at which point setResult fails inside
  // its transaction and the result never lands. On a match night.
  const year = season?.year || Number(fixtures[0].date.slice(0, 4));
  let seasonId;
  if (dryRun && leagueId === '<new>') {
    seasonId = '<new>';
    say(`Season ${year} would be CREATED`);
  } else {
    const [seasonRows] = await s.query(
      `INSERT INTO seasons (id, "leagueId", year, current, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), :leagueId, :year, :current, NOW(), NOW())
       ON CONFLICT ("leagueId", year) DO UPDATE SET "updatedAt" = NOW()
       RETURNING id`,
      { replacements: { leagueId, year, current: season?.current ?? true } },
    );
    seasonId = seasonRows[0].id;
    say(`Season ${year}: ${seasonId}`);
  }
  if (!seasonId) die('Failed to resolve a seasonId - refusing to import games without one');

  // --- Fixtures -----------------------------------------------------------
  for (const f of fixtures) {
    const kickoff = toUtc(f.date, f.time, f.utcOffset);
    const label = `${f.sourceId} ${f.home} v ${f.away}`;

    if (dryRun) {
      say(`  would upsert: ${label} @ ${kickoff.toISOString()}`);
      continue;
    }

    const [rows] = await s.query(
      `INSERT INTO games (
         id, "homeTeam", "awayTeam", date, "leagueId", "seasonId", "sourceId",
         sport, status, stage,
         "homeProbability", "drawProbability", "awayProbability"
       )
       VALUES (
         gen_random_uuid(), :home, :away, :date, :leagueId, :seasonId, :sourceId,
         :sport, 'scheduled', :stage,
         0.50, 0.00, 0.50
       )
       ON CONFLICT ("leagueId", "sourceId") WHERE "sourceId" IS NOT NULL
       DO UPDATE SET
         "homeTeam" = EXCLUDED."homeTeam",
         "awayTeam" = EXCLUDED."awayTeam",
         date       = EXCLUDED.date,
         stage      = EXCLUDED.stage,
         "seasonId" = EXCLUDED."seasonId"
       RETURNING (xmax = 0) AS inserted`,
      {
        replacements: {
          home: f.home,
          away: f.away,
          date: kickoff,
          leagueId,
          seasonId,
          sourceId: f.sourceId,
          // Denormalised from the league. No FK enforces it, so every writer
          // must stamp it.
          sport: league.sport || 'cricket',
          stage: f.stage || null,
        },
      },
    );
    // Probabilities are written on INSERT only and never updated. Cricket's
    // winner leg is a flat +50, so they are inert for scoring; they exist
    // because the columns are NOT NULL.
    if (rows[0].inserted) created += 1;
    else updated += 1;
  }

  say('');
  say(dryRun ? `Dry run OK: ${fixtures.length} fixtures validated` : `Created ${created}, updated ${updated}`);
  if (!dryRun && !activate && !existingLeague) {
    say('League is INACTIVE. Fixtures are visible and pickable regardless -');
    say('active only gates the football cron jobs. Re-run with --activate to flip it.');
  }
} catch (err) {
  die(`Import failed: ${err.message}`);
} finally {
  await s.close();
}
