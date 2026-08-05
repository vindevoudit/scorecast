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
const SportLeaderboardService = require('../services/SportLeaderboardService');
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
    const {
      groupId,
      orderBy,
      offset,
      limit,
      overallOffset,
      overallLimit,
      leagueId,
      seasonId,
      sport,
    } = parsed.data;
    const filterOpts = { leagueId, seasonId };

    // Tier 34 — sport scoping runs through SportLeaderboardService, a parallel
    // read path. `sport` is absent on every pre-Tier-34 request, so the
    // existing branch below is what football and "All sports" still take.
    //
    // The split exists because a sport filter resolves to leagueId IN (...),
    // and the unscoped builders collapse multi-row score matches with
    // `new Map(rows.map(...))` — last row wins, so a user with points in two
    // leagues of one sport would silently lose one. The sport path sums in
    // SQL instead. See the header of SportLeaderboardService for the full note.
    const bySport = Boolean(sport);

    // Tier 24 Chunk 4 — overall block is now slim by default. Returns
    // top-N (default 50) + viewerRow + total, instead of the entire
    // sorted list. Keeps the response payload small at fresh-launch
    // 10k users without dropping rank info or the viewer-context. The
    // legacy `overall` array shape is preserved for backwards-compat
    // (existing clients consume `data.overall` as a list); we just
    // populate it from `data.overallMeta.rows`.
    const overallBlock = bySport
      ? await SportLeaderboardService.getOverallSlimBySportForViewer(
          { sport, overallOffset, overallLimit },
          req.user ?? null,
        )
      : await LeaderboardService.getOverallSlimForViewer(
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
      groupBlock = bySport
        ? await SportLeaderboardService.getForGroupBySportForViewer(
            groupId,
            { sport, orderBy, offset, limit },
            req.user ?? null,
          )
        : await LeaderboardService.getForGroupForViewer(
            groupId,
            { orderBy, offset, limit, ...filterOpts },
            req.user ?? null,
          );
    }

    // Friends block — the viewer + every accepted friend, scored from the
    // materialized tables so they appear regardless of the overall top-N
    // slice. Anonymous viewers get an empty list.
    let friendsBlock = { rows: [] };
    if (req.user) {
      friendsBlock = bySport
        ? await SportLeaderboardService.getForFriendsBySportForViewer(req.user, { sport })
        : await LeaderboardService.getForFriendsForViewer(req.user, filterOpts);
    }

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
