'use strict';

// Tier 4b Chunk 2 — live-score sync job. Once-per-minute single global
// poll: `GET /matches?status=LIVE&status=IN_PLAY&status=PAUSED` returns
// every in-progress match across every entitled competition in ONE API
// call. We filter to our active-league competition codes and route each
// match to GameService.applyLiveUpdate.
//
// Cost: 1 req/min steady state, regardless of how many leagues we
// track or how many matches are live at once. Easily fits the 10 req/min
// free-tier budget.
//
// Unknown sourceIds are silently skipped — they belong to matches we
// haven't synced yet (e.g. a league an admin added but hasn't manually
// synced). The next daily fixture sync will pick them up.

const { League, Game } = require('../../models');
const footballApi = require('../footballApi');
const GameService = require('../../services/GameService');
const logger = require('../logger');

async function run() {
  if (!footballApi.isConfigured()) {
    return { skipped: true, reason: 'unconfigured' };
  }
  const active = await League.findAll({ where: { active: true } });
  if (active.length === 0) {
    return { skipped: true, reason: 'no-active-leagues' };
  }

  const codeToLeagueId = new Map();
  for (const l of active) {
    codeToLeagueId.set(l.sourceLeagueId, l.id);
  }

  let matches;
  try {
    matches = await footballApi.getLiveMatches();
  } catch (err) {
    if (err.statusCode === 429 || err.code === 'football_api_rate_limit') {
      // Budget exhausted — next tick will try again. Log at info so the
      // once-per-minute poll doesn't fill the log with warnings.
      logger.info({ err: err.message }, 'syncLiveScores: rate-limited, skipping tick');
      return { skipped: true, reason: 'rate-limited' };
    }
    logger.warn({ err: err.message }, 'syncLiveScores: failed to fetch live matches');
    return { skipped: true, reason: 'upstream-error' };
  }

  const relevant = matches.filter(
    (m) => m.competitionCode && codeToLeagueId.has(m.competitionCode),
  );
  if (relevant.length === 0) {
    return { skipped: false, scanned: 0, changed: 0, transitions: 0 };
  }

  let changed = 0;
  let transitions = 0;
  for (const apiMatch of relevant) {
    try {
      const leagueId = codeToLeagueId.get(apiMatch.competitionCode);
      const localGame = await Game.findOne({
        where: { leagueId, sourceId: apiMatch.sourceId },
      });
      if (!localGame) continue; // unsynced fixture — daily sync will pick it up
      const result = await GameService.applyLiveUpdate(localGame, apiMatch);
      if (result.changed) changed += 1;
      if (result.transitionedToFinished) transitions += 1;
    } catch (err) {
      logger.error(
        { err, sourceId: apiMatch.sourceId, code: apiMatch.competitionCode },
        'syncLiveScores: applyLiveUpdate failed',
      );
    }
  }

  if (changed > 0 || transitions > 0) {
    logger.info(
      { scanned: relevant.length, changed, transitions },
      'syncLiveScores: tick applied updates',
    );
  }
  return { skipped: false, scanned: relevant.length, changed, transitions };
}

module.exports = { run };
