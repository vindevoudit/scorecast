'use strict';

// Tier 13 Chunk 1 — pick routes extracted from server.js. Tier 5.2 cache
// invariant preserved: every mutation calls leaderboardCache.invalidate('all').
const express = require('express');
const { validate } = require('../validation/middleware');
const { pickSchema } = require('../validation/schemas');
const { authMiddleware } = require('../middleware/auth');
const { pickLimiter } = require('../middleware/rateLimit');
const { evaluateBadges } = require('../lib/badges');
const leaderboardCache = require('../lib/leaderboardCache');
const { Game, Pick } = require('../models');

const router = express.Router();

router.post('/picks', pickLimiter, authMiddleware, validate(pickSchema), async (req, res) => {
  const { gameId, choice } = req.body;

  try {
    const game = await Game.findByPk(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const gameDate = new Date(game.date);
    const now = new Date();
    if (game.result || gameDate <= now) {
      return res
        .status(400)
        .json({ error: 'Picks can only be created or changed for upcoming games' });
    }

    const existingPick = await Pick.findOne({
      where: { userId: req.user.id, gameId },
    });

    if (existingPick) {
      existingPick.choice = choice;
      existingPick.submittedAt = new Date();
      await existingPick.save();
    } else {
      await Pick.create({ userId: req.user.id, gameId, choice });
    }

    evaluateBadges(req.user.id).catch(() => {});
    leaderboardCache.invalidate('all');

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit pick' });
  }
});

router.get('/picks', authMiddleware, async (req, res) => {
  try {
    const picks = await Pick.findAll({ where: { userId: req.user.id } });
    res.json(picks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch picks' });
  }
});

router.delete('/picks/:id', pickLimiter, authMiddleware, async (req, res) => {
  try {
    const pick = await Pick.findByPk(req.params.id);
    if (!pick) return res.status(404).json({ error: 'Pick not found' });
    if (pick.userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const game = await Game.findByPk(pick.gameId);
    if (game) {
      const now = new Date();
      if (game.result || new Date(game.date) <= now) {
        return res.status(400).json({ error: 'Picks can only be removed before kickoff' });
      }
    }

    await pick.destroy();
    leaderboardCache.invalidate('all');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete pick' });
  }
});

module.exports = router;
