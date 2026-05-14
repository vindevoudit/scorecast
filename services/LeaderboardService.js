'use strict';

// Tier 13 Chunk 2 — LeaderboardService. Wraps lib/leaderboardCache so route
// handlers + jobs don't touch the cache directly. Tier 5.2 invariant: every
// mutation that affects standings must call invalidate() through this
// service before responding.
const leaderboardCache = require('../lib/leaderboardCache');
const { sortLeaderboard } = require('../lib/scoring');
const { buildUserSummary } = require('../lib/users');
const { buildGroupLeaderboard } = require('../lib/groups');

async function getOverall() {
  return leaderboardCache.getOrBuild('overall', buildUserSummary);
}

async function getForGroup(groupId, { orderBy = 'points', offset = 0, limit = 20, viewerId } = {}) {
  const groupRowsRaw = await leaderboardCache.getOrBuild(`group:${groupId}`, () =>
    buildGroupLeaderboard(groupId),
  );
  const safeOrderBy = ['points', 'winRate', 'username'].includes(orderBy) ? orderBy : 'points';
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const sorted = sortLeaderboard(groupRowsRaw, safeOrderBy);
  const rows = sorted.slice(safeOffset, safeOffset + safeLimit);
  const viewerRow = viewerId ? sorted.find((r) => r.userId === viewerId) || null : null;
  return {
    rows,
    total: sorted.length,
    viewerRow,
    orderBy: safeOrderBy,
    offset: safeOffset,
    limit: safeLimit,
  };
}

function invalidate(scope) {
  leaderboardCache.invalidate(scope);
}

function stats() {
  return leaderboardCache.stats();
}

module.exports = { getOverall, getForGroup, invalidate, stats };
