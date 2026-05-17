'use strict';

// Tier 13 Chunk 2 — GameService. Owns game list / detail / result / bulk
// ops. setResult and the bulk endpoints fire pick-scored notifications +
// badge evaluations + cache invalidation per the Tier 5.2/5.3 invariants:
// notify() runs OUTSIDE any wrapping transaction; cache invalidate runs
// AFTER the transaction commits.
const { Game, Pick, Comment, sequelize } = require('../models');
const errors = require('../lib/errors');
const logger = require('../lib/logger');
const { scorePick } = require('../lib/scoring');
const { mapUpstreamStatus, deriveResultFromFixture } = require('../lib/fixtureStatus');
const NotificationService = require('./NotificationService');
const BadgeService = require('./BadgeService');
const LeaderboardService = require('./LeaderboardService');

async function listGames() {
  return Game.findAll({ order: [['date', 'ASC']] });
}

async function createGame(attrs) {
  return Game.create(attrs);
}

async function updateGame(gameId, patch) {
  const game = await Game.findByPk(gameId);
  if (!game) throw errors.notFound('Game not found');
  Object.assign(game, patch);
  await game.save();
  return game;
}

async function cascadeDelete(game, { transaction } = {}) {
  const opts = transaction ? { transaction } : {};
  await Pick.destroy({ where: { gameId: game.id }, ...opts });
  await Comment.destroy({ where: { gameId: game.id }, ...opts });
  await game.destroy(opts);
}

async function deleteGame(gameId) {
  const game = await Game.findByPk(gameId);
  if (!game) throw errors.notFound('Game not found');
  await sequelize.transaction(async (t) => {
    await cascadeDelete(game, { transaction: t });
  });
  LeaderboardService.invalidate('all');
}

async function setResult(gameId, result) {
  const game = await Game.findByPk(gameId);
  if (!game) throw errors.notFound('Game not found');

  game.result = result;
  // Tier 4b — keep status in sync with the manual result. A set result
  // implies the match is over; clearing it sends the game back to
  // scheduled. Without this, the useGames bucketing would still classify
  // the row by `result` only — fine for wins/losses, broken for draws.
  game.status = result ? 'finished' : 'scheduled';
  await game.save();

  if (result) {
    const picksForGame = await Pick.findAll({ where: { gameId } });
    for (const pick of picksForGame) {
      const points = scorePick(pick, game);
      const isWin = pick.choice === result;
      const title = isWin
        ? `Your pick on ${game.homeTeam} vs ${game.awayTeam}: ✓ Correct +${points} pts`
        : `Your pick on ${game.homeTeam} vs ${game.awayTeam}: ✗ Missed`;
      NotificationService.notify(pick.userId, 'pick-scored', title).catch(() => {});
      BadgeService.evaluateBadges(pick.userId).catch(() => {});
    }
  }

  LeaderboardService.invalidate('all');
  return game;
}

async function bulkSetResult(ids, result) {
  if (!(result === 'home' || result === 'away' || result === null)) {
    throw errors.badRequest('setResult requires result of home, away, or null');
  }
  const games = await Game.findAll({ where: { id: ids } });
  const affected = [];
  for (const game of games) {
    game.result = result;
    game.status = result ? 'finished' : 'scheduled';
    await game.save();
    if (result) {
      const picksForGame = await Pick.findAll({ where: { gameId: game.id } });
      for (const pick of picksForGame) {
        const points = scorePick(pick, game);
        const isWin = pick.choice === result;
        const title = isWin
          ? `Your pick on ${game.homeTeam} vs ${game.awayTeam}: ✓ Correct +${points} pts`
          : `Your pick on ${game.homeTeam} vs ${game.awayTeam}: ✗ Missed`;
        NotificationService.notify(pick.userId, 'pick-scored', title).catch(() => {});
        BadgeService.evaluateBadges(pick.userId).catch(() => {});
      }
    }
    affected.push(game.id);
  }
  if (affected.length > 0) LeaderboardService.invalidate('all');
  return affected;
}

