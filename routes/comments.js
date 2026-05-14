'use strict';

// Tier 13 Chunk 2 — comment routes. The per-game listing + creation live in
// routes/games.js (they are scoped to /games/:gameId/comments); this file
// owns operations on existing comments + reactions.
const express = require('express');
const { validate } = require('../validation/middleware');
const { commentSchema, reactionSchema } = require('../validation/schemas');
const { authMiddleware } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const CommentService = require('../services/CommentService');

const router = express.Router();

router.put(
  '/comments/:id',
  authMiddleware,
  validate(commentSchema),
  asyncHandler(async (req, res) => {
    const result = await CommentService.edit({
      commentId: req.params.id,
      userId: req.user.id,
      body: req.body.body,
    });
    res.json(result);
  }),
);

router.delete(
  '/comments/:id',
  authMiddleware,
  asyncHandler(async (req, res) => {
    await CommentService.remove({ commentId: req.params.id, viewer: req.user });
    res.json({ success: true });
  }),
);

router.post(
  '/comments/:id/reactions',
  authMiddleware,
  validate(reactionSchema),
  asyncHandler(async (req, res) => {
    await CommentService.react({
      commentId: req.params.id,
      userId: req.user.id,
      emoji: req.body.emoji,
    });
    res.json({ success: true });
  }),
);

router.delete(
  '/comments/:id/reactions/:emoji',
  authMiddleware,
  asyncHandler(async (req, res) => {
    await CommentService.unreact({
      commentId: req.params.id,
      userId: req.user.id,
      emoji: req.params.emoji,
    });
    res.json({ success: true });
  }),
);

module.exports = router;
