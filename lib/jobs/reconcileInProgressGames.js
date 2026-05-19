'use strict';

// Defensive 5-min reconcile against football-data.org's ?status= endpoint
// going stale. Incident 2026-05-19: AFC Bournemouth vs Manchester City
// (sourceId 538145) ended 1-1 around 22:25 UTC, but the upstream
// ?status=LIVE,IN_PLAY,PAUSED filter kept returning it as PAUSED at HT
// 1-0 long after the canonical ?ids= endpoint returned the correct
// FINISHED+DRAW state. The 1-min syncLiveScores job faithfully mirrored
// the stale filter and never escalated to ?ids= because the existing
// reconcile pass explicitly excludes fixtures that appear in the LIVE
// response.
//
// This job sweeps every local `status='in-progress'` game with an upstream
// sourceId every 5 minutes via `getMatchesByIds`, which has been observed
// to be fresh even when ?status= is stale. applyLiveUpdate is idempotent —
// games whose canonical state matches the local row produce changed=false
// no-ops. Games whose canonical state has FINISHED while ?status= still
// claims they're live get transitioned, picks scored, leaderboard cache
// invalidated.
//
// API cost: ≤1 extra request per 5 min, well within the 10-req/min free
// tier. Cached for 30s alongside the syncLiveScores reconcile so a
// coincident id-set hits cache.
//
// Concurrency: this job and syncLiveScores can race on the same row at
// xx:00/xx:05/etc tick alignments. The race is closed inside
// GameService.applyLiveUpdate via SELECT ... FOR UPDATE on the game row.

const { Op } = require('sequelize');
const { League, Game } = require('../../models');
const footballApi = require('../footballApi');
const GameService = require('../../services/GameService');
const logger = require('../logger');

// Hard cap matching lib/footballApi.js getMatchesByIds — surfaced here so a
// runaway in-progress count triggers a visible warning rather than silent
// truncation.
const MAX_IDS_PER_TICK = 50;

async function run() {
  if (!footballApi.isConfigured()) {
    return { skipped: true, reason: 'unconfigured' };
  }
  const active = await League.findAll({ where: { active: true } });
  if (active.length === 0) {
    return { skipped: true, reason: 'no-active-leagues' };
  }

  const stale = await Game.findAll({
    where: {
      leagueId: { [Op.in]: active.map((l) => l.id) },
      sourceId: { [Op.ne]: null },
      status: 'in-progress',
    },
  });
  if (stale.length === 0) {
    return { scanned: 0, changed: 0, transitions: 0 };
  }
  if (stale.length > MAX_IDS_PER_TICK) {
    logger.warn(
      { count: stale.length, cap: MAX_IDS_PER_TICK },
      'reconcileInProgressGames: >cap in-progress games, only first batch reconciled this tick',
    );
  }

  let fresh;
  try {
    fresh = await footballApi.getMatchesByIds(stale.map((g) => g.sourceId));
  } catch (err) {
    if (err.statusCode === 429 || err.code === 'football_api_rate_limit') {
      logger.info({ err: err.message }, 'reconcileInProgressGames: rate-limited, skipping tick');
      return { skipped: true, reason: 'rate-limited' };
    }
    logger.warn({ err: err.message }, 'reconcileInProgressGames: failed to fetch matches by ids');
    return { skipped: true, reason: 'upstream-error' };
  }

  const bySourceId = new Map(fresh.map((m) => [m.sourceId, m]));
  let changed = 0;
  let transitions = 0;
  for (const localGame of stale) {
    const apiMatch = bySourceId.get(localGame.sourceId);
    if (!apiMatch) continue; // upstream forgot about it; leave alone
    try {
      const result = await GameService.applyLiveUpdate(localGame, apiMatch);
      if (result.changed) changed += 1;
      if (result.transitionedToFinished) {
        transitions += 1;
        // Targeted log line — this is the exact event the job exists to
        // catch. Operators watching for upstream-filter staleness should
        // see one of these whenever a game gets unstuck.
        logger.info(
          {
            gameId: localGame.id,
            sourceId: localGame.sourceId,
            homeTeam: localGame.homeTeam,
            awayTeam: localGame.awayTeam,
            result: result.game.result,
          },
          'reconcileInProgressGames: caught stale-upstream finish via ?ids=',
        );
      }
    } catch (err) {
      logger.error(
        { err, gameId: localGame.id, sourceId: localGame.sourceId },
        'reconcileInProgressGames: applyLiveUpdate failed',
      );
    }
  }

  if (changed > 0 || transitions > 0) {
    logger.info(
      { scanned: stale.length, changed, transitions },
      'reconcileInProgressGames: tick applied updates',
    );
  }
  return { skipped: false, scanned: stale.length, changed, transitions };
}

module.exports = { run };
