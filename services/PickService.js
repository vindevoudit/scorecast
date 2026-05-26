'use strict';

// Tier 13 Chunk 2 — PickService. Owns the create/delete pick flow and the
// authoritative server-side scorer. The client-side preview in
// src/utils/scoring.js must stay in sync (CLAUDE.md invariant).
//
// Tier 5.2 invariant: every mutation that affects standings calls
// LeaderboardService.invalidate. Tier 5.3: notify/badge calls fire OUTSIDE
// any wrapping transaction.
const { Op } = require('sequelize');
const { Pick, Game, User } = require('../models');
const errors = require('../lib/errors');
const { scorePick } = require('../lib/scoring');
const { getViewerFriendIdSet } = require('../lib/friends');
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

  // Snapshot the three probabilities at pick time. Locks the user's payout
  // against subsequent ML rewrites of game.{home,draw,away}Probability.
  // Re-picking (same team or switch) refreshes the snapshot intentionally —
  // "re-pick = re-lock at current odds." All three written together so the
  // all-or-nothing read in lib/scoring.js can use pickedHomeProbability as
  // the sentinel.
  const snapshot = {
    pickedHomeProbability: game.homeProbability,
    pickedDrawProbability: game.drawProbability,
    pickedAwayProbability: game.awayProbability,
  };

  const existingPick = await Pick.findOne({ where: { userId, gameId } });
  if (existingPick) {
    existingPick.choice = choice;
    existingPick.submittedAt = new Date();
    existingPick.pickedHomeProbability = snapshot.pickedHomeProbability;
    existingPick.pickedDrawProbability = snapshot.pickedDrawProbability;
    existingPick.pickedAwayProbability = snapshot.pickedAwayProbability;
    await existingPick.save();
  } else {
    await Pick.create({ userId, gameId, choice, ...snapshot });
  }

  BadgeService.evaluateBadges(userId).catch(() => {});
  LeaderboardService.invalidate('all');
}

async function listForUser(userId) {
  return Pick.findAll({ where: { userId } });
}

// Tier 18 Chunk 4 — friends' picks visibility. One function serves both
// surfaces: the GameCard per-game inline expand AND the PicksHistory
// "Friends' Picks" aggregated tab. Frontend fetches once at dashboard
// load and slices the array per game.
//
// Bounds: only picks on games kicking off within the last 30 days OR in
// the future. Keeps the response O(friends × ~50 games) — at typical
// 5-50 friends per viewer, payload stays under 200KB. Capped at 500
// rows as a defensive ceiling for power users.
//
// Privacy: every row is filtered through LeaderboardService.applyMasking.
// Friends with profileVisibility='private' show as the masked label;
// 'public' and 'friends' (the viewer IS a friend) pass through unmasked.
// Same contract as Tier 8.6 leaderboard masking.
const FRIENDS_PICKS_HORIZON_DAYS = 30;
const FRIENDS_PICKS_MAX_ROWS = 500;

async function listFriendsPicks(viewerId, { gameId } = {}) {
  const friendIds = await getViewerFriendIdSet(viewerId);
  if (friendIds.size === 0) return [];

  const pickWhere = { userId: { [Op.in]: [...friendIds] } };
  if (gameId) pickWhere.gameId = gameId;

  const gameWhere = {};
  if (!gameId) {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() - FRIENDS_PICKS_HORIZON_DAYS);
    gameWhere.date = { [Op.gte]: horizon };
  }

  const picks = await Pick.findAll({
    where: pickWhere,
    include: [
      {
        model: User,
        attributes: ['id', 'username', 'displayName', 'profileVisibility'],
      },
      {
        model: Game,
        // `required: true` enforces the gameWhere filter (when set) via
        // an INNER JOIN — Sequelize otherwise emits a LEFT JOIN and the
        // where on the included model gets dropped.
        required: true,
        where: gameWhere,
      },
    ],
    order: [['submittedAt', 'DESC']],
    limit: FRIENDS_PICKS_MAX_ROWS,
  });

  const rows = picks.map((pick) => {
    const game = pick.Game;
    const user = pick.User;
    return {
      pickId: pick.id,
      gameId: pick.gameId,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      profileVisibility: user.profileVisibility,
      choice: pick.choice,
      // Server-authoritative score using the same scorer that powers the
      // leaderboard. Honors the pick-time snapshot when present (Tier 17),
      // so a friend's points reflect the odds they actually locked.
      points: game?.result ? scorePick(pick, game) : null,
      submittedAt: pick.submittedAt,
    };
  });

  return LeaderboardService.applyMasking(rows, {
    viewerId,
    viewerIsAdmin: false,
    friendIds,
    exemptIds: null,
  });
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

module.exports = { createPick, listForUser, listFriendsPicks, deletePick, scorePick };