async function bulkDelete(ids) {
  const games = await Game.findAll({ where: { id: ids } });
  const affected = [];
  for (const game of games) {
    await sequelize.transaction(async (t) => {
      await cascadeDelete(game, { transaction: t });
    });
    affected.push(game.id);
  }
  if (affected.length > 0) LeaderboardService.invalidate('all');
  return affected;
}

// Tier 4b Chunk 2 — live-score job entrypoint. Called once per matched
// upstream fixture by lib/jobs/syncLiveScores.js. Writes the new
// status/scores/result inside a transaction; fires notify + badge + cache
// invalidation AFTER commit so a rollback never leaves ghost messages
// (CLAUDE.md Tier 5.3 invariant). No-ops when nothing changed so the
// once-per-minute poll doesn't churn the DB.
async function applyLiveUpdate(localGame, apiMatch) {
  const newStatus = mapUpstreamStatus(apiMatch.status);
  const newHomeScore = apiMatch.homeScore;
  const newAwayScore = apiMatch.awayScore;
  // halfTimeReached is monotonic — once true, never flips back even if
  // upstream temporarily drops the halfTime block.
  const newHalfTimeReached = localGame.halfTimeReached || Boolean(apiMatch.halfTimeReached);
  const newPhase = apiMatch.phase ?? localGame.phase ?? null;

  // Only derive a new result if we don't already have one. We never
  // overwrite an admin's manual entry, and we never flip a previously-set
  // result to a different value automatically.
  let newResult = localGame.result;
  if (localGame.result === null) {
    newResult = deriveResultFromFixture(apiMatch, newStatus);
  }

  const changed =
    localGame.status !== newStatus ||
    localGame.homeScore !== newHomeScore ||
    localGame.awayScore !== newAwayScore ||
    localGame.result !== newResult ||
    localGame.halfTimeReached !== newHalfTimeReached ||
    localGame.phase !== newPhase;

  if (!changed) {
    return { game: localGame, changed: false, transitionedToFinished: false };
  }

  // A "transition to finished" is when we are now setting a result for
  // the first time. That's what triggers pick scoring + notifications.
  const transitionedToFinished = localGame.result === null && newResult !== null;

  await sequelize.transaction(async (t) => {
    localGame.status = newStatus;
    localGame.homeScore = newHomeScore;
    localGame.awayScore = newAwayScore;
    localGame.result = newResult;
    localGame.halfTimeReached = newHalfTimeReached;
    localGame.phase = newPhase;
    await localGame.save({ transaction: t });
  });

  if (transitionedToFinished) {
    try {
      const picksForGame = await Pick.findAll({ where: { gameId: localGame.id } });
      for (const pick of picksForGame) {
        const points = scorePick(pick, localGame);
        const isWin = pick.choice === newResult;
        const title = isWin
          ? `Your pick on ${localGame.homeTeam} vs ${localGame.awayTeam}: ✓ Correct +${points} pts`
          : `Your pick on ${localGame.homeTeam} vs ${localGame.awayTeam}: ✗ Missed`;
        NotificationService.notify(pick.userId, 'pick-scored', title).catch(() => {});
        BadgeService.evaluateBadges(pick.userId).catch(() => {});
      }
    } catch (err) {
      // Notifications are best-effort. Surface the error but don't crash
      // the polling tick — the result is already committed.
      logger.error(
        { err, gameId: localGame.id },
        'applyLiveUpdate: failed to fan out pick notifications',
      );
    }
    LeaderboardService.invalidate('all');
  } else if (localGame.status !== newStatus) {
    // Status flipped (e.g. scheduled → in-progress) without a result
    // transition — leaderboard cache is unaffected, no fan-out needed.
  }

  return { game: localGame, changed: true, transitionedToFinished };
}

module.exports = {
  listGames,
  createGame,
  updateGame,
  deleteGame,
  setResult,
  bulkSetResult,
  bulkDelete,
  cascadeDelete,
  applyLiveUpdate,
};
