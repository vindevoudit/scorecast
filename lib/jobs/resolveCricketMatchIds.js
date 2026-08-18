'use strict';

// CPL auto-results — daily reconciliation of local fixtures to provider match
// ids, plus the operator alarms.
//
// WHY THIS IS A SEPARATE, DAILY JOB
// ---------------------------------
// Resolution is where the two failure modes that need HUMAN action show up: a
// team-name mismatch that needs an alias committed, and a playoff row still
// carrying "Winner of Qualifier 1" that needs renaming. Both take a redeploy or
// an admin edit, so discovering them at the moment of the match is too late.
// Running once a day, well ahead of kickoff, buys the lead time to fix them.
//
// It costs exactly one API hit, and only when there is something unresolved.
//
// THE THREE ALARMS
//   unresolved       - name mismatch; add an alias (the warn names both sides)
//   placeholders     - playoff row needs renaming before it can ever capture
//   needsManualEntry - the automation has given up; type it into the admin form
//   stranded         - a crash in CricketResultService's two-transaction seam
//                      left a scorecard written with points unapplied

const { Op } = require('sequelize');
const { League, Game } = require('../../models');
const cricketApi = require('../cricketApi');
const CricketProviderService = require('../../services/CricketProviderService');
const logger = require('../logger');
const { CRICKET } = require('../sports');

// How far ahead a placeholder playoff row starts being urgent.
const PLACEHOLDER_WARN_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

function seriesId() {
  return process.env.CRICAPI_SERIES_ID || '';
}

async function countNeedsManualEntry(leagueIds, now) {
  return Game.count({
    where: {
      leagueId: { [Op.in]: leagueIds },
      sport: CRICKET,
      result: null,
      resultSource: null,
      status: { [Op.notIn]: ['finished', 'cancelled', 'postponed'] },
      date: { [Op.lt]: new Date(now - CricketProviderService.CAPTURE_LOOKBACK_MS) },
    },
  });
}

// A scorecard committed but the result never applied — the documented seam in
// CricketResultService, previously only reachable mid-click by a human and now
// reachable from a cron tick. Recovery is re-submitting via the admin form,
// which is idempotent.
async function findStranded(leagueIds) {
  return Game.findAll({
    where: {
      leagueId: { [Op.in]: leagueIds },
      sport: CRICKET,
      resultSource: 'auto',
      result: null,
      homeScore: { [Op.ne]: null },
    },
    attributes: ['id', 'sourceId', 'homeTeam', 'awayTeam', 'date'],
  });
}

async function run() {
  if (!cricketApi.isConfigured()) return { skipped: true, reason: 'unconfigured' };
  if (!seriesId()) return { skipped: true, reason: 'no-series-id' };

  const active = await League.findAll({ where: { active: true, sport: CRICKET } });
  if (active.length === 0) return { skipped: true, reason: 'no-active-leagues' };

  const now = Date.now();
  const leagueIds = active.map((l) => l.id);

  const unresolvedCount = await Game.count({
    where: { leagueId: { [Op.in]: leagueIds }, sport: CRICKET, providerMatchId: null },
  });

  const stranded = await findStranded(leagueIds);
  for (const game of stranded) {
    logger.error(
      {
        gameId: game.id,
        sourceId: game.sourceId,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
      },
      'resolveCricketMatchIds: STRANDED game — scorecard written but result unapplied; re-submit via the admin cricket form',
    );
  }

  if (unresolvedCount === 0) {
    const needsManualEntry = await countNeedsManualEntry(leagueIds, now);
    return {
      skipped: true,
      reason: 'all-resolved',
      needsManualEntry,
      stranded: stranded.length,
    };
  }

  let providerMatches;
  try {
    providerMatches = await cricketApi.getSeriesMatches(seriesId());
  } catch (err) {
    if (err.statusCode === 429 || err.code === 'cricket_api_rate_limit') {
      logger.info({ err: err.message }, 'resolveCricketMatchIds: rate-limited, skipping');
      return { skipped: true, reason: 'rate-limited' };
    }
    logger.warn({ err: err.message }, 'resolveCricketMatchIds: failed to fetch series');
    return { skipped: true, reason: 'upstream-error' };
  }

  let stamped = 0;
  let unresolved = 0;
  let placeholders = 0;

  for (const league of active) {
    const outcome = await CricketProviderService.resolveMatchIds({
      league,
      providerMatches,
      now,
    });
    stamped += outcome.stamped;

    for (const row of outcome.unresolved) {
      if (row.reason !== 'placeholder-teams') {
        unresolved += 1;
        continue;
      }
      placeholders += 1;
      // Only shout about the ones that are imminent. A placeholder Final in six
      // weeks is expected; one in six days is an action item.
      const kickoffMs = new Date(row.kickoff).getTime();
      if (Number.isFinite(kickoffMs) && kickoffMs - now <= PLACEHOLDER_WARN_HORIZON_MS) {
        logger.warn(
          { gameId: row.gameId, sourceId: row.sourceId, stage: row.stage, kickoff: row.kickoff },
          'resolveCricketMatchIds: playoff game still has placeholder team names — rename it in the admin game editor or its result will NOT auto-capture',
        );
      }
    }
  }

  const needsManualEntry = await countNeedsManualEntry(leagueIds, now);
  const summary = {
    stamped,
    unresolved,
    placeholders,
    needsManualEntry,
    stranded: stranded.length,
    budget: cricketApi.budgetStatus(),
  };
  logger.info(summary, 'resolveCricketMatchIds: reconciliation complete');
  return summary;
}

module.exports = { run, PLACEHOLDER_WARN_HORIZON_MS };
