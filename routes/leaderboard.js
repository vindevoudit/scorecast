'use strict';

// Tier 13 Chunk 2 — leaderboard route. Delegates to LeaderboardService,
// which wraps lib/leaderboardCache (30 s TTL) + the sort + paging helpers.
const express = require('express');
const { optionalAuth } = require('../middleware/optionalAuth');
const { publicReadLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../middleware/asyncHandler');
const LeaderboardService = require('../services/LeaderboardService');

const router = express.Router();

router.get(
  '/leaderboard',
  publicReadLimiter,
  optionalAuth,
  asyncHandler(async (req, res) => {
    const overall = await LeaderboardService.getOverallForViewer(req.user ?? null);
    let groupBlock = {
      rows: [],
      total: 0,
      viewerRow: null,
      orderBy: 'points',
      offset: 0,
      limit: 20,
    };
    if (req.query.groupId) {
      groupBlock = await LeaderboardService.getForGroupForViewer(
        req.query.groupId,
        {
          orderBy: req.query.orderBy,
          offset: req.query.offset,
          limit: req.query.limit,
        },
        req.user ?? null,
      );
    }
    res.json({ overall, group: groupBlock.rows, groupMeta: groupBlock });
  }),
);

module.exports = router;
