'use strict';

// Trophy Cabinet — per-user, per-stage World Cup retrospective. For each
// tournament stage (Group Stage → Final) it reports the target's placement +
// percentile OVERALL (among everyone who picked in that stage) and within the
// target's ScoreCast social groups, plus a medal showcase.
//
// Computed ON-THE-FLY and cached 5 min (lib/cache.js), NOT materialized. The
// WC is bounded (~104 games, a handful per stage) so scoring every user's WC
// picks is a sub-second cold-path scan; the materialized user_scores tables
// (Tier 24) have no stage axis and adding one would be invasive + high-risk.
// If this ever becomes hot it can be materialized later — see ARCHITECTURE.md.
//
// Visibility: the route gates on canViewProfile (same as the profile route).
// A cabinet reveals ONLY the subject's own rank numbers — never a roster of
// other users — so no per-row masking is needed. The group section, however,
// respects who's looking: self/admin see all the target's groups; anyone else
// sees only groups they SHARE with the target, so a private membership isn't
// leaked (that's why the cache key includes the viewer id).

const { Op } = require('sequelize');
const { League, Game, Pick } = require('../models');
const cache = require('../lib/cache');
const { scorePick } = require('../lib/scoring');
const { getJoinedGroupIds, getGroupsForUser } = require('../lib/groups');
const { WC_STAGE_ORDER, stageLabel, medalFor } = require('../lib/stages');

const CACHE_TTL_MS = 5 * 60 * 1000;
const WC_SOURCE_LEAGUE_ID = 'WC';

// Competition rank for `targetPoints` within `allPoints` (the participant
// point values). 1-based; ties share the better rank (standard competition
// ranking): rank = 1 + count(strictly greater). `targetPoints` must be one of
// the participants' values.
function rankAmong(targetPoints, allPoints) {
  let greater = 0;
  for (const p of allPoints) {
    if (p > targetPoints) greater += 1;
  }
  return greater + 1;
}

// "Top X%" from a 1-based rank out of `total`. Clamped to [1, 100] so rank 1
// reads "Top 1%" (not "Top 0%") and a lone participant reads "Top 100%".
function topPercentOf(rank, total) {
  if (!total || total <= 0) return 100;
  return Math.min(100, Math.max(1, Math.round((rank / total) * 100)));
}

// Medal tally + best finish across a computed stage list, for the cabinet
// headline showcase.
function buildShowcase(stages) {
  let gold = 0;
  let silver = 0;
  let bronze = 0;
  let entered = 0;
  let bestFinish = null;
  for (const s of stages) {
    if (!s.overall) continue;
    entered += 1;
    if (s.overall.medal === 'gold') gold += 1;
    else if (s.overall.medal === 'silver') silver += 1;
    else if (s.overall.medal === 'bronze') bronze += 1;
    if (!bestFinish || s.overall.rank < bestFinish.rank) {
      bestFinish = { rank: s.overall.rank, stage: s.stage, label: s.label };
    }
  }
  return { gold, silver, bronze, enteredStages: entered, bestFinish };
}

