'use strict';

// Tier 13 Chunk 2 — picks routes. Handlers parse + authorize + delegate to
// PickService and let the global error middleware translate AppError into
// the response shape.
const express = require('express');
const { validate } = require('../validation/middleware');
const { pickSchema } = require('../validation/schemas');
const { authMiddleware } = require('../middleware/auth');
const { pickLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../middleware/asyncHandler');
const PickService = require('../services/PickService');

const router = express.Router();

router.post(
  '/picks',
  pickLimiter,
  authMiddleware,
  validate(pickSchema),
  asyncHandler(async (req, res) => {
    await PickService.createPick({
      userId: req.user.id,
      gameId: req.body.gameId,
      choice: req.body.choice,
    });
    res.json({ success: true });
  }),
);

router.get(
  '/picks',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const picks = await PickService.listForUser(req.user.id);
    res.json(picks);
  }),
);

router.delete(
  '/picks/:id',
  pickLimiter,
  authMiddleware,
  asyncHandler(async (req, res) => {
    await PickService.deletePick({ pickId: req.params.id, userId: req.user.id });
    res.json({ success: true });
  }),
);

module.exports = router;
