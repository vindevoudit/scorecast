'use strict';

// World Cup Aftermatch — per-user, self-only tournament retrospective (the
// user-facing name is "Aftermatch"; code identifiers keep the `wrapped` name +
// the /api/me/wrapped route + view id 'wrapped' for stability). Packages a
// user's whole World Cup prediction run into a single payload whose keys map
// one-to-one onto the frontend story slides (total points, accuracy, boldest
// call, team of the tournament, stage journey, overall percentile, a templated
// "prediction personality"). Rendered as a Spotify/Instagram-style full-screen
// story by src/components/wrapped/WrappedStory.jsx, ending on a shareable card.
//
// Modelled on services/TrophyService.js: same WC data loads (sourceLeagueId
// 'WC' → games with `stage` → all picks), the same scorePick authority, the
// same 5-min on-the-fly cache (the WC is bounded ~104 games so scoring every
// participant is a sub-second cold-path scan; nothing is materialized).
//
// SELF-ONLY: reachable only via GET /api/me/wrapped scoped to req.user.id.
// There is deliberately NO /api/users/:username/wrapped surface — the boldest
// call + personality leak granular pick history, mirroring the self-only
// Personal Stats dashboard (services/StatsService.js). No per-row masking is
// needed because the payload only ever reveals the subject's own numbers.

const { Op } = require('sequelize');
const { User, League, Game, Pick, Friendship } = require('../models');
const cache = require('../lib/cache');
const { scorePick } = require('../lib/scoring');
const { getGroupsForUser } = require('../lib/groups');
const { stageLabel, medalFor } = require('../lib/stages');
const { rankAmong, topPercentOf } = require('./TrophyService');

const CACHE_TTL_MS = 5 * 60 * 1000;
const WC_SOURCE_LEAGUE_ID = 'WC';

// An "upset" is a correct pick on a side the model rated a longshot.
const UPSET_PROBABILITY_MAX = 0.33;
// Personality axis thresholds. `boldness` is the average (1 − picked-side
// probability) across scored picks — higher means the user habitually backs
// the less-favoured side. `accurate` gates on a coin-flip win rate.
const BOLD_THRESHOLD = 0.45;
const ACCURATE_THRESHOLD = 0.5;
// Below this many scored picks there isn't enough signal to characterise a
// personality — everyone starts as The Newcomer.
const ARCHETYPE_MIN_SCORED = 3;

const ARCHETYPES = {
  oracle: {
    key: 'oracle',
    title: 'The Oracle',
    emoji: '🔮',
    blurb: 'Bold calls, sharp instincts — you saw what the odds missed.',
  },
  daredevil: {
    key: 'daredevil',
    title: 'The Daredevil',
    emoji: '🎲',
    blurb: 'You chased the upsets. Some landed, some did not — never boring.',
  },
  analyst: {
    key: 'analyst',
    title: 'The Analyst',
    emoji: '📊',
    blurb: 'You backed the favourites and cashed in. Cool, calculated, correct.',
  },
  optimist: {
    key: 'optimist',
    title: 'The Optimist',
    emoji: '🌤️',
    blurb: 'You played it safe — results did not always agree, but you kept the faith.',
  },
  newcomer: {
    key: 'newcomer',
    title: 'The Newcomer',
    emoji: '🌱',
    blurb: 'Just getting started — plenty of tournament left to make your mark.',
  },
};

