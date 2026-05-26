'use strict';

// Tier 19 Chunk 5 — kickoff-time pick scoring lock cron.
//
// Every 1 min, finds games where:
//   - status = 'scheduled'  (live-score job hasn't transitioned to in-progress yet)
//   - date <= NOW()         (kickoff has passed by wall-clock)
//   - pickProbabilitiesLockedAt IS NULL  (idempotency — once locked, skip)
//
// For each match: bulk-rewrites every Pick row's three probability snapshot
// columns to the game's current values, then stamps games.pickProbabilitiesLockedAt.
// After the stamp every pick on the game scores identically for a given
// choice — the "pick early at long odds for higher payout" gameplay loop
// is gone, replaced by a fairness invariant ("same choice = same payout").
//
// Two write paths exist (defense in depth):
//   1. THIS cron — handles the case where the live-score signal hasn't
//      arrived yet (e.g. football-data.org status filter lag, or app
//      scaled to zero around kickoff).
//   2. The in-line hook in GameService.applyLiveUpdate — handles the case
//      where the live-score signal beats this cron's next tick. Same
//      bulk UPDATE inside the FOR UPDATE transaction that flips status
//      to 'in-progress', so the lock + status flip are atomic.
//
// Cost-gate (mirrors syncLiveScores): a cheap Game.count short-circuits the
// entire tick when there are no relevant games. The partial index from
// migration 20260527000002 (status, date WHERE pickProbabilitiesLockedAt
// IS NULL) makes both the count and the main query cheap on a growing
// games table.
//
// Idempotency: the WHERE clause filters out already-locked games, so
// running this job twice in a row is a no-op on the second run.

const { Op } = require('sequelize');
const { Game, Pick, sequelize } = require('../../models');
const logger = require('../logger');

async function run() {
  const now = new Date();

  // Cost-gate. Early-return when no scheduled-and-passed-kickoff games
  // exist. The partial index makes this O(matching rows), not O(games).
  const relevantCount = await Game.count({
    where: {
      status: 'scheduled',
      pickProbabilitiesLockedAt: null,
      date: { [Op.lte]: now },
    },
  });
  if (relevantCount === 0) {
    return { skipped: true, reason: 'no-relevant-games' };
  }

  const games = await Game.findAll({
    where: {
      status: 'scheduled',
      pickProbabilitiesLockedAt: null,
      date: { [Op.lte]: now },
    },
  });

  let locked = 0;
  let totalPicksRewritten = 0;
  for (const game of games) {
    try {
      // One transaction per game so a single bad row doesn't undo the rest
      // (matches the bulk-mutation invariant from Tier 5.3 cascades). The
      // lock + bulk Pick.update are atomic per game.
      const result = await sequelize.transaction(async (t) => {
        // Re-fetch with FOR UPDATE so a concurrent applyLiveUpdate on the
        // same row blocks here until the other transaction commits. The
        // reload sees the committed writes — including any
        // pickProbabilitiesLockedAt that applyLiveUpdate may have stamped
        // between our findAll and this iteration.
        const fresh = await Game.findByPk(game.id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!fresh || fresh.pickProbabilitiesLockedAt) {
          return { rewrote: 0, skipped: true };
        }

        const [rewrote] = await Pick.update(
          {
            pickedHomeProbability: fresh.homeProbability,
            pickedDrawProbability: fresh.drawProbability,
            pickedAwayProbability: fresh.awayProbability,
          },
          { where: { gameId: fresh.id }, transaction: t },
        );
        fresh.pickProbabilitiesLockedAt = new Date();
        await fresh.save({ transaction: t });
        return { rewrote, skipped: false };
      });
      if (!result.skipped) {
        locked += 1;
        totalPicksRewritten += result.rewrote;
      }
    } catch (err) {
      // Per-game failure — log and continue. A bad row mustn't break the
      // rest of the batch (other games are still waiting to lock).
      logger.error(
        { err, gameId: game.id },
        'lockPickProbabilities: failed to lock game, continuing',
      );
    }
  }

  logger.info(
    { locked, totalPicksRewritten, candidates: games.length },
    'lockPickProbabilities: locked picks at kickoff',
  );
  return { locked, totalPicksRewritten, candidates: games.length };
}

module.exports = { run };
