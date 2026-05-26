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
//
// Cost-gate (2026-05-26): early-return when there are NO local games
// in-progress AND NO local scheduled games within a ±4h / +2h window. The
// upstream LIVE response would be filtered to nothing relevant anyway,
// and the reconcile pass would have nothing to do. This lets the
// Container App go idle during off-season (mid-May → mid-August for PL)
// and overnight on match days — Azure Container Apps Consumption billing
// is per-vCPU-second of active work, so skipping the outbound API call +
// parsing on a 30-s tick is a meaningful daily-cost lever. The 2h
// lookahead catches the SCHEDULED → IN_PLAY transition the moment
// upstream flips it; the 4h lookback recovers any game whose kickoff
// passed while the app was scaled to zero (longest realistic match runtime
// is 90 min + HT + injury + ET + pens ≈ 165 min, so 4h is comfortable).

const { Op } = require('sequelize');
const { League, Game } = require('../../models');
const footballApi = require('../footballApi');
const GameService = require('../../services/GameService');
const logger = require('../logger');

// Imminent-kickoff window for the cost-gate above.
const KICKOFF_LOOKBACK_MS = 4 * 60 * 60 * 1000;
const KICKOFF_LOOKAHEAD_MS = 2 * 60 * 60 * 1000;

async function run() {
  if (!footballApi.isConfigured()) {
    return { skipped: true, reason: 'unconfigured' };
  }
  const active = await League.findAll({ where: { active: true } });
  if (active.length === 0) {
    return { skipped: true, reason: 'no-active-leagues' };
  }

  // Cost-gate — see header comment. One cheap COUNT query short-circuits
  // the entire tick (outbound API call + reconcile pass) when there's no
  // live or imminent activity on any active league. Without this we burn
  // ~2880 wasted upstream calls/day during off-season at the 30-s
  // Tier 18 cadence.
  const now = Date.now();
  const kickoffLookback = new Date(now - KICKOFF_LOOKBACK_MS);
  const kickoffLookahead = new Date(now + KICKOFF_LOOKAHEAD_MS);
  const relevantCount = await Game.count({
    where: {
      leagueId: { [Op.in]: active.map((l) => l.id) },
      [Op.or]: [
        { status: 'in-progress' },
        {
          status: 'scheduled',
          date: { [Op.gte]: kickoffLookback, [Op.lt]: kickoffLookahead },
        },
      ],
    },
  });
  if (relevantCount === 0) {
    return { skipped: true, reason: 'no-relevant-games' };
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

  // Reconcile pass — find local games whose state has drifted from
  // upstream. Two patterns we catch:
  //
  //   1. Local `status='in-progress'` but not in the LIVE response.
  //      The match transitioned to FINISHED between ticks (so it
  //      dropped off the LIVE filter). Without reconcile, it'd stay
  //      `in-progress` + `result=null` forever locally.
  //
  //   2. Local `status='scheduled'` with kickoff more than 15 min ago.
  //      The cron was probably down during the SCHEDULED → IN_PLAY
  //      transition window — common when the app scales to zero, or
  //      in dev when the server wasn't running. Without reconcile, the
  //      game stays `scheduled` forever even after the match is long
  //      finished upstream, and the UI's `statusLabel` fallback shows
  //      a misleading "Live" pill.
  //
  // In both cases we batch-fetch the current upstream state via
  // `?ids=` and apply. 15 min cutoff buffers small kickoff delays
  // without burning unnecessary API calls.
  const liveSourceIds = new Set(relevant.map((m) => m.sourceId));
  const scheduledCutoff = new Date(Date.now() - 15 * 60 * 1000);
  const staleWhere = {
    leagueId: { [Op.in]: active.map((l) => l.id) },
    // Always exclude null sourceIds (admin-created games can't reconcile
    // against upstream) AND exclude anything already handled by the LIVE
    // pass above.
    sourceId:
      liveSourceIds.size > 0
        ? { [Op.and]: [{ [Op.ne]: null }, { [Op.notIn]: [...liveSourceIds] }] }
        : { [Op.ne]: null },
    [Op.or]: [
      { status: 'in-progress' },
      { status: 'scheduled', date: { [Op.lt]: scheduledCutoff } },
    ],
  };
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
