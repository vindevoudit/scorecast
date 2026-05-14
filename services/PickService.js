'use strict';

// Tier 13 Chunk 2 — PickService. Owns the create/delete pick flow and the
// authoritative server-side scorer. The client-side preview in
// src/utils/scoring.js must stay in sync (CLAUDE.md invariant).
//
// Tier 5.2 invariant: every mutation that affects standings calls
// LeaderboardService.invalidate. Tier 5.3: notify/badge calls fire OUTSIDE
// any wrapping transaction.
const { Pick, Game } = require('../models');
const errors = require('../lib/errors');
const { scorePick } = require('../lib/scoring');
const BadgeService = require('./BadgeService');
const LeaderboardService = require('./LeaderboardService');

async function createPick({ userId, gameId, choice }) {
  const game = await Game.findByPk(gameId);
  if (!game) throw errors.notFound('Game not found');

  const gameDate = new Date(game.date);
  const now = new Date();
  if (game.result || gameDate <= now) {
    throw errors.badRequest('Picks can only be created or changed for upcoming games');
  }

  const existingPick = await Pick.findOne({ where: { userId, gameId } });
  if (existingPick) {
    existingPick.choice = choice;
    existingPick.submittedAt = new Date();
    await existingPick.save();
  } else {
    await Pick.create({ userId, gameId, choice });
  }

  BadgeService.evaluateBadges(userId).catch(() => {});
  LeaderboardService.invalidate('all');
}

async function listForUser(userId) {
  return Pick.findAll({ where: { userId } });
}

async function deletePick({ pickId, userId }) {
  const pick = await Pick.findByPk(pickId);
  if (!pick) throw errors.notFound('Pick not found');
  if (pick.userId !== userId) throw errors.forbidden();

  const game = await Game.findByPk(pick.gameId);
  if (game) {
    const now = new Date();
    if (game.result || new Date(game.date) <= now) {
      throw errors.badRequest('Picks can only be removed before kickoff');
    }
  }

  await pick.destroy();
  LeaderboardService.invalidate('all');
}

module.exports = { createPick, listForUser, deletePick, scorePick };
