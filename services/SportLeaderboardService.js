'use strict';

const { Op } = require('sequelize');
const { User, League, GroupMember, sequelize } = require('../models');
const leaderboardCache = require('../lib/leaderboardCache');
const { sortLeaderboard } = require('../lib/scoring');
const { getJoinedGroupIds } = require('../lib/groups');
const { getViewerFriendIdSet } = require('../lib/friends');
const cache = require('../lib/cache');
const LeaderboardService = require('./LeaderboardService');

// Tier 34 — sport-scoped leaderboard reads.
//
// WHY THIS IS A PARALLEL PATH RATHER THAN A THIRD CONDITION IN LeaderboardService
// ------------------------------------------------------------------------------
// A sport filter means "every league of this sport", i.e. leagueId IN (...).
// The existing read paths cannot serve that correctly. All three of them
// collapse their score rows with:
//
//     new Map(rows.map((r) => [r.userId, r.points]))
//
// user_scores has one row per (userId, leagueId, seasonId), so ANY multi-row
// match means last-row-wins and the rest of the user's points are silently
// dropped. That is already a latent bug today for a league with two seasons;
// a sport filter would make it certain for the Football tab on day one, since
// PL and WC are both football.
//
// Fixing it inside the football path is a behaviour change to a live,
// mid-season product, so it is logged in TODO.md as its own piece of work.
// Here we simply do the aggregation correctly (SUM ... GROUP BY "userId") in
// new code, and leave the existing paths byte-identical.
//
// Everything downstream is reused, not duplicated: masking comes from
// LeaderboardService.applyMasking and ordering from lib/scoring.sortLeaderboard,
// so a sport-scoped row is shaped and censored exactly like an unscoped one.
//
// CACHE KEYS piggyback on the existing invalidation contract:
//   overall -> `overall:sp:<sport>`      cleared by invalidate('all')
//   group   -> `group:<id>:sp:<sport>`   ALSO matched by
//              invalidatePrefix('group:<id>'), because that helper matches
//              `key === prefix || key.startsWith(prefix + ':')`. Getting this
//              wrong would leave group membership changes stale on the sport
//              tabs only — an easy bug to miss.
//   friends -> uncached, mirroring getForFriends (per-viewer keyspace).

const SPORT_LEAGUES_TTL_MS = 5 * 60 * 1000;

// League ids for a sport. Cached because it is tiny, near-static, and read on
// every leaderboard request; a new league appears within 5 minutes.
async function resolveSportLeagueIds(sport) {
  return cache.getOrBuild(
    `sport-leagues:${sport}`,
    async () => {
      const leagues = await League.findAll({ where: { sport }, attributes: ['id'] });
      return leagues.map((l) => l.id);
    },
    SPORT_LEAGUES_TTL_MS,
  );
}

/**
 * Aggregate user_scores across every league of `sport`.
 *
 * Summed in SQL rather than in JS specifically to avoid the collapse bug
 * described above — a user with points in two leagues of the same sport (or
 * two seasons of one league) must have them added, not overwritten.
 *
 * @returns {Promise<Map<string, {points:number, picksScored:number, picksWon:number}>>}
 */
async function sumScoresForSport(sport, { userIds = null } = {}) {
  const leagueIds = await resolveSportLeagueIds(sport);
  const totals = new Map();
  // No leagues for this sport yet -> everyone legitimately sits on zero.
  if (leagueIds.length === 0) return totals;
  if (userIds && userIds.length === 0) return totals;

  const replacements = { leagueIds };
  let userClause = '';
  if (userIds) {
    userClause = 'AND "userId" IN (:userIds)';
    replacements.userIds = userIds;
  }

  const [rows] = await sequelize.query(
    `SELECT "userId",
            SUM(points)        AS points,
            SUM("picksScored") AS scored,
            SUM("picksWon")    AS won
       FROM user_scores
      WHERE "leagueId" IN (:leagueIds)
      ${userClause}
      GROUP BY "userId"`,
    { replacements },
  );

  for (const r of rows) {
    totals.set(r.userId, {
      // pg returns SUM() of an integer column as a bigint, which node-postgres
      // hands back as a string. Number() here or every comparison downstream
      // becomes lexicographic ("9" > "100").
      points: Number(r.points) || 0,
      picksScored: Number(r.scored) || 0,
      picksWon: Number(r.won) || 0,
    });
  }
  return totals;
}

const EMPTY = { points: 0, picksScored: 0, picksWon: 0 };

