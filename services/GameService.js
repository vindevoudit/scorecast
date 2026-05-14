'use strict';

// Tier 13 Chunk 2 — GameService. Owns game list / detail / result / bulk
// ops. setResult and the bulk endpoints fire pick-scored notifications +
// badge evaluations + cache invalidation per the Tier 5.2/5.3 invariants:
// notify() runs OUTSIDE any wrapping transaction; cache invalidate runs
// AFTER the transaction commits.
const { Game, Pick, Comment, sequelize } = require('../models');
const errors = require('../lib/errors');
const { scorePick } = require('../lib/scoring');
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

module.exports = {
  listGames,
  createGame,
  updateGame,
  deleteGame,
  setResult,
  bulkSetResult,
  bulkDelete,
  cascadeDelete,
};
