'use strict';

const { Game, sequelize } = require('../models');
const errors = require('../lib/errors');
const logger = require('../lib/logger');
const { CRICKET, oversToBalls } = require('../lib/sports');
const GameService = require('./GameService');

// Tier 34 — manual T20 result entry.
//
// WHY THIS COMPOSES WITH GameService.setResult RATHER THAN EXTENDING IT
// ---------------------------------------------------------------------
// setResult owns the Tier 24 dual-writer, the Tier 17 Elo cascade, the
// pick-scored notification fan-out and the leaderboard cache invalidation. It
// is the single riskiest football function to touch, and the whole point of
// the cricket work is that football cannot break. So this service does not
// modify it — it writes the scorecard first, then calls it unchanged.
//
// WHY THAT SCORES CORRECTIONS CORRECTLY
// -------------------------------------
// setResult opens its own transaction and re-reads the row with
// SELECT ... FOR UPDATE, so it sees the scorecard committed in step 1. It then
// runs UserScoreService.applyPickTransition, whose idempotency short-circuit
// is `oldResult === newResult && oldPoints === newPoints`. On a correction the
// result is unchanged but the recomputed points differ, so the short-circuit
// does NOT fire and the delta lands. deriveCounterDeltas('home','home') yields
// scoredDelta = 0 and wonDelta = 0, so the counters stay correct too.
//
// ORDER IS LOAD-BEARING. If the scorecard were written AFTER setResult (or in
// the same call), newPoints would be computed from the stale scores, would
// equal oldPoints, the short-circuit WOULD fire, and the correction would be
// silently dropped — while the UI's live scorePick showed the new number. The
// leaderboard and the match card would then disagree forever, with no error.
//
// KNOWN SEAM: the scorecard write and setResult are two transactions. A crash
// between them leaves the scorecard written but the points unapplied; recovery
// is re-submitting the same form, which is idempotent. Accepted deliberately
// as the price of not editing setResult, and it only affects a manual admin
// action, never a request path a user can reach.

// Maps one validated innings block onto its game columns.
function inningsColumns(prefix, innings) {
  const balls = oversToBalls(innings.overs);
  if (balls == null) {
    // Should be unreachable — the zod regex already rejects a .6-.9 over — but
    // a null here would silently disable proration, so fail loudly instead.
    throw errors.badRequest(`Could not parse ${prefix} overs "${innings.overs}"`);
  }
  return {
    [`${prefix}Score`]: innings.runs,
    [`${prefix}Wickets`]: innings.wickets,
    [`${prefix}BallsFaced`]: balls,
    [`${prefix}AllOut`]: innings.allOut,
  };
}

/**
 * Record a T20 result: scorecard for both innings plus the winner.
 *
 * @param {string} gameId
 * @param {object} payload validated by cricketResultSchema
 * @param {'home'|'away'|null} payload.result null = abandoned / no result
 * @param {object} payload.home {runs, wickets, overs, allOut}
 * @param {object} payload.away {runs, wickets, overs, allOut}
 * @param {object} [options]
 * @param {'admin'|'auto'} [options.source='admin'] who is writing. Stamped onto
 *   games.resultSource in step 1's transaction. The 'admin' DEFAULT is what
 *   makes the admin route protective without changing a line of it: any human
 *   correction marks the game 'admin', and CricketProviderService's claim
 *   (`UPDATE ... WHERE resultSource IS NULL`) then excludes it from automatic
 *   capture permanently. Passing 'auto' is the cron's opt-in to being
 *   overridable.
 */
async function setCricketResult(gameId, { result, home, away }, { source = 'admin' } = {}) {
  const game = await Game.findByPk(gameId);
  if (!game) throw errors.notFound('Game not found');
  if (game.sport !== CRICKET) {
    throw errors.badRequest(
      'This game is not cricket — use POST /api/games/:gameId/result for football',
    );
  }

  const columns = {
    ...inningsColumns('home', home),
    ...inningsColumns('away', away),
    resultSource: source,
  };

  // Step 1 — the scorecard, committed BEFORE setResult so its FOR UPDATE
  // re-read observes it. See the ordering note above.
  await sequelize.transaction(async (t) => {
    await Game.update(columns, { where: { id: gameId }, transaction: t });
  });

  // Step 2 — the unmodified football result path does all the scoring work.
  const updated = await GameService.setResult(gameId, result);

  // Step 3 — an abandoned match. setResult maps a null result back to
  // status='scheduled' (correct for football, where clearing a result means
  // "this hasn't happened yet"), but a rained-off T20 has happened and must
  // not reappear as an upcoming fixture. Points were already reversed by the
  // setResult call above, and scorePick returns 0 for a null result, so this
  // is purely about which bucket the game lands in on the frontend.
  if (result === null) {
    await Game.update({ status: 'cancelled' }, { where: { id: gameId } });
    updated.status = 'cancelled';
  }

  logger.info(
    { gameId, result, homeRuns: home.runs, awayRuns: away.runs },
    'cricket result recorded',
  );
  return updated;
}

module.exports = { setCricketResult };
