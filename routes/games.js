'use strict';

// Tier 13 Chunk 1 — game routes extracted from server.js. Covers the game
// list, posting a final result (admin only), and the per-game comments
// listing + creation. Other comment ops (PUT/DELETE/reactions) live in
// routes/comments.js.
const express = require('express');
const { validate } = require('../validation/middleware');
const { resultSchema, commentSchema } = require('../validation/schemas');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { commentLimiter } = require('../middleware/rateLimit');
const { scorePick } = require('../lib/scoring');
const { notify, evaluateBadges } = require('../lib/badges');
const { getUserById } = require('../lib/users');
const leaderboardCache = require('../lib/leaderboardCache');
const { Game, Pick, Comment, CommentReaction, User } = require('../models');

const router = express.Router();

router.get('/games', authMiddleware, async (req, res) => {
  try {
    const games = await Game.findAll({ order: [['date', 'ASC']] });
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

router.post(
  '/games/:gameId/result',
  authMiddleware,
  requireAdmin,
  validate(resultSchema),
  async (req, res) => {
    const { result } = req.body;

    try {
      const game = await Game.findByPk(req.params.gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      game.result = result;
      await game.save();

      if (result) {
        const picksForGame = await Pick.findAll({ where: { gameId: req.params.gameId } });
        for (const pick of picksForGame) {
          const points = scorePick(pick, game);
          const isWin = pick.choice === result;
          const title = isWin
            ? `Your pick on ${game.homeTeam} vs ${game.awayTeam}: ✓ Correct +${points} pts`
            : `Your pick on ${game.homeTeam} vs ${game.awayTeam}: ✗ Missed`;
          notify(pick.userId, 'pick-scored', title).catch(() => {});
          evaluateBadges(pick.userId).catch(() => {});
        }
      }

      leaderboardCache.invalidate('all');
      res.json({ success: true, game });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update game result' });
    }
  },
);

router.get('/games/:gameId/comments', authMiddleware, async (req, res) => {
  try {
    const comments = await Comment.findAll({
      where: { gameId: req.params.gameId },
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    const commentIds = comments.map((c) => c.id);
    const userIds = [...new Set(comments.map((c) => c.userId))];
    const [users, reactions] = await Promise.all([
      User.findAll({ where: { id: userIds } }),
      commentIds.length
        ? CommentReaction.findAll({ where: { commentId: commentIds } })
        : Promise.resolve([]),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const countsByComment = new Map();
    const yourByComment = new Map();
    for (const r of reactions) {
      if (!countsByComment.has(r.commentId)) countsByComment.set(r.commentId, {});
      const counts = countsByComment.get(r.commentId);
      counts[r.emoji] = (counts[r.emoji] || 0) + 1;
      if (r.userId === req.user.id) {
        if (!yourByComment.has(r.commentId)) yourByComment.set(r.commentId, []);
        yourByComment.get(r.commentId).push(r.emoji);
      }
    }
    res.json(
      comments.map((c) => ({
        id: c.id,
        gameId: c.gameId,
        userId: c.userId,
        username: userById.get(c.userId)?.username || 'Unknown',
        body: c.body,
        createdAt: c.createdAt,
        editedAt: c.editedAt || null,
        reactionCounts: countsByComment.get(c.id) || {},
        yourReactions: yourByComment.get(c.id) || [],
      })),
    );
  } catch (error) {
    req.log.error({ err: error }, 'handler error');
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

router.post(
  '/games/:gameId/comments',
  commentLimiter,
  authMiddleware,
  validate(commentSchema),
  async (req, res) => {
    try {
      const game = await Game.findByPk(req.params.gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });

      const comment = await Comment.create({
        gameId: req.params.gameId,
        userId: req.user.id,
        body: req.body.body,
      });
      const user = await getUserById(req.user.id);
      res.json({
        id: comment.id,
        gameId: comment.gameId,
        userId: comment.userId,
        username: user.username,
        body: comment.body,
        createdAt: comment.createdAt,
        editedAt: null,
        reactionCounts: {},
        yourReactions: [],
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to post comment' });
    }
  },
);

module.exports = router;
