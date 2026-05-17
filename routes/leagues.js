'use strict';

// Tier 4b Chunk 3 — public, anon-safe leagues + seasons endpoints. Used
// by the games-view picker so visitors can filter by competition without
// signing in. Only active leagues are exposed; inactive leagues (e.g.
// World Cup outside the tournament cycle) stay hidden.
const express = require('express');
const { League, Season } = require('../models');
const { publicReadLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.get(
  '/leagues',
  publicReadLimiter,
  asyncHandler(async (_req, res) => {
    const leagues = await League.findAll({
      where: { active: true },
      order: [['name', 'ASC']],
      include: [
        {
          model: Season,
          as: 'seasons',
          attributes: ['id', 'year', 'current'],
          required: false,
        },
      ],
    });
    res.json(
      leagues.map((l) => ({
        id: l.id,
        name: l.name,
        sourceLeagueId: l.sourceLeagueId,
        country: l.country,
        seasons: (l.seasons || [])
          .map((s) => ({ id: s.id, year: s.year, current: s.current }))
          .sort((a, b) => b.year - a.year),
      })),
    );
  }),
);

module.exports = router;
