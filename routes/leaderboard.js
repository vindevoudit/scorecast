'use strict';

// Tier 13 Chunk 1 — leaderboard route extracted from server.js. Reads through
// lib/leaderboardCache (30 s TTL). All mutations elsewhere must invalidate
// (Tier 5.2 invariant — call sites preserved during the refactor).
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { sortLeaderboard } = require('../lib/scoring');
const { buildUserSummary } = require('../lib/users');
const { buildGroupLeaderboard } = require('../lib/groups');
const leaderboardCache = require('../lib/leaderboardCache');

const router = express.Router();

router.get('/leaderboard', authMiddleware, async (req, res) => {
  try {
    const overall = await leaderboardCache.getOrBuild('overall', buildUserSummary);
    const groupId = req.query.groupId;

    let groupBlock = {
      rows: [],
      total: 0,
      viewerRow: null,
      orderBy: 'points',
      offset: 0,
      limit: 20,
    };
    if (groupId) {
      const groupRowsRaw = await leaderboardCache.getOrBuild(`group:${groupId}`, () =>
        buildGroupLeaderboard(groupId),
      );
      const orderBy = ['points', 'winRate', 'username'].includes(req.query.orderBy)
        ? req.query.orderBy
        : 'points';
      const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
      const sorted = sortLeaderboard(groupRowsRaw, orderBy);
      const rows = sorted.slice(offset, offset + limit);
      const viewerRow = sorted.find((r) => r.userId === req.user.id) || null;
      groupBlock = { rows, total: sorted.length, viewerRow, orderBy, offset, limit };
    }

    res.json({ overall, group: groupBlock.rows, groupMeta: groupBlock });
  } catch (error) {
    req.log.error({ err: error }, 'handler error');
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
