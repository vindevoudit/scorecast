#!/usr/bin/env node
//
// CPL auto-results — read-only dry run against the live cricket provider.
//
//   node scripts/cricket-provider-report.mjs --find-series "Caribbean Premier League"
//   node scripts/cricket-provider-report.mjs
//   node scripts/cricket-provider-report.mjs --match CPL2026-M07
//
// This script NEVER writes. It exists to answer the three questions you have
// before trusting the automation:
//
//   1. What is the series id?            (--find-series, run once)
//   2. Does every fixture resolve to a provider match, and if not, which team
//      name is the provider using?       (default mode -> the alias entries you
//                                         need for data/cricket-team-aliases.json)
//   3. For a match that has finished, what EXACTLY would the job write, and
//      does it satisfy cricketResultSchema?
//
// ASCII-ONLY STDOUT. The Azure CLI hardcodes cp1252 in its `az containerapp
// exec` stdout decoder; one non-cp1252 character (an accent in a venue name,
// an em dash) crashes its reader thread and kills the connection mid-run. CPL
// team names legitimately contain "&", and venues carry accents. See the
// "Azure CLI cp1252 crash" invariant in CLAUDE.md.

import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function toAscii(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\n]/g, '');
}
const say = (msg = '') => process.stdout.write(`${toAscii(msg)}\n`);
const die = (msg) => {
  process.stderr.write(`${toAscii(msg)}\n`);
  process.exit(1);
};

const args = process.argv.slice(2);
const findSeriesIdx = args.indexOf('--find-series');
const matchIdx = args.indexOf('--match');
const findSeriesQuery = findSeriesIdx >= 0 ? args[findSeriesIdx + 1] : null;
const matchSourceId = matchIdx >= 0 ? args[matchIdx + 1] : null;
// series_info NEVER carries score[] (measured against the live CPL payload), so
// showing what the job would write REQUIRES one match_info hit per finished
// match. That is the whole point of the report, so it is the default; --quick
// skips it when you only care about resolution, and --match narrows it to one.
const quick = args.includes('--quick');

// Spacing between match_info fetches, sized to stay under the client's own
// per-minute window rather than CricAPI's (which is far more generous).
const PACE_MS = 7000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let detailFetches = 0;
let rateLimited = 0;

const cricketApi = require('../lib/cricketApi');
const { resolveMatches, buildCricketResultPayload } = require('../lib/cricketResult');
const { canonicalTeamName } = require('../lib/cricketTeamNames');
const { cricketResultSchema } = require('../validation/schemas');
const { CRICKET } = require('../lib/sports');

if (!cricketApi.isConfigured()) die('CRICAPI_API_KEY is not set. Nothing to query.');

function printBudget() {
  const b = cricketApi.budgetStatus();
  say('');
  say(
    `Budget: provider hitsToday=${b.hitsToday ?? '?'} / ${b.hitsLimit ?? '?'} ` +
      `| local=${b.localHitsToday}/${b.localBudget} | per-min available=${b.perMinuteAvailable}`,
  );
}

// --- Mode 1: discover the series id -----------------------------------------
if (findSeriesQuery) {
  const results = await cricketApi.findSeries(findSeriesQuery);
  if (results.length === 0) {
    say(`No series matched "${findSeriesQuery}".`);
    say("If CPL is genuinely absent from this provider, STOP - see the plan's Step 0 fallbacks.");
  }
  say(`Series matching "${findSeriesQuery}":`);
  say('');
  for (const s of results) {
    say(`  id       : ${s.id}`);
    say(`  name     : ${s.name}`);
    say(`  window   : ${s.startDate || '?'} -> ${s.endDate || '?'}   matches=${s.matches ?? '?'}`);
    say('');
  }
  say('Set the right one as CRICAPI_SERIES_ID.');
  printBudget();
  process.exit(0);
}

// --- Modes 2 and 3: reconcile local fixtures against the provider ------------
const seriesId = process.env.CRICAPI_SERIES_ID;
if (!seriesId)
  die('CRICAPI_SERIES_ID is not set. Run with --find-series "Caribbean Premier League" first.');

const { League, Game, sequelize } = require('../models');

const leagues = await League.findAll({ where: { sport: CRICKET } });
if (leagues.length === 0) die('No cricket leagues in this database.');

const providerMatches = await cricketApi.getSeriesMatches(seriesId);
say(`Provider returned ${providerMatches.length} matches for series ${seriesId}.`);

