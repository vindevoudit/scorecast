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
//
// Tier 24 — reads materialized totals from `user_scores` /
// `user_scores_overall` instead of recomputing every aggregate from
// raw Pick.findAll + Game.findAll. The dual-writer in PickService /
// GameService maintains the materialized tables on every mutation, so
// reads are a single indexed SELECT (sub-ms) regardless of user count.
// Legacy `buildUserSummary` / `buildGroupLeaderboard` are preserved
// behind a `TIER24_LEGACY_LEADERBOARD=1` rollback flag.
const { Op } = require('sequelize');
const leaderboardCache = require('../lib/leaderboardCache');
const { sortLeaderboard } = require('../lib/scoring');
const { buildUserSummary } = require('../lib/users');
const { getJoinedGroupIds } = require('../lib/groups');
const { getViewerFriendIdSet } = require('../lib/friends');
const logger = require('../lib/logger');
const { User, UserScore, UserScoreOverall, GroupMember } = require('../models');

// Tier 24 — parity log. When PARITY_LOG_ENABLED=1, every write hook
// (PickService / GameService) can call assertParity() after committing
// to compare the materialized user_scores row against what
// buildUserSummary would produce. Any drift is logged at warn level as
// `tier24.parity_mismatch` so the e2e verification gate (Layer 1's
// `npx playwright test` run with the env var set) can assert silence
// across the entire run.
//
// Wrapped in a top-level try/catch so a parity-check failure can NEVER
// surface as a real error in the request path; it's diagnostic only.
const PARITY_LOG_ENABLED = process.env.PARITY_LOG_ENABLED === '1';

