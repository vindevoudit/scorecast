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
    const { groupId, orderBy, offset, limit, overallOffset, overallLimit, leagueId, seasonId } =
      parsed.data;
    const filterOpts = { leagueId, seasonId };

    // Tier 24 Chunk 4 — overall block is now slim by default. Returns
    // top-N (default 50) + viewerRow + total, instead of the entire
    // sorted list. Keeps the response payload small at fresh-launch
    // 10k users without dropping rank info or the viewer-context. The
    // legacy `overall` array shape is preserved for backwards-compat
    // (existing clients consume `data.overall` as a list); we just
    // populate it from `data.overallMeta.rows`.
    const overallBlock = await LeaderboardService.getOverallSlimForViewer(
      { ...filterOpts, overallOffset, overallLimit },
      req.user ?? null,
    );
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

    // Friends block — the viewer + every accepted friend, scored from the
    // materialized tables so they appear regardless of the overall top-N
    // slice. Anonymous viewers get an empty list.
    const friendsBlock = req.user
      ? await LeaderboardService.getForFriendsForViewer(req.user, filterOpts)
      : { rows: [] };

    res.json({
      overall: overallBlock.rows,
      overallMeta: overallBlock,
      group: groupBlock.rows,
      groupMeta: groupBlock,
      friends: friendsBlock.rows,
    });
  }),
);

module.exports = router;
