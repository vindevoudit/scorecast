'use strict';

// Tier 30 Phase 3 C1 — Personal stats dashboard backend. Aggregates a user's
// pick history into the charts surfaced by <StatsDashboard /> on the Profile
// tab. Pure-function helpers are exported so unit tests can exercise them
// without a live DB.
//
// 5-min in-memory cache via lib/cache.js — the dashboard re-renders cheaply
// on tab switches and most users won't change underlying data between
// settle events. Cross-replica drift is bounded by the same 5-min TTL.
//
// Window options: '30d', '90d', 'season'. Season is a practical 1-year
// rolling window (covers the bulk of a football season for any league).

const { Op } = require('sequelize');
const { Pick, Game, League, Friendship, User } = require('../models');
const cache = require('../lib/cache');
const { scorePick } = require('../lib/scoring');

const CACHE_TTL_MS = 5 * 60 * 1000;
const VALID_WINDOWS = new Set(['30d', '90d', 'season']);
const WIN_RATE_MA_DAYS = 14;
const BLIND_SPOT_MIN_PICKS = 3;

function utcDayKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function windowStartDate(window, now = new Date()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  if (window === '90d') start.setUTCDate(start.getUTCDate() - 90);
  else if (window === 'season') start.setUTCFullYear(start.getUTCFullYear() - 1);
  else start.setUTCDate(start.getUTCDate() - 30);
  return start;
}

// Build the per-day points series spanning [startDate, endDate]. Missing
// days are zero-filled so the line chart renders without gaps. Cumulative
// column lets the frontend render either a daily or running-total line
// without re-aggregating.
function buildPointsOverTime(rows, startDate, endDate) {
  const byDay = new Map();
  for (const r of rows) {
    if (!r.scored) continue;
    const key = utcDayKey(new Date(r.gameDate));
    byDay.set(key, (byDay.get(key) || 0) + (r.points || 0));
  }
  const out = [];
  let cumulative = 0;
  const cur = new Date(startDate);
  cur.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);
  while (cur <= end) {
    const key = utcDayKey(cur);
    const points = byDay.get(key) || 0;
    cumulative += points;
    out.push({ date: key, points, cumulative });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// Per-active-day win rate with a trailing 14-day moving average. Days with
// no scored picks are skipped (no zero-injection) so the line doesn't get
// dragged toward 0% during empty stretches.
function buildWinRateTrend(rows) {
  const byDay = new Map();
  for (const r of rows) {
    if (!r.scored) continue;
    const key = utcDayKey(new Date(r.gameDate));
    const bucket = byDay.get(key) || { date: key, wins: 0, scored: 0 };
    bucket.scored += 1;
    if (r.isWin) bucket.wins += 1;
    byDay.set(key, bucket);
  }
  const sortedKeys = [...byDay.keys()].sort();
  const series = sortedKeys.map((k) => {
    const b = byDay.get(k);
    return {
      date: k,
      wins: b.wins,
      scored: b.scored,
      winRate: b.scored > 0 ? b.wins / b.scored : 0,
    };
  });
  for (let i = 0; i < series.length; i++) {
    let winsSum = 0;
    let scoredSum = 0;
    for (let j = Math.max(0, i - WIN_RATE_MA_DAYS + 1); j <= i; j++) {
      winsSum += series[j].wins;
      scoredSum += series[j].scored;
    }
    series[i].winRateMA = scoredSum > 0 ? winsSum / scoredSum : 0;
  }
  return series;
}

function buildPerLeagueBreakdown(rows) {
  const byLeague = new Map();
  for (const r of rows) {
    const name = r.leagueName || 'Other';
    const bucket = byLeague.get(name) || {
      leagueName: name,
      wins: 0,
      losses: 0,
      draws: 0,
      points: 0,
      picks: 0,
    };
    bucket.picks += 1;
    if (r.isWin) bucket.wins += 1;
    else if (r.isDraw) bucket.draws += 1;
    else if (r.isLoss) bucket.losses += 1;
    bucket.points += r.points || 0;
    byLeague.set(name, bucket);
  }
  return [...byLeague.values()].sort((a, b) => b.points - a.points);
}

// 7×24 grid keyed by UTC day-of-week (0=Sunday) × UTC hour. Counts pick
// submissions only — kickoff time is irrelevant for the "when do you pick"
// question this answers.
function buildPickTimeHeatmap(rows) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of rows) {
    if (!r.submittedAt) continue;
    const d = new Date(r.submittedAt);
    if (Number.isNaN(d.getTime())) continue;
    const dow = d.getUTCDay();
    const hour = d.getUTCHours();
    grid[dow][hour] += 1;
  }
  return grid;
}

