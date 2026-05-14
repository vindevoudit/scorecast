'use strict';

// Tier 13 Chunk 1 — comment + reaction routes extracted from server.js.
// The listing + creation routes live in routes/games.js because they are
// scoped to /games/:gameId/comments; this file owns operations on existing
// comments. ALLOWED_EMOJIS is the source of truth for the reaction palette
// (CLAUDE.md invariant: must stay in sync with REACTION_EMOJIS in
// src/components/CommentThread.jsx).
const express = require('express');
const { validate } = require('../validation/middleware');
const { commentSchema, reactionSchema, ALLOWED_EMOJIS } = require('../validation/schemas');
const { authMiddleware } = require('../middleware/auth');
const { Comment, CommentReaction } = require('../models');

const router = express.Router();

router.put('/comments/:id', authMiddleware, validate(commentSchema), async (req, res) => {
  try {
    const comment = await Comment.findByPk(req.params.id);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    comment.body = req.body.body;
    comment.editedAt = new Date();
    await comment.save();
    res.json({
      id: comment.id,
      body: comment.body,
      editedAt: comment.editedAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

router.delete('/comments/:id', authMiddleware, async (req, res) => {
  try {
    const comment = await Comment.findByPk(req.params.id);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    await CommentReaction.destroy({ where: { commentId: comment.id } });
    await comment.destroy();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

router.post(
  '/comments/:id/reactions',
  authMiddleware,
  validate(reactionSchema),
  async (req, res) => {
    try {
      const comment = await Comment.findByPk(req.params.id);
      if (!comment) return res.status(404).json({ error: 'Comment not found' });
      try {
        await CommentReaction.create({
          commentId: comment.id,
          userId: req.user.id,
          emoji: req.body.emoji,
        });
      } catch (_e) {
        // Unique constraint — already reacted with this emoji; treat as no-op success.
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to add reaction' });
    }
  },
);

router.delete('/comments/:id/reactions/:emoji', authMiddleware, async (req, res) => {
  try {
    if (!ALLOWED_EMOJIS.includes(req.params.emoji)) {
      return res.status(400).json({ error: 'Invalid emoji' });
    }
    await CommentReaction.destroy({
      where: {
        commentId: req.params.id,
        userId: req.user.id,
        emoji: req.params.emoji,
      },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
});

module.exports = router;
