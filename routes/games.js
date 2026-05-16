'use strict';

// Tier 13 Chunk 2 — game routes. Handlers delegate to GameService for game
// CRUD + result, CommentService for the per-game comment endpoints.
const express = require('express');
const { validate } = require('../validation/middleware');
const { resultSchema, commentSchema } = require('../validation/schemas');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { optionalAuth } = require('../middleware/optionalAuth');
const { commentLimiter, publicReadLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../middleware/asyncHandler');
const GameService = require('../services/GameService');
const CommentService = require('../services/CommentService');

const router = express.Router();

router.get(
  '/games',
  publicReadLimiter,
  optionalAuth,
  asyncHandler(async (_req, res) => {
    const games = await GameService.listGames();
    res.json(games);
  }),
);

router.post(
  '/games/:gameId/result',
  authMiddleware,
  requireAdmin,
  validate(resultSchema),
  asyncHandler(async (req, res) => {
    const game = await GameService.setResult(req.params.gameId, req.body.result);
    res.json({ success: true, game });
  }),
);

router.get(
  '/games/:gameId/comments',
  publicReadLimiter,
  optionalAuth,
  asyncHandler(async (req, res) => {
    const comments = await CommentService.listForGame(req.params.gameId, req.user?.id ?? null);
    res.json(comments);
  }),
);

router.post(
  '/games/:gameId/comments',
  commentLimiter,
  authMiddleware,
  validate(commentSchema),
  asyncHandler(async (req, res) => {
    const comment = await CommentService.create({
      gameId: req.params.gameId,
      userId: req.user.id,
      body: req.body.body,
    });
    res.json(comment);
  }),
);

module.exports = router;