// Templated insight (no LLM). Returns the worst-performing team the viewer
// has backed at least BLIND_SPOT_MIN_PICKS times. Draws don't count toward
// losses but they don't help the team's case either — they reduce loss rate
// but the picks count is what gates surfacing.
function buildBlindSpot(rows) {
  const byTeam = new Map();
  for (const r of rows) {
    if (!r.scored) continue;
    const team = r.choice === 'home' ? r.homeTeam : r.awayTeam;
    if (!team) continue;
    const bucket = byTeam.get(team) || { team, picks: 0, losses: 0, wins: 0 };
    bucket.picks += 1;
    if (r.isWin) bucket.wins += 1;
    else if (r.isLoss) bucket.losses += 1;
    byTeam.set(team, bucket);
  }
  const candidates = [...byTeam.values()].filter((b) => b.picks >= BLIND_SPOT_MIN_PICKS);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aLossRate = a.losses / a.picks;
    const bLossRate = b.losses / b.picks;
    if (bLossRate !== aLossRate) return bLossRate - aLossRate;
    return b.picks - a.picks;
  });
  const worst = candidates[0];
  if (worst.losses === 0) return null;
  return {
    team: worst.team,
    picks: worst.picks,
    losses: worst.losses,
    wins: worst.wins,
    insight: `You've backed ${worst.team} ${worst.picks} times — ${worst.wins} win${
      worst.wins === 1 ? '' : 's'
    }, ${worst.losses} loss${worst.losses === 1 ? '' : 'es'}.`,
  };
}

// `viewerChoiceByGame` is a Map<gameId, 'home' | 'away'>. `friendPickRows`
// is each row carrying { userId, gameId, choice, username, displayName }.
function buildMostDisagreedFriend(viewerChoiceByGame, friendPickRows) {
  const byFriend = new Map();
  for (const fp of friendPickRows) {
    const viewerChoice = viewerChoiceByGame.get(fp.gameId);
    if (!viewerChoice) continue;
    if (fp.choice === viewerChoice) continue;
    const bucket = byFriend.get(fp.userId) || {
      friendId: fp.userId,
      username: fp.username,
      displayName: fp.displayName,
      disagreements: 0,
      sharedPicks: 0,
    };
    bucket.disagreements += 1;
    byFriend.set(fp.userId, bucket);
  }
  // sharedPicks is the total games where BOTH the viewer and this friend
  // picked, agree-or-not. Useful for the UI to say "5/7 picks differ".
  const sharedByFriend = new Map();
  for (const fp of friendPickRows) {
    if (!viewerChoiceByGame.has(fp.gameId)) continue;
    sharedByFriend.set(fp.userId, (sharedByFriend.get(fp.userId) || 0) + 1);
  }
  for (const [friendId, bucket] of byFriend) {
    bucket.sharedPicks = sharedByFriend.get(friendId) || bucket.disagreements;
  }
  const sorted = [...byFriend.values()].sort((a, b) => b.disagreements - a.disagreements);
  return sorted[0] || null;
}

function emptyStats(window, now) {
  return {
    window,
    generatedAt: now.toISOString(),
    summary: { picks: 0, scored: 0, wins: 0, points: 0 },
    pointsOverTime: [],
    winRateTrend: [],
    perLeague: [],
    pickTimeHeatmap: Array.from({ length: 7 }, () => Array(24).fill(0)),
    blindSpot: null,
    mostDisagreedFriend: null,
  };
}