function toRow(user, totals) {
  const t = totals.get(user.id) || EMPTY;
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName || null,
    profileVisibility: user.profileVisibility,
    points: t.points,
    winRate: t.picksScored > 0 ? t.picksWon / t.picksScored : 0,
    currentWinStreak: user.currentWinStreak ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Overall
// ---------------------------------------------------------------------------

async function getOverallBySport(sport) {
  return leaderboardCache.getOrBuild(`overall:sp:${sport}`, async () => {
    // Every user is listed, including those with no in-scope picks, matching
    // the post-Tier-8.6 invariant that a filter never drops members.
    const users = await User.findAll({
      attributes: ['id', 'username', 'displayName', 'profileVisibility', 'currentWinStreak'],
    });
    const totals = await sumScoresForSport(sport);
    return users
      .map((u) => toRow(u, totals))
      .sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));
  });
}

// Same { rows, total, viewerRow, offset, limit } shape as
// LeaderboardService.getOverallSlimForViewer, so routes/leaderboard.js can
// swap one for the other without reshaping the response.
async function getOverallSlimBySportForViewer(
  { sport, overallOffset = 0, overallLimit = 50 } = {},
  viewer = null,
) {
  const raw = await getOverallBySport(sport);
  const ctx = {
    viewerId: viewer?.id ?? null,
    viewerIsAdmin: viewer?.role === 'admin',
    friendIds: await getViewerFriendIdSet(viewer?.id ?? null),
  };
  // Mask BEFORE ranking, exactly as the unscoped path does — ranks are
  // computed on the true order so a masked row keeps its real position.
  const ranked = LeaderboardService.applyMasking(raw, ctx).map((row, idx) => ({
    ...row,
    rank: idx + 1,
  }));
  return {
    rows: ranked.slice(overallOffset, overallOffset + overallLimit),
    total: ranked.length,
    viewerRow: viewer?.id ? ranked.find((r) => r.userId === viewer.id) || null : null,
    offset: overallOffset,
    limit: overallLimit,
  };
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

async function getForGroupBySport(
  groupId,
  { sport, orderBy = 'points', offset = 0, limit = 20, viewerId } = {},
) {
  const rowsRaw = await leaderboardCache.getOrBuild(`group:${groupId}:sp:${sport}`, async () => {
    const members = await GroupMember.findAll({ where: { groupId } });
    if (members.length === 0) return [];
    const memberIds = members.map((m) => m.userId);
    const memberUsers = await User.findAll({ where: { id: { [Op.in]: memberIds } } });
    const totals = await sumScoresForSport(sport, { userIds: memberIds });
    return memberUsers.map((u) => toRow(u, totals)).sort((a, b) => b.points - a.points);
  });

  const safeOrderBy = ['points', 'winRate', 'username'].includes(orderBy) ? orderBy : 'points';
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const sorted = sortLeaderboard(rowsRaw, safeOrderBy);
  return {
    rows: sorted.slice(safeOffset, safeOffset + safeLimit),
    total: sorted.length,
    viewerRow: viewerId ? sorted.find((r) => r.userId === viewerId) || null : null,
    orderBy: safeOrderBy,
    offset: safeOffset,
    limit: safeLimit,
  };
}

async function getForGroupBySportForViewer(groupId, opts, viewer) {
  const block = await getForGroupBySport(groupId, { ...opts, viewerId: viewer?.id ?? null });
  // Same implicit social contract as the unscoped path: fellow group members
  // are never masked from each other regardless of profileVisibility.
  const viewerInGroup = viewer?.id ? (await getJoinedGroupIds(viewer.id)).includes(groupId) : false;
  const ctx = {
    viewerId: viewer?.id ?? null,
    viewerIsAdmin: viewer?.role === 'admin',
    friendIds: await getViewerFriendIdSet(viewer?.id ?? null),
    exemptIds: viewerInGroup ? new Set(block.rows.map((r) => r.userId)) : null,
  };
  return {
    ...block,
    rows: LeaderboardService.applyMasking(block.rows, ctx),
    viewerRow: block.viewerRow ? LeaderboardService.applyMasking([block.viewerRow], ctx)[0] : null,
  };
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

async function getForFriendsBySportForViewer(viewer, { sport } = {}) {
  if (!viewer?.id) return { rows: [] };
  const friendIds = await getViewerFriendIdSet(viewer.id);
  const ids = [...new Set([...friendIds, viewer.id])];

  const users = await User.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ['id', 'username', 'displayName', 'profileVisibility', 'currentWinStreak'],
  });
  const totals = await sumScoresForSport(sport, { userIds: ids });
  const rows = users
    .map((u) => toRow(u, totals))
    .sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));

  // No exemptIds — the friend graph is not a blanket unmask (Tier 18 Chunk 4).
  const ctx = {
    viewerId: viewer.id,
    viewerIsAdmin: viewer.role === 'admin',
    friendIds,
  };
  return { rows: LeaderboardService.applyMasking(rows, ctx) };
}

module.exports = {
  resolveSportLeagueIds,
  sumScoresForSport,
  getOverallBySport,
  getOverallSlimBySportForViewer,
  getForGroupBySport,
  getForGroupBySportForViewer,
  getForFriendsBySportForViewer,
};
