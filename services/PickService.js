'use strict';

// Tier 13 Chunk 2 — PickService. Owns the create/delete pick flow and the
// authoritative server-side scorer. The client-side preview in
// src/utils/scoring.js must stay in sync (CLAUDE.md invariant).
//
// Tier 5.2 invariant: every mutation that affects standings calls
// LeaderboardService.invalidate. Tier 5.3: notify/badge calls fire OUTSIDE
// any wrapping transaction.
const { Op } = require('sequelize');
const { Pick, Game, User, sequelize } = require('../models');
const errors = require('../lib/errors');
const { scorePick } = require('../lib/scoring');
const { getViewerFriendIdSet } = require('../lib/friends');
const BadgeService = require('./BadgeService');
const LeaderboardService = require('./LeaderboardService');
const UserScoreService = require('./UserScoreService');
const StreakService = require('./StreakService');

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

  // Tier 24 — pick create/update wrapped in a transaction so the
  // user_scores delta (when the game is already scored) lands atomically
  // with the pick row. The pre-kickoff guards above mean game.result is
  // always null at this point in the normal flow; the "create on
  // already-scored game" branch only applies on the bulk-import or
  // admin-driven paths (and the matrix arm "Pick created on already-
  // scored game" in tier24.md).
  //
  // Phase 0 P0-7 — idempotent create. Two concurrent POSTs from the same
  // user on the same game (rapid double-tap, double-submit, redundant
  // retry) would race the findOne above and both hit Pick.create, with
  // one hitting picks_user_game_unique and 500ing. Catch the unique-
  // violation, restart the transaction, and on the second pass the
  // findOne resolves to the row the other writer just created → the
  // user-visible result is a no-op (or a re-pick if choice changed).
  let attempt = 0;
  for (;;) {
    try {
      await sequelize.transaction(async (t) => {
        let pick = await Pick.findOne({ where: { userId, gameId }, transaction: t });
        if (pick) {
          // Re-pick: reverse the prior delta (if any) before re-applying.
          pick.choice = choice;
          pick.submittedAt = new Date();
          pick.pickedHomeProbability = snapshot.pickedHomeProbability;
          pick.pickedDrawProbability = snapshot.pickedDrawProbability;
          pick.pickedAwayProbability = snapshot.pickedAwayProbability;
          await pick.save({ transaction: t });
        } else {
          pick = await Pick.create({ userId, gameId, choice, ...snapshot }, { transaction: t });
        }
        await UserScoreService.applyPickTransition(t, { pick, game });
      });
      break;
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        attempt += 1;
        if (attempt < 3) continue;
      }
      throw err;
    }
  }

  BadgeService.evaluateBadges(userId).catch(() => {});
  // Tier 30 Phase 3 A1 — Pick-streak. Fires post-transaction so a streak
  // outage can never break the pick. computeNextState is idempotent at
  // day-key granularity, so two parallel picks on the same day resolve
  // to a single increment.
  StreakService.applyPickForUser(userId).catch(() => {});
  LeaderboardService.invalidate('all');
  LeaderboardService.assertParity({ userId }).catch(() => {});
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

  // Tier 24 — reverse the user_scores contribution before destroying the
  // row. On a pre-kickoff delete (the normal path with the guards above)
  // pick.appliedResult is null + appliedPoints is 0 so reversePick is a
  // no-op. The reverse branch is load-bearing for admin / cascade paths
  // where the pick existed on a scored game.
  await sequelize.transaction(async (t) => {
    if (game) {
      await UserScoreService.reversePick(t, { pick, game });
    }
    await pick.destroy({ transaction: t });
  });
  LeaderboardService.invalidate('all');
  LeaderboardService.assertParity({ userId }).catch(() => {});
}

module.exports = { createPick, listForUser, listFriendsPicks, deletePick, scorePick };
