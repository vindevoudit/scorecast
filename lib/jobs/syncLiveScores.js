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

const { Op } = require('sequelize');
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

  // Reconcile pass — find local games we think are still in-progress but
  // weren't in the LIVE response. They likely transitioned to FINISHED
  // between ticks (and so dropped off the LIVE filter). Batch-fetch their
  // current upstream state and apply.
  //
  // Without this, matches would stay status='in-progress' + result=null
  // forever after the cron missed the IN_PLAY → FINISHED transition
  // window.
  const liveSourceIds = new Set(relevant.map((m) => m.sourceId));
  const staleWhere = {
    leagueId: { [Op.in]: active.map((l) => l.id) },
    status: 'in-progress',
    sourceId: { [Op.ne]: null },
  };
  if (liveSourceIds.size > 0) {
    staleWhere.sourceId = { [Op.notIn]: [...liveSourceIds] };
  }
  const stale = await Game.findAll({ where: staleWhere });

  let reconciled = 0;
  if (stale.length > 0) {
    try {
      const final = await footballApi.getMatchesByIds(stale.map((g) => g.sourceId));
      const bySourceId = new Map(final.map((m) => [m.sourceId, m]));
      for (const localGame of stale) {
        const apiMatch = bySourceId.get(localGame.sourceId);
        if (!apiMatch) continue; // upstream forgot about it; leave alone
        try {
          const result = await GameService.applyLiveUpdate(localGame, apiMatch);
          if (result.changed) changed += 1;
          if (result.transitionedToFinished) transitions += 1;
          reconciled += 1;
        } catch (err) {
          logger.error(
            { err, sourceId: localGame.sourceId },
            'syncLiveScores: reconcile applyLiveUpdate failed',
          );
        }
      }
    } catch (err) {
      // Reconcile is best-effort; LIVE polling already wrote whatever it
      // could. Don't fail the whole tick if the catch-up call 429s.
      if (err.statusCode === 429 || err.code === 'football_api_rate_limit') {
        logger.info('syncLiveScores: reconcile rate-limited, will retry next tick');
      } else {
        logger.warn({ err: err.message }, 'syncLiveScores: reconcile fetch failed');
      }
    }
  }

  if (changed > 0 || transitions > 0 || reconciled > 0) {
    logger.info(
      { scanned: relevant.length, changed, transitions, reconciled },
      'syncLiveScores: tick applied updates',
    );
  }
  return { skipped: false, scanned: relevant.length, changed, transitions, reconciled };
}

module.exports = { run };
