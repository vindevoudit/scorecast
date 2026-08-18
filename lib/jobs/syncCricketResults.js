'use strict';

// CPL auto-results — the job that removes the manual admin form from the loop.
//
// COST GATE FIRST, ALWAYS. Azure Container Apps Consumption bills per
// vCPU-second of active work, and the free CricAPI tier is 100 hits/day, so
// every check that can rule the tick out runs BEFORE any outbound call — same
// discipline as syncLiveScores' `no-relevant-games` gate. Outside the roughly
// two-hour window after a CPL match should have finished, this job does one
// cheap COUNT and returns.
//
// ONE ENDPOINT FOR THE WHOLE COMPETITION. `series_info` returns all 39 matches
// in a single hit; per-match `match_info` would be 39x the budget for the same
// data, and is only used as a fallback when a finished match's series entry
// arrives without a usable scorecard.
//
// BUDGET IN PRACTICE. A match day opens the gate ~2h after kickoff and closes
// it the moment capture succeeds (resultSource is no longer NULL, so the COUNT
// drops to zero) — roughly a dozen hits. A doubleheader is two windows. The
// pathological case is a match the provider never marks ended, which holds the
// gate open for the full 12h lookback; lib/cricketApi.js's daily budget cap is
// what bounds that.

const { League } = require('../../models');
const cricketApi = require('../cricketApi');
const CricketProviderService = require('../../services/CricketProviderService');
const logger = require('../logger');
const { CRICKET } = require('../sports');

function seriesId() {
  return process.env.CRICAPI_SERIES_ID || '';
}

async function run() {
  if (!cricketApi.isConfigured()) return { skipped: true, reason: 'unconfigured' };
  if (!seriesId()) return { skipped: true, reason: 'no-series-id' };

  // Symmetric to the three football jobs' `sport: FOOTBALL` filter — a football
  // league can never reach the cricket provider and vice versa.
  const active = await League.findAll({ where: { active: true, sport: CRICKET } });
  if (active.length === 0) return { skipped: true, reason: 'no-active-leagues' };

  const leagueIds = active.map((l) => l.id);
  const eligible = await CricketProviderService.countEligibleGames(leagueIds);
  if (eligible === 0) return { skipped: true, reason: 'no-finishing-games' };

  let providerMatches;
  try {
    providerMatches = await cricketApi.getSeriesMatches(seriesId());
  } catch (err) {
    if (err.statusCode === 429 || err.code === 'cricket_api_rate_limit') {
      // Budget exhausted. Info, not warn — the next tick retries, and on the
      // free tier this is an expected daily boundary rather than a fault.
      logger.info({ err: err.message }, 'syncCricketResults: rate-limited, skipping tick');
      return { skipped: true, reason: 'rate-limited' };
    }
    logger.warn({ err: err.message }, 'syncCricketResults: failed to fetch series');
    return { skipped: true, reason: 'upstream-error' };
  }

  const byProviderId = new Map(
    providerMatches.filter((m) => m.providerMatchId).map((m) => [m.providerMatchId, m]),
  );

  const games = await CricketProviderService.listEligibleGames(leagueIds);
  const leagueCodeById = new Map(active.map((l) => [l.id, l.sourceLeagueId]));

  let written = 0;
  let shadowed = 0;
  let refused = 0;
  let unmapped = 0;

  for (const game of games) {
    // Resolution is the daily job's responsibility; a game without a stamped id
    // simply isn't ready. Counted so the summary shows why nothing happened.
    if (!game.providerMatchId) {
      unmapped += 1;
      continue;
    }

    let providerMatch = byProviderId.get(String(game.providerMatchId));
    if (!providerMatch) {
      unmapped += 1;
      continue;
    }

    // MEASURED 2026-08-10 against the live CPL payload: `series_info`'s
    // matchList NEVER carries `score[]` — 9 ended matches, 0 with innings. So
    // this is not a rare fallback, it is the scorecard path, and every capture
    // costs one extra hit. Still cheap (a match day is ~12 gated ticks x 1 hit
    // plus 1 match_info, and the game leaves the eligible set the moment it is
    // captured), but the gate above is what keeps it that way. Guarded on
    // matchEnded so an in-progress match never spends the hit.
    if (providerMatch.matchEnded && providerMatch.innings.length === 0) {
      try {
        const detailed = await cricketApi.getMatchInfo(providerMatch.providerMatchId);
        if (detailed) providerMatch = detailed;
      } catch (err) {
        logger.info(
          { err: err.message, gameId: game.id },
          'syncCricketResults: match_info fallback unavailable',
        );
      }
    }

    try {
      const outcome = await CricketProviderService.applyProviderResult({
        game,
        providerMatch,
        leagueCode: leagueCodeById.get(game.leagueId),
      });
      if (outcome.written) written += 1;
      else if (outcome.reason === 'shadow') shadowed += 1;
      else if (outcome.reason !== 'not-finished') refused += 1;
    } catch (err) {
      // One bad match must never abort the rest of the tick.
      logger.error(
        { err: err.message, gameId: game.id, sourceId: game.sourceId },
        'syncCricketResults: failed to apply provider result',
      );
    }
  }

  const summary = {
    eligible: games.length,
    written,
    shadowed,
    refused,
    unmapped,
    writeEnabled: CricketProviderService.writeEnabled(),
    budget: cricketApi.budgetStatus(),
  };
  if (written > 0 || shadowed > 0 || refused > 0) {
    logger.info(summary, 'syncCricketResults: tick complete');
  }
  return summary;
}

module.exports = { run };