// Picked-side probability under the SAME snapshot rules as lib/scoring.js:
// when the pick carries a pick-time snapshot (pickedHomeProbability != null)
// all three snapshot columns are used together; otherwise fall back to the
// live game.* probabilities. Returns a Number in [0, 1] (DECIMAL cols arrive
// as strings, so parseFloat), or null when unavailable.
function pickedSideProbability(pick, game) {
  const usesSnapshot = pick && pick.pickedHomeProbability != null;
  const ph = parseFloat(usesSnapshot ? pick.pickedHomeProbability : game.homeProbability);
  const pa = parseFloat(usesSnapshot ? pick.pickedAwayProbability : game.awayProbability);
  const value = pick.choice === 'home' ? ph : pa;
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Pure helpers — DB-free, exported for unit testing. Each takes `rows`, the
// viewer's per-pick view: { choice, homeTeam, awayTeam, result, points,
// isWin, scored, probability, stageLabel }.
// ---------------------------------------------------------------------------

// The gutsiest correct call: the winning pick on the longest-odds side (lowest
// picked-side probability = highest points). Null when the user has no wins.
function findBoldestCall(rows) {
  let best = null;
  for (const r of rows) {
    if (!r.isWin) continue;
    const prob = r.probability;
    if (prob == null) continue;
    if (!best || prob < best.probability) {
      best = {
        homeTeam: r.homeTeam,
        awayTeam: r.awayTeam,
        choice: r.choice,
        pickedTeam: r.choice === 'home' ? r.homeTeam : r.awayTeam,
        probability: prob,
        points: r.points,
        stageLabel: r.stageLabel,
      };
    }
  }
  return best;
}

// Most-backed nation across every WC pick (scored or not). Tie-break by wins,
// then by team name for determinism. Null when the user made no picks.
function teamOfTournament(rows) {
  const byTeam = new Map();
  for (const r of rows) {
    const team = r.choice === 'home' ? r.homeTeam : r.awayTeam;
    if (!team) continue;
    const bucket = byTeam.get(team) || { team, picks: 0, wins: 0 };
    bucket.picks += 1;
    if (r.isWin) bucket.wins += 1;
    byTeam.set(team, bucket);
  }
  const buckets = [...byTeam.values()];
  if (buckets.length === 0) return null;
  buckets.sort((a, b) => b.picks - a.picks || b.wins - a.wins || a.team.localeCompare(b.team));
  return buckets[0];
}

// Correct picks on a side the model rated below UPSET_PROBABILITY_MAX.
function countUpsets(rows) {
  return rows.filter(
    (r) => r.isWin && r.probability != null && r.probability < UPSET_PROBABILITY_MAX,
  ).length;
}

// Templated "prediction personality" from two axes — no LLM. `boldness` is the
// mean (1 − picked-side probability) over scored picks; `winRate` the scored
// win rate. Fewer than ARCHETYPE_MIN_SCORED scored picks → The Newcomer.
function buildArchetype({ winRate, boldness, scored }) {
  if (!scored || scored < ARCHETYPE_MIN_SCORED) return ARCHETYPES.newcomer;
  const bold = boldness >= BOLD_THRESHOLD;
  const accurate = winRate >= ACCURATE_THRESHOLD;
  if (bold && accurate) return ARCHETYPES.oracle;
  if (bold && !accurate) return ARCHETYPES.daredevil;
  if (!bold && accurate) return ARCHETYPES.analyst;
  return ARCHETYPES.optimist;
}

function emptyWrapped(targetUser, tournament, now) {
  return {
    userId: targetUser.id,
    username: targetUser.username,
    displayName: targetUser.displayName || null,
    tournament,
    hasData: false,
    summary: { picks: 0, scored: 0, wins: 0, points: 0, winRate: 0 },
    overall: null,
    boldestCall: null,
    teamOfTournament: null,
    upsetsCalled: 0,
    bestStage: null,
    medals: { gold: 0, silver: 0, bronze: 0 },
    groups: { bestFinish: null, friendsBeaten: 0 },
    archetype: ARCHETYPES.newcomer,
    generatedAt: now.toISOString(),
  };
}

async function getWrappedForUser(userId, { now = new Date() } = {}) {
  if (!userId) return null;

  const cacheKey = `wrapped:${userId}`;
  const skipCache = process.env.NODE_ENV === 'test';
  if (!skipCache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const targetUser = await User.findByPk(userId, {
    attributes: ['id', 'username', 'displayName'],
  });
  if (!targetUser) return null; // route → 404

  const league = await League.findOne({ where: { sourceLeagueId: WC_SOURCE_LEAGUE_ID } });

  if (!league) {
    const empty = emptyWrapped(targetUser, null, now);
    if (!skipCache) cache.set(cacheKey, empty, CACHE_TTL_MS);
    return empty;
  }
  const tournament = { leagueId: league.id, name: league.name };

  const games = await Game.findAll({
    where: { leagueId: league.id },
    attributes: [
      'id',
      'stage',
      'result',
      'date',
      'homeTeam',
      'awayTeam',
      'homeProbability',
      'drawProbability',
      'awayProbability',
    ],
  });
  if (games.length === 0) {
    const empty = emptyWrapped(targetUser, tournament, now);
    if (!skipCache) cache.set(cacheKey, empty, CACHE_TTL_MS);
    return empty;
  }
  const gameById = new Map(games.map((g) => [g.id, g]));
  const gameIds = games.map((g) => g.id);

  // ALL picks on WC games — needed for the overall leaderboard placement +
  // group + friends comparisons, exactly like TrophyService.
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

  // Global points per user across every scored WC game — the participant set
  // (a key exists even at 0 points) drives overall rank + group/friend ranks.
  const pointsByUser = new Map();
  const picksByGame = new Map();
  const myPicks = [];
  for (const p of picks) {
    const game = gameById.get(p.gameId);
    if (!game) continue;
    if (!picksByGame.has(p.gameId)) picksByGame.set(p.gameId, []);
    picksByGame.get(p.gameId).push(p);
    if (game.result != null) {
      const prev = pointsByUser.get(p.userId) || 0;
      pointsByUser.set(p.userId, prev + scorePick(p, game));
    }
    if (p.userId === userId) myPicks.push(p);
  }

  // The viewer's per-pick rows for the pure-helper computations.
  const rows = myPicks.map((p) => {
    const game = gameById.get(p.gameId);
    const scored = game.result != null;
    const isWin =
      scored &&
      ((p.choice === 'home' && game.result === 'home') ||
        (p.choice === 'away' && game.result === 'away'));
    return {
      choice: p.choice,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      result: game.result,
      stage: game.stage || null,
      stageLabel: stageLabel(game.stage),
      scored,
      isWin,
      points: scored ? scorePick(p, game) : 0,
      probability: pickedSideProbability(p, game),
    };
  });

  const scoredRows = rows.filter((r) => r.scored);
  const wins = scoredRows.filter((r) => r.isWin).length;
  const totalPoints = rows.reduce((s, r) => s + r.points, 0);
  const summary = {
    picks: rows.length,
    scored: scoredRows.length,
    wins,
    points: totalPoints,
    winRate: scoredRows.length > 0 ? wins / scoredRows.length : 0,
  };

  // No scored picks → nothing meaningful to celebrate yet. Keep the tournament
  // reference so the launch tile can name it.
  if (summary.scored === 0) {
    const empty = { ...emptyWrapped(targetUser, tournament, now), summary };
    if (!skipCache) cache.set(cacheKey, empty, CACHE_TTL_MS);
    return empty;
  }

  // Overall WC leaderboard placement (across all scored WC picks).
  let overall = null;
  const myTotal = pointsByUser.get(userId) ?? 0;
  if (pointsByUser.has(userId)) {
    const allPoints = [...pointsByUser.values()];
    const rank = rankAmong(myTotal, allPoints);
    const total = pointsByUser.size;
    overall = { rank, total, topPercent: topPercentOf(rank, total) };
  }

  // Per-stage placements → best finish + medal tally. Mirrors TrophyService's
  // per-stage loop but only keeps the viewer's own overall placement.
  const gamesByStage = new Map();
  for (const g of games) {
    if (!g.stage || g.result == null) continue;
    if (!gamesByStage.has(g.stage)) gamesByStage.set(g.stage, []);
    gamesByStage.get(g.stage).push(g);
  }
  const medals = { gold: 0, silver: 0, bronze: 0 };
  let bestStage = null;
  for (const [stage, stageGames] of gamesByStage) {
    const stagePoints = new Map();
    for (const game of stageGames) {
      const gamePicks = picksByGame.get(game.id) || [];
      for (const pick of gamePicks) {
        stagePoints.set(pick.userId, (stagePoints.get(pick.userId) || 0) + scorePick(pick, game));
      }
    }
    if (!stagePoints.has(userId)) continue;
    const my = stagePoints.get(userId);
    const rank = rankAmong(my, [...stagePoints.values()]);
    const total = stagePoints.size;
    const medal = medalFor(rank);
    if (medal) medals[medal] += 1;
    if (!bestStage || rank < bestStage.rank) {
      bestStage = {
        stage,
        label: stageLabel(stage),
        rank,
        total,
        topPercent: topPercentOf(rank, total),
        medal,
      };
    }
  }

  // Group + friend social comparisons — best group finish and how many
  // accepted friends the viewer out-scored across the WC.
  let bestGroupFinish = null;
  const myGroups = await getGroupsForUser(userId);
  for (const g of myGroups) {
    const memberIds = new Set((g.members || []).map((m) => m.userId));
    const memberPoints = [];
    for (const [uid, pts] of pointsByUser) {
      if (memberIds.has(uid)) memberPoints.push(pts);
    }
    if (memberPoints.length === 0 || !memberIds.has(userId)) continue;
    const rank = rankAmong(myTotal, memberPoints);
    if (!bestGroupFinish || rank < bestGroupFinish.rank) {
      bestGroupFinish = { groupName: g.name, rank, total: memberPoints.length };
    }
  }

  const friendships = await Friendship.findAll({
    where: { status: 'accepted', [Op.or]: [{ requesterId: userId }, { addresseeId: userId }] },
    attributes: ['requesterId', 'addresseeId'],
  });
  const friendIds = friendships.map((f) =>
    f.requesterId === userId ? f.addresseeId : f.requesterId,
  );
  let friendsBeaten = 0;
  for (const fid of friendIds) {
    if (pointsByUser.has(fid) && pointsByUser.get(fid) < myTotal) friendsBeaten += 1;
  }

  // Personality — boldness = mean (1 − picked-side prob) over scored picks.
  const boldnessSamples = scoredRows.map((r) => r.probability).filter((p) => p != null);
  const boldness =
    boldnessSamples.length > 0
      ? boldnessSamples.reduce((s, p) => s + (1 - p), 0) / boldnessSamples.length
      : 0;
  const archetype = buildArchetype({ winRate: summary.winRate, boldness, scored: summary.scored });

  const wrapped = {
    userId: targetUser.id,
    username: targetUser.username,
    displayName: targetUser.displayName || null,
    tournament,
    hasData: true,
    summary,
    overall,
    boldestCall: findBoldestCall(rows),
    teamOfTournament: teamOfTournament(rows),
    upsetsCalled: countUpsets(rows),
    bestStage,
    medals,
    groups: { bestFinish: bestGroupFinish, friendsBeaten },
    archetype,
    generatedAt: now.toISOString(),
  };

  if (!skipCache) cache.set(cacheKey, wrapped, CACHE_TTL_MS);
  return wrapped;
}

module.exports = {
  getWrappedForUser,
  // Pure helpers — exported for unit testing.
  findBoldestCall,
  teamOfTournament,
  countUpsets,
  buildArchetype,
  ARCHETYPES,
};