for (const league of leagues) {
  const games = await Game.findAll({
    where: { leagueId: league.id, sport: CRICKET },
    order: [['date', 'ASC']],
  });
  say('');
  say(`=== ${league.name} (${league.sourceLeagueId}) - ${games.length} local fixtures ===`);

  const { resolved, unresolved } = resolveMatches(games, providerMatches, {
    leagueCode: league.sourceLeagueId,
  });
  const resolvedByGame = new Map(resolved.map((r) => [r.gameId, r.providerMatchId]));
  const unresolvedByGame = new Map(unresolved.map((r) => [r.gameId, r]));
  const providerById = new Map(providerMatches.map((m) => [m.providerMatchId, m]));

  for (const game of games) {
    const providerMatchId = game.providerMatchId || resolvedByGame.get(game.id) || null;
    const miss = unresolvedByGame.get(game.id);
    const kickoff = new Date(game.date).toISOString().replace('T', ' ').slice(0, 16);
    const stamped = game.providerMatchId ? 'stamped' : providerMatchId ? 'resolves' : 'UNRESOLVED';

    say('');
    say(`[${game.sourceId}] ${game.homeTeam} vs ${game.awayTeam}`);
    say(
      `   kickoff ${kickoff}Z | status=${game.status} | resultSource=${game.resultSource || '-'}`,
    );
    say(
      `   ${stamped}${providerMatchId ? ` -> ${providerMatchId}` : ''}${miss ? ` (${miss.reason})` : ''}`,
    );

    if (!providerMatchId) {
      if (miss?.reason === 'no-candidate') {
        // The whole point of this script: surface the provider's spelling next
        // to ours so the alias entry can be written in one pass.
        const sameDay = providerMatches.filter((m) => {
          const when = m.dateTimeGMT ? new Date(m.dateTimeGMT).getTime() : NaN;
          return Number.isFinite(when) && Math.abs(when - new Date(game.date).getTime()) < 864e5;
        });
        for (const cand of sameDay) {
          say(`   provider nearby: "${cand.teams?.[0]}" vs "${cand.teams?.[1]}"`);
          for (const t of cand.teams || []) {
            say(`      normalised: "${canonicalTeamName(t, league.sourceLeagueId)}"`);
          }
        }
        if (sameDay.length === 0) say('   provider has no match near this kickoff at all');
      }
      continue;
    }

    let providerMatch = providerById.get(String(providerMatchId));
    if (!providerMatch) {
      say('   provider match id is stamped but absent from the current series payload');
      continue;
    }

    // One match_info hit to get the scorecard series_info never includes.
    // Bounded to finished matches so an unplayed fixture never costs a hit.
    const wantDetail =
      !quick &&
      providerMatch.matchEnded &&
      providerMatch.innings.length === 0 &&
      (!matchSourceId || game.sourceId === matchSourceId);
    if (wantDetail) {
      // Pace against the client's own per-minute window (CRICAPI_RATE_LIMIT,
      // default 10). The job never needs this — it fetches at most a match or
      // two per tick — but this report walks a whole season in one go and would
      // otherwise 429 itself around the eighth match.
      if (detailFetches > 0) await sleep(PACE_MS);
      detailFetches += 1;
      try {
        const detailed = await cricketApi.getMatchInfo(providerMatch.providerMatchId);
        if (detailed) providerMatch = detailed;
        say('   (+1 hit: fetched match_info for the scorecard)');
      } catch (err) {
        // Degrade, never crash: an operator wants the rest of the report even
        // if the budget ran out partway.
        rateLimited += 1;
        say(`   (scorecard unavailable: ${err.code || err.message})`);
      }
    }

    say(`   provider status: "${providerMatch.statusText}" (ended=${providerMatch.matchEnded})`);

    const built = buildCricketResultPayload(game, providerMatch, {
      leagueCode: league.sourceLeagueId,
    });
    if (!built.ok) {
      say(
        `   WOULD NOT WRITE: ${built.reason}${built.detail ? ` (${JSON.stringify(built.detail)})` : ''}`,
      );
      continue;
    }
    const parsed = cricketResultSchema.safeParse(built.payload);
    const p = built.payload;
    say(
      `   WOULD WRITE result=${p.result === null ? 'NO RESULT' : p.result} (basis=${built.notes.basis})`,
    );
    say(`      home ${p.home.runs}/${p.home.wickets} in ${p.home.overs} allOut=${p.home.allOut}`);
    say(`      away ${p.away.runs}/${p.away.wickets} in ${p.away.overs} allOut=${p.away.allOut}`);
    say(
      `      schema: ${parsed.success ? 'VALID' : `INVALID ${JSON.stringify(parsed.error.issues)}`}`,
    );
    if (built.notes.warn) say(`      warn: ${built.notes.warn}`);
    // Surfaced because it means a provider label was malformed and the side was
    // deduced rather than read — worth an operator's eye on the first occurrence.
    if (built.notes.mapping) say(`      note: ${built.notes.mapping}`);
  }

  const placeholders = unresolved.filter((u) => u.reason === 'placeholder-teams').length;
  const misses = unresolved.length - placeholders;
  say('');
  say(
    `Summary for ${league.sourceLeagueId}: ${games.length} fixtures, ` +
      `${resolved.length + games.filter((g) => g.providerMatchId).length} resolved, ` +
      `${misses} unresolved, ${placeholders} awaiting playoff seeding.`,
  );
  if (rateLimited > 0) {
    say(
      `NOTE: ${rateLimited} scorecard fetch(es) were rate-limited. Re-run to see them, ` +
        `or raise CRICAPI_RATE_LIMIT.`,
    );
  }
}

printBudget();
await sequelize.close();
