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

// Tier 18 Chunk 4 — friends' picks visibility. Single endpoint serves
// both surfaces: optional ?gameId=<uuid> scopes to one game (used by
// the GameCard inline expand); omitted form returns every friend pick
// within the 30-day window (used by DataContext bulk load + the
// PicksHistory "Friends' Picks" tab). Empty array when viewer has no
// friends OR friends haven't picked anything in scope.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.get(
  '/picks/friends',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const gameIdRaw = req.query.gameId;
    let gameId;
    if (gameIdRaw !== undefined) {
      if (typeof gameIdRaw !== 'string' || !UUID_RE.test(gameIdRaw)) {
        return res.status(400).json({ error: 'gameId must be a UUID' });
      }
      gameId = gameIdRaw;
    }
    const rows = await PickService.listFriendsPicks(req.user.id, { gameId });
    return res.json(rows);
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
