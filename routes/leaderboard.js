'use strict';

// Tier 13 Chunk 2 — leaderboard route. Delegates to LeaderboardService,
// which wraps lib/leaderboardCache (30 s TTL) + the sort + paging helpers.
// Post-Tier-4b: accepts optional `leagueId` / `seasonId` query params that
// scope BOTH the overall and group blocks to picks on games in that
// league/season pair. The existing validate() middleware only checks
// req.body, so the schema is applied inline via safeParse against req.query.
const express = require('express');
const { optionalAuth } = require('../middleware/optionalAuth');
const { publicReadLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../middleware/asyncHandler');
const LeaderboardService = require('../services/LeaderboardService');
const { leaderboardQuerySchema } = require('../validation/schemas');

const router = express.Router();

router.get(
  '/leaderboard',
  publicReadLimiter,
  optionalAuth,
  asyncHandler(async (req, res) => {
    const parsed = leaderboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const summary = issue
        ? `${issue.path.join('.') ? `${issue.path.join('.')}: ` : ''}${issue.message}`
        : 'Invalid query parameters';
      return res.status(400).json({ error: summary, issues: parsed.error.issues });
    }
    const { groupId, orderBy, offset, limit, leagueId, seasonId } = parsed.data;
    const filterOpts = { leagueId, seasonId };

    const overall = await LeaderboardService.getOverallForViewer(filterOpts, req.user ?? null);
    let groupBlock = {
      rows: [],
      total: 0,
      viewerRow: null,
      orderBy: 'points',
      offset: 0,
      limit: 20,
    };
    if (groupId) {
      groupBlock = await LeaderboardService.getForGroupForViewer(
        groupId,
        { orderBy, offset, limit, ...filterOpts },
        req.user ?? null,
      );
    }
    res.json({ overall, group: groupBlock.rows, groupMeta: groupBlock });
  }),
);

module.exports = router;