// Distinct stage tokens present in the games, ordered by WC_STAGE_ORDER first
// then any unexpected tokens alphabetically (so an upstream surprise still
// shows up, at the end).
function orderStages(stageTokens) {
  const present = [...new Set(stageTokens.filter(Boolean))];
  return present.sort((a, b) => {
    const ia = WC_STAGE_ORDER.indexOf(a);
    const ib = WC_STAGE_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

function emptyCabinet(targetUser) {
  return {
    userId: targetUser.id,
    username: targetUser.username,
    displayName: targetUser.displayName || null,
    tournament: null,
    showcase: { gold: 0, silver: 0, bronze: 0, enteredStages: 0, bestFinish: null },
    stages: [],
  };
}

async function getCabinet(target, viewer) {
  if (!target) return null;

  const viewerId = viewer?.id ?? null;
  const cacheKey = `trophy:${target.id}:v:${viewerId ?? 'anon'}`;
  const skipCache = process.env.NODE_ENV === 'test';
  if (!skipCache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const league = await League.findOne({ where: { sourceLeagueId: WC_SOURCE_LEAGUE_ID } });
  if (!league) {
    const empty = emptyCabinet(target);
    if (!skipCache) cache.set(cacheKey, empty, CACHE_TTL_MS);
    return empty;
  }

  const games = await Game.findAll({
    where: { leagueId: league.id },
    attributes: ['id', 'stage', 'result', 'homeProbability', 'drawProbability', 'awayProbability'],
  });
  if (games.length === 0) {
    const empty = {
      ...emptyCabinet(target),
      tournament: { leagueId: league.id, name: league.name },
    };
    if (!skipCache) cache.set(cacheKey, empty, CACHE_TTL_MS);
    return empty;
  }

  const gameIds = games.map((g) => g.id);
  const picks = await Pick.findAll({
    where: { gameId: { [Op.in]: gameIds } },
    attributes: [
      'userId',
      'gameId',
      'choice',
      'pickedHomeProbability',
      'pickedDrawProbability',
      'pickedAwayProbability',
    ],
  });
  const picksByGame = new Map();
  for (const p of picks) {
    if (!picksByGame.has(p.gameId)) picksByGame.set(p.gameId, []);
    picksByGame.get(p.gameId).push(p);
  }

  // Which social groups' standings the viewer may see.
  const targetGroups = await getGroupsForUser(target.id);
  let visibleGroups = targetGroups;
  const isSelf = Boolean(viewerId && viewerId === target.id);
  const isAdmin = viewer?.role === 'admin';
  if (!isSelf && !isAdmin) {
    const viewerGroupIds = new Set(viewerId ? await getJoinedGroupIds(viewerId) : []);
    visibleGroups = targetGroups.filter((g) => viewerGroupIds.has(g.id));
  }
  const groupMemberIds = new Map(
    visibleGroups.map((g) => [g.id, new Set((g.members || []).map((m) => m.userId))]),
  );

  const gamesByStage = new Map();
  for (const g of games) {
    const key = g.stage || null;
    if (!key) continue;
    if (!gamesByStage.has(key)) gamesByStage.set(key, []);
    gamesByStage.get(key).push(g);
  }

  const orderedStages = orderStages([...gamesByStage.keys()]);
  const stages = [];
  for (const stage of orderedStages) {
    const stageGames = gamesByStage.get(stage);
    const scoredGames = stageGames.filter((g) => g.result != null);

    // pointsByUser: every user who picked a scored game in this stage (a key
    // exists even when their total is 0). That key set IS the participant set.
    const pointsByUser = new Map();
    for (const game of scoredGames) {
      const gamePicks = picksByGame.get(game.id) || [];
      for (const pick of gamePicks) {
        const prev = pointsByUser.get(pick.userId) || 0;
        pointsByUser.set(pick.userId, prev + scorePick(pick, game));
      }
    }

    const targetEntered = pointsByUser.has(target.id);
    const targetPoints = targetEntered ? pointsByUser.get(target.id) : 0;

    let overall = null;
    let groups = [];
    if (targetEntered) {
      const allPoints = [...pointsByUser.values()];
      const rank = rankAmong(targetPoints, allPoints);
      const total = pointsByUser.size;
      overall = { rank, total, topPercent: topPercentOf(rank, total), medal: medalFor(rank) };

      groups = visibleGroups
        .map((g) => {
          const memberIds = groupMemberIds.get(g.id);
          const memberPoints = [];
          for (const [userId, pts] of pointsByUser) {
            if (memberIds.has(userId)) memberPoints.push(pts);
          }
          if (memberPoints.length === 0) return null;
          const groupRank = rankAmong(targetPoints, memberPoints);
          const groupTotal = memberPoints.length;
          return {
            groupId: g.id,
            groupName: g.name,
            discriminator: g.discriminator,
            rank: groupRank,
            total: groupTotal,
            topPercent: topPercentOf(groupRank, groupTotal),
            points: targetPoints,
          };
        })
        .filter(Boolean);
    }

    stages.push({
      stage,
      label: stageLabel(stage),
      scoredGames: scoredGames.length,
      totalGames: stageGames.length,
      entered: targetEntered,
      points: targetPoints,
      overall,
      groups,
    });
  }

  const cabinet = {
    userId: target.id,
    username: target.username,
    displayName: target.displayName || null,
    tournament: { leagueId: league.id, name: league.name },
    showcase: buildShowcase(stages),
    stages,
  };

  if (!skipCache) cache.set(cacheKey, cabinet, CACHE_TTL_MS);
  return cabinet;
}

module.exports = {
  getCabinet,
  // Pure helpers — exported for unit testing.
  rankAmong,
  topPercentOf,
  buildShowcase,
  orderStages,
};