async function assertParity({ userId, leagueId = null, seasonId = null } = {}) {
  if (!PARITY_LOG_ENABLED) return;
  try {
    const { UserScore, UserScoreOverall } = require('../models');
    // Overall comparison: every user's user_scores_overall row vs
    // unfiltered buildUserSummary.
    const expected = await buildUserSummary({});
    const actual = await UserScoreOverall.findAll();
    const expectedById = new Map(expected.map((u) => [u.userId, u.points]));
    const actualById = new Map(actual.map((u) => [u.userId, u.points]));
    const ids = new Set([...expectedById.keys(), ...actualById.keys()]);
    for (const id of ids) {
      if (userId && id !== userId) continue;
      const e = expectedById.get(id) ?? 0;
      const a = actualById.get(id) ?? 0;
      if (e !== a) {
        logger.warn(
          { userId: id, expected: e, actual: a, leagueId, seasonId, scope: 'overall' },
          'tier24.parity_mismatch',
        );
      }
    }
    // Per-(league, season) comparison: walk every (leagueId, seasonId)
    // combo present in the actual table and compare.
    const filtered = await UserScore.findAll();
    const seen = new Set();
    for (const row of filtered) {
      const key = `${row.leagueId}|${row.seasonId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const scopedExpected = await buildUserSummary({
        leagueId: row.leagueId,
        seasonId: row.seasonId,
      });
      const expById = new Map(scopedExpected.map((u) => [u.userId, u.points]));
      const actRows = await UserScore.findAll({
        where: { leagueId: row.leagueId, seasonId: row.seasonId },
      });
      const actById = new Map(actRows.map((r) => [r.userId, r.points]));
      const allIds = new Set([...expById.keys(), ...actById.keys()]);
      for (const id of allIds) {
        if (userId && id !== userId) continue;
        const e = expById.get(id) ?? 0;
        const a = actById.get(id) ?? 0;
        if (e !== a) {
          logger.warn(
            {
              userId: id,
              expected: e,
              actual: a,
              leagueId: row.leagueId,
              seasonId: row.seasonId,
              scope: 'filtered',
            },
            'tier24.parity_mismatch',
          );
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'tier24.parity_check_threw');
  }
}

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
      // Don't broadcast a private player's activity behind their masked
      // label — drop the win-streak so the leaderboard chip doesn't render.
      currentWinStreak: 0,
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

// Tier 24 — overall leaderboard read. Replaces the O(picks × games) JS
// aggregation in lib/users.js `buildUserSummary` with a single indexed
// SQL read against the materialized user_scores / user_scores_overall
// tables maintained by the dual-writer.
//
// Read path:
//  - Unfiltered: SELECT from user_scores_overall (single PK lookup +
//    sort by points DESC; backed by the partial index)
//  - Filtered (leagueId or seasonId set): resolve the league/season
//    code-to-UUID inputs through their existing patterns (callers pass
//    UUIDs already because the inline validate in routes/leaderboard.js
//    handles the safeParse), then SELECT from user_scores
//
// Every row carries the user's username + displayName + profileVisibility
// so the masking layer can project without a second DB round-trip per
// row (matches the buildUserSummary contract).
//
// Caller contract: returns the SAME row shape that buildUserSummary
// returned — { userId, username, displayName, profileVisibility, points }
// — but rows are pre-sorted by points DESC and inactive users
// (points=0) are EXCLUDED from the materialized tables. The 30s cache
// is preserved as a thin per-replica buffer; reads are sub-ms now so
// the cache mostly absorbs concurrent identical requests.
async function getOverall({ leagueId, seasonId } = {}) {
  return leaderboardCache.getOrBuild(buildKey('overall', { leagueId, seasonId }), async () => {
    // Defensive: keep the legacy fallback available behind a debug env
    // toggle for one cycle so a rollback can be done by setting the
    // flag (no code change required). Default OFF — the dual-writer
    // verification gate has already proved the materialized path.
    if (process.env.TIER24_LEGACY_LEADERBOARD === '1') {
      return buildUserSummary({ leagueId, seasonId });
    }

    // Pull every user once and LEFT JOIN the relevant scores table
    // in-memory. Preserves the post-Tier-8.6 invariant that users with
    // zero in-scope picks stay listed at points: 0 (no member drop).
    // Pre-launch every user fits in a single page; post-launch (when
    // user count grows), Chunk 4 will paginate this at the route layer.
    const allUsers = await User.findAll({
      attributes: ['id', 'username', 'displayName', 'profileVisibility', 'currentWinStreak'],
    });

    let pointsByUser;
    if (leagueId || seasonId) {
      const where = {};
      if (leagueId) where.leagueId = leagueId;
      if (seasonId) where.seasonId = seasonId;
      const scores = await UserScore.findAll({ where, attributes: ['userId', 'points'] });
      pointsByUser = new Map(scores.map((r) => [r.userId, r.points]));
    } else {
      const scores = await UserScoreOverall.findAll({ attributes: ['userId', 'points'] });
      pointsByUser = new Map(scores.map((r) => [r.userId, r.points]));
    }

    const rows = allUsers.map((u) => ({
      userId: u.id,
      username: u.username,
      displayName: u.displayName || null,
      profileVisibility: u.profileVisibility,
      points: pointsByUser.get(u.id) ?? 0,
      currentWinStreak: u.currentWinStreak ?? 0,
    }));
    // Pre-sorted by the SQL ORDER BY when reading from the materialized
    // table, but the LEFT-JOIN-style merge above breaks that order;
    // sort here so the caller still gets points-DESC rows. Stable
    // secondary on userId ASC matches the partial index order.
    rows.sort((a, b) => (b.points || 0) - (a.points || 0) || a.userId.localeCompare(b.userId));
    return rows;
  });
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

// Tier 24 Chunk 4 — slim overall block. Returns { rows, total, viewerRow }
// instead of the full sorted list. `rows` is the top-N slice
// (default first 50); `viewerRow` is the viewer's row regardless of
// offset/limit so the UI can render "your rank: 247" even when the
// viewer is well outside the top of the page. Applies the masking
// projection before slicing — the rank order itself is unmasked, so a
// masked row stays at its true position.
async function getOverallSlimForViewer(
  { leagueId, seasonId, overallOffset = 0, overallLimit = 50 } = {},
  viewer = null,
) {
  const rows = await getOverallForViewer({ leagueId, seasonId }, viewer);
  const ranked = rows.map((row, idx) => ({ ...row, rank: idx + 1 }));
  const slice = ranked.slice(overallOffset, overallOffset + overallLimit);
  const viewerRow = viewer?.id ? ranked.find((r) => r.userId === viewer.id) || null : null;
  return {
    rows: slice,
    total: ranked.length,
    viewerRow,
    offset: overallOffset,
    limit: overallLimit,
  };
}

// Tier 24 — group leaderboard read. Replaces lib/groups.js
// `buildGroupLeaderboard` (which scanned every pick on every game for
// every group member) with a single indexed read against user_scores
// JOIN group_members. Carries the same row shape — including the
// computed `winRate` — so the masking + sorting + pagination above
// stays unchanged.
async function getForGroup(
  groupId,
  { orderBy = 'points', offset = 0, limit = 20, viewerId, leagueId, seasonId } = {},
) {
  const groupRowsRaw = await leaderboardCache.getOrBuild(
    buildKey(`group:${groupId}`, { leagueId, seasonId }),
    async () => {
      if (process.env.TIER24_LEGACY_LEADERBOARD === '1') {
        return require('../lib/groups').buildGroupLeaderboard(groupId, { leagueId, seasonId });
      }

      // Get the group's member list (every user shown on the group
      // leaderboard regardless of activity).
      const members = await GroupMember.findAll({ where: { groupId } });
      if (members.length === 0) return [];
      const memberIds = members.map((m) => m.userId);
      const memberUsers = await User.findAll({ where: { id: memberIds } });

      // Pull the matching score row per member.
      let pointsByUser;
      let scoredByUser;
      let wonByUser;
      if (leagueId || seasonId) {
        const where = { userId: { [Op.in]: memberIds } };
        if (leagueId) where.leagueId = leagueId;
        if (seasonId) where.seasonId = seasonId;
        const rows = await UserScore.findAll({
          where,
          attributes: ['userId', 'points', 'picksScored', 'picksWon'],
        });
        pointsByUser = new Map(rows.map((r) => [r.userId, r.points]));
        scoredByUser = new Map(rows.map((r) => [r.userId, r.picksScored]));
        wonByUser = new Map(rows.map((r) => [r.userId, r.picksWon]));
      } else {
        const rows = await UserScoreOverall.findAll({
          where: { userId: { [Op.in]: memberIds } },
          attributes: ['userId', 'points', 'picksScored', 'picksWon'],
        });
        pointsByUser = new Map(rows.map((r) => [r.userId, r.points]));
        scoredByUser = new Map(rows.map((r) => [r.userId, r.picksScored]));
        wonByUser = new Map(rows.map((r) => [r.userId, r.picksWon]));
      }

      return memberIds
        .map((memberId) => {
          const user = memberUsers.find((u) => u.id === memberId);
          const points = pointsByUser.get(memberId) ?? 0;
          const scored = scoredByUser.get(memberId) ?? 0;
          const won = wonByUser.get(memberId) ?? 0;
          return {
            userId: memberId,
            username: user?.username || 'Unknown',
            displayName: user?.displayName || null,
            profileVisibility: user?.profileVisibility || 'public',
            points,
            winRate: scored > 0 ? won / scored : 0,
            currentWinStreak: user?.currentWinStreak ?? 0,
          };
        })
        .sort((a, b) => b.points - a.points);
    },
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

// Friends leaderboard read. Mirrors getForGroup but keyed on the viewer's
// accepted-friend set + the viewer themselves, instead of a group's member
// list. Reads the same materialized score tables so a friend (or the viewer)
// sitting outside the overall top-N still appears with correct points. No
// cache: the friend set is per-viewer and these are a couple of sub-ms indexed
// SELECTs — caching would add a per-viewer keyspace + a new invalidation
// surface for no real gain.
async function getForFriends(viewerId, { leagueId, seasonId } = {}) {
  if (!viewerId) return { rows: [] };
  const friendIds = await getViewerFriendIdSet(viewerId);
  const ids = new Set(friendIds);
  ids.add(viewerId);
  const idList = [...ids];
  if (idList.length === 0) return { rows: [] };

  const users = await User.findAll({
    where: { id: { [Op.in]: idList } },
    attributes: ['id', 'username', 'displayName', 'profileVisibility', 'currentWinStreak'],
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  let pointsByUser;
  if (leagueId || seasonId) {
    const where = { userId: { [Op.in]: idList } };
    if (leagueId) where.leagueId = leagueId;
    if (seasonId) where.seasonId = seasonId;
    const scores = await UserScore.findAll({ where, attributes: ['userId', 'points'] });
    pointsByUser = new Map(scores.map((r) => [r.userId, r.points]));
  } else {
    const scores = await UserScoreOverall.findAll({
      where: { userId: { [Op.in]: idList } },
      attributes: ['userId', 'points'],
    });
    pointsByUser = new Map(scores.map((r) => [r.userId, r.points]));
  }

  const rows = idList
    .map((id) => {
      const user = userById.get(id);
      if (!user) return null;
      return {
        userId: id,
        username: user.username,
        displayName: user.displayName || null,
        profileVisibility: user.profileVisibility,
        points: pointsByUser.get(id) ?? 0,
        currentWinStreak: user.currentWinStreak ?? 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.points || 0) - (a.points || 0) || a.userId.localeCompare(b.userId));
  return { rows };
}

async function getForFriendsForViewer(viewer, opts = {}) {
  if (!viewer?.id) return { rows: [] };
  const block = await getForFriends(viewer.id, opts);
  // Mask per the listFriendsPicks contract (Tier 18 Chunk 4): a
  // 'friends'-visibility friend stays unmasked; a 'private' friend is masked;
  // self is never masked (shouldMaskRow short-circuits on row.userId ===
  // viewerId). No exemptIds — the friend graph isn't a blanket unmask.
  const ctx = {
    viewerId: viewer.id,
    viewerIsAdmin: viewer.role === 'admin',
    friendIds: await getViewerFriendIdSet(viewer.id),
  };
  return { ...block, rows: applyMasking(block.rows, ctx) };
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
  getOverallSlimForViewer,
  getForGroup,
  getForGroupForViewer,
  getForFriends,
  getForFriendsForViewer,
  invalidate,
  invalidatePrefix,
  stats,
  // Tier 18 Chunk 4 — reused by PickService.listFriendsPicks so private
  // friends still show in friend-pick lists (masked) instead of leaking
  // their username, matching the Tier 8.6 contract.
  applyMasking,
  maskedLabelFor,
  // Tier 24 — parity log diagnostic. No-op unless PARITY_LOG_ENABLED=1.
  // Called by write hooks after they commit; surfaces drift between
  // user_scores and buildUserSummary as a `tier24.parity_mismatch` warn
  // log so the e2e verification gate can assert silence.
  assertParity,
};
