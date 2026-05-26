'use strict';

// Tier 13 Chunk 2 — LeaderboardService. Wraps lib/leaderboardCache so route
// handlers + jobs don't touch the cache directly. Tier 5.2 invariant: every
// mutation that affects standings must call invalidate() through this
// service before responding.
//
// Tier 8.6 — adds a viewer-aware masking layer. The cache stays
// viewer-agnostic (otherwise its keyspace would explode); rows pulled from
// the cache are projected through applyMasking() per-request using the
// viewer's friend set + group memberships + admin flag.
const leaderboardCache = require('../lib/leaderboardCache');
const { sortLeaderboard } = require('../lib/scoring');
const { buildUserSummary } = require('../lib/users');
const { buildGroupLeaderboard, getJoinedGroupIds } = require('../lib/groups');
const { getViewerFriendIdSet } = require('../lib/friends');

// Stable masked label. Uses the user's displayName if set (still surfaces
// some identity to anyone who knows the displayName, but matches the plan's
// "fall back to Player #..." rule); otherwise the first 4 hex chars of the
// uuid, dropping dashes, so the label is stable across refreshes.
function maskedLabelFor(row) {
  if (row.displayName) return row.displayName;
  const short = String(row.userId).replace(/-/g, '').slice(0, 4);
  return `Player #${short}`;
}

function shouldMaskRow(row, { viewerId, viewerIsAdmin, friendIds, exemptIds }) {
  if (viewerIsAdmin) return false;
  if (viewerId && row.userId === viewerId) return false;
  if (row.profileVisibility === 'public') return false;
  if (exemptIds && exemptIds.has(row.userId)) return false;
  if (row.profileVisibility === 'friends' && friendIds.has(row.userId)) return false;
  return true;
}

function applyMasking(rows, ctx) {
  return rows.map((row) => {
    if (!shouldMaskRow(row, ctx)) return row;
    return {
      ...row,
      username: maskedLabelFor(row),
      displayName: null,
      isMasked: true,
    };
  });
}

// Cache key shape with filter axes encoded. The `?? '*'` sentinel keeps
// the unfiltered case as `overall:l:*:s:*` / `group:<id>:l:*:s:*` (instead
// of `overall:l:undefined:s:undefined`) so two requests with no filter
// land on the same key.
function buildKey(scope, { leagueId, seasonId } = {}) {
  return `${scope}:l:${leagueId ?? '*'}:s:${seasonId ?? '*'}`;
}

async function getOverall({ leagueId, seasonId } = {}) {
  return leaderboardCache.getOrBuild(buildKey('overall', { leagueId, seasonId }), () =>
    buildUserSummary({ leagueId, seasonId }),
  );
}

async function getOverallForViewer(opts = {}, viewer = null) {
  const rows = await getOverall(opts);
  const ctx = {
    viewerId: viewer?.id ?? null,
    viewerIsAdmin: viewer?.role === 'admin',
    friendIds: await getViewerFriendIdSet(viewer?.id ?? null),
  };
  return applyMasking(rows, ctx);
}

async function getForGroup(
  groupId,
  { orderBy = 'points', offset = 0, limit = 20, viewerId, leagueId, seasonId } = {},
) {
  const groupRowsRaw = await leaderboardCache.getOrBuild(
    buildKey(`group:${groupId}`, { leagueId, seasonId }),
    () => buildGroupLeaderboard(groupId, { leagueId, seasonId }),
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

async function getForGroupForViewer(groupId, opts, viewer) {
  const block = await getForGroup(groupId, { ...opts, viewerId: viewer?.id ?? null });
  // Implicit social contract — if the viewer belongs to the same group as
  // a target, the target's username is visible regardless of their
  // profileVisibility. The exempt set is the group's own member list (which
  // is exactly what buildGroupLeaderboard returned).
  const viewerInGroup = viewer?.id ? (await getJoinedGroupIds(viewer.id)).includes(groupId) : false;
  const exemptIds = viewerInGroup ? new Set(block.rows.map((r) => r.userId)) : null;
  const ctx = {
    viewerId: viewer?.id ?? null,
    viewerIsAdmin: viewer?.role === 'admin',
    friendIds: await getViewerFriendIdSet(viewer?.id ?? null),
    exemptIds,
  };
  const maskedRows = applyMasking(block.rows, ctx);
  const maskedViewerRow = block.viewerRow ? applyMasking([block.viewerRow], ctx)[0] : null;
  return { ...block, rows: maskedRows, viewerRow: maskedViewerRow };
}

function invalidate(scope) {
  leaderboardCache.invalidate(scope);
}

// Prefix-aware invalidator. Required because adding filter axes to the
// cache key means one logical scope (a group) now spans many keys
// (`group:<id>:l:*:s:*`, `group:<id>:l:<uuid>:s:*`, etc). Callers that
// already use `invalidate('all')` keep working unchanged — `'all'` blows
// away every entry regardless of key shape.
function invalidatePrefix(prefix) {
  leaderboardCache.invalidatePrefix(prefix);
}

function stats() {
  return leaderboardCache.stats();
}

module.exports = {
  getOverall,
  getOverallForViewer,
  getForGroup,
  getForGroupForViewer,
  invalidate,
  invalidatePrefix,
  stats,
  // Tier 18 Chunk 4 — reused by PickService.listFriendsPicks so private
  // friends still show in friend-pick lists (masked) instead of leaking
  // their username, matching the Tier 8.6 contract.
  applyMasking,
  maskedLabelFor,
};