async function getStatsForUser(userId, { window = '30d', now = new Date() } = {}) {
  if (!userId) return null;
  const effectiveWindow = VALID_WINDOWS.has(window) ? window : '30d';
  const cacheKey = `stats:${userId}:${effectiveWindow}`;
  // Skip the cache in test mode so specs that mutate DB state and then
  // re-fetch see the new payload without race-conditioning on cache TTL.
  // Prod behavior unchanged.
  const skipCache = process.env.NODE_ENV === 'test';
  if (!skipCache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const startDate = windowStartDate(effectiveWindow, now);

  const viewerPicks = await Pick.findAll({
    where: { userId },
    attributes: [
      'id',
      'gameId',
      'choice',
      'submittedAt',
      'pickedHomeProbability',
      'pickedDrawProbability',
      'pickedAwayProbability',
      'appliedPoints',
    ],
  });

  if (viewerPicks.length === 0) {
    const stats = emptyStats(effectiveWindow, now);
    cache.set(cacheKey, stats, CACHE_TTL_MS);
    return stats;
  }

  const gameIds = viewerPicks.map((p) => p.gameId);
  const games = await Game.findAll({
    where: {
      id: { [Op.in]: gameIds },
      date: { [Op.gte]: startDate },
    },
    attributes: [
      'id',
      'homeTeam',
      'awayTeam',
      'date',
      'result',
      'leagueId',
      'homeProbability',
      'drawProbability',
      'awayProbability',
    ],
  });
  const gameById = new Map(games.map((g) => [g.id, g]));
  const leagueIds = [...new Set(games.map((g) => g.leagueId).filter(Boolean))];
  const leagues =
    leagueIds.length === 0
      ? []
      : await League.findAll({
          where: { id: { [Op.in]: leagueIds } },
          attributes: ['id', 'name'],
        });
  const leagueNameById = new Map(leagues.map((l) => [l.id, l.name]));

  const rows = [];
  for (const p of viewerPicks) {
    const game = gameById.get(p.gameId);
    if (!game) continue; // game outside window
    const scored = game.result != null;
    const isWin = scored && p.choice === game.result;
    const isDraw = scored && game.result === 'draw';
    const isLoss = scored && !isWin && !isDraw;
    rows.push({
      gameId: p.gameId,
      choice: p.choice,
      submittedAt: p.submittedAt,
      result: game.result,
      gameDate: game.date,
      leagueId: game.leagueId,
      leagueName: leagueNameById.get(game.leagueId) || 'Other',
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      points: scored ? scorePick(p, game) : 0,
      isWin,
      isLoss,
      isDraw,
      scored,
    });
  }

  // Friend disagreements — fetch the viewer's friend ids, then their picks
  // on the same gameIds. Bounded by friendship count × shared games; even
  // at 100 friends × 200 shared games it's a single 20k-row scan.
  let mostDisagreedFriend = null;
  if (rows.length > 0) {
    const friendships = await Friendship.findAll({
      where: {
        status: 'accepted',
        [Op.or]: [{ requesterId: userId }, { addresseeId: userId }],
      },
      attributes: ['requesterId', 'addresseeId'],
    });
    const friendIds = friendships.map((f) =>
      f.requesterId === userId ? f.addresseeId : f.requesterId,
    );
    if (friendIds.length > 0) {
      const viewerGameIds = rows.map((r) => r.gameId);
      const friendPicks = await Pick.findAll({
        where: {
          userId: { [Op.in]: friendIds },
          gameId: { [Op.in]: viewerGameIds },
        },
        attributes: ['userId', 'gameId', 'choice'],
      });
      const friendUsers = await User.findAll({
        where: { id: { [Op.in]: friendIds } },
        attributes: ['id', 'username', 'displayName'],
      });
      const userById = new Map(friendUsers.map((u) => [u.id, u]));
      const friendPickRows = friendPicks.map((fp) => ({
        userId: fp.userId,
        gameId: fp.gameId,
        choice: fp.choice,
        username: userById.get(fp.userId)?.username,
        displayName: userById.get(fp.userId)?.displayName,
      }));
      const viewerChoiceByGame = new Map(rows.map((r) => [r.gameId, r.choice]));
      mostDisagreedFriend = buildMostDisagreedFriend(viewerChoiceByGame, friendPickRows);
    }
  }

  const stats = {
    window: effectiveWindow,
    generatedAt: now.toISOString(),
    summary: {
      picks: rows.length,
      scored: rows.filter((r) => r.scored).length,
      wins: rows.filter((r) => r.isWin).length,
      points: rows.reduce((s, r) => s + (r.points || 0), 0),
    },
    pointsOverTime: buildPointsOverTime(rows, startDate, now),
    winRateTrend: buildWinRateTrend(rows),
    perLeague: buildPerLeagueBreakdown(rows),
    pickTimeHeatmap: buildPickTimeHeatmap(rows),
    blindSpot: buildBlindSpot(rows),
    mostDisagreedFriend,
  };

  if (!skipCache) {
    cache.set(cacheKey, stats, CACHE_TTL_MS);
  }
  return stats;
}

function invalidateForUser(userId) {
  for (const w of VALID_WINDOWS) {
    cache.invalidate(`stats:${userId}:${w}`);
  }
}

module.exports = {
  getStatsForUser,
  invalidateForUser,
  // Pure helpers — exported for unit testing
  utcDayKey,
  windowStartDate,
  buildPointsOverTime,
  buildWinRateTrend,
  buildPerLeagueBreakdown,
  buildPickTimeHeatmap,
  buildBlindSpot,
  buildMostDisagreedFriend,
  VALID_WINDOWS,
};
