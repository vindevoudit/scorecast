'use strict';

// Tier 4b Chunk 2 — daily fixture sync job. Iterates every active league
// (PL at launch; WC when an admin flips it on) and re-runs
// LeagueService.syncFixtures, which is idempotent — re-syncing pulls the
// latest kickoff / status / score for known fixtures without creating
// duplicates.
//
// A single league failure does NOT stop the rest: each league runs in
// its own try/catch. Errors are logged with the league name so the
// admin can act on persistent failures.

const { League } = require('../../models');
const footballApi = require('../footballApi');
const LeagueService = require('../../services/LeagueService');
const logger = require('../logger');

async function run() {
  if (!footballApi.isConfigured()) {
    logger.warn('syncFixtures: FOOTBALL_DATA_API_KEY not set, skipping');
    return { skipped: true, reason: 'unconfigured' };
  }
  const active = await League.findAll({
    where: { active: true },
    order: [['name', 'ASC']],
  });
  if (active.length === 0) {
    logger.info('syncFixtures: no active leagues, nothing to do');
    return { skipped: false, leagues: 0 };
  }
  logger.info({ count: active.length }, 'syncFixtures: starting daily sync');
  const summaries = [];
  for (const league of active) {
    try {
      const summary = await LeagueService.syncFixtures(league.id);
      logger.info({ league: league.name, ...summary }, 'syncFixtures: league synced');
      summaries.push({ league: league.name, ...summary });
    } catch (err) {
      logger.error(
        { err, leagueId: league.id, league: league.name },
        'syncFixtures: league sync failed',
      );
      summaries.push({ league: league.name, error: err.message });
    }
  }
  return { skipped: false, leagues: active.length, summaries };
}

module.exports = { run };
