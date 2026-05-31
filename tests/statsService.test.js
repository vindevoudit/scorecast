'use strict';

// Tier 30 Phase 3 C1 — pure-function tests for the personal stats service.
// Exercises every pure helper exported by services/StatsService.js without a
// live DB. Database-backed shape covered by the per-endpoint API spec in
// tests/e2e/api/me.spec.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  utcDayKey,
  windowStartDate,
  buildPointsOverTime,
  buildWinRateTrend,
  buildPerLeagueBreakdown,
  buildPickTimeHeatmap,
  buildBlindSpot,
  buildMostDisagreedFriend,
} = require('../services/StatsService');

// ---------------------------------------------------------------------------
// utcDayKey
// ---------------------------------------------------------------------------

test('utcDayKey — formats UTC year-month-day', () => {
  assert.equal(utcDayKey(new Date('2026-05-31T12:34:56Z')), '2026-05-31');
  assert.equal(utcDayKey(new Date('2026-01-01T00:00:00Z')), '2026-01-01');
});

test('utcDayKey — pads single digits', () => {
  assert.equal(utcDayKey(new Date('2026-03-05T00:00:00Z')), '2026-03-05');
});

// ---------------------------------------------------------------------------
// windowStartDate
// ---------------------------------------------------------------------------

test('windowStartDate — 30d window goes back 30 UTC days from now', () => {
  const now = new Date('2026-05-31T00:00:00Z');
  const start = windowStartDate('30d', now);
  assert.equal(utcDayKey(start), '2026-05-01');
});

test('windowStartDate — 90d window goes back 90 UTC days', () => {
  const now = new Date('2026-05-31T00:00:00Z');
  const start = windowStartDate('90d', now);
  assert.equal(utcDayKey(start), '2026-03-02');
});

test('windowStartDate — season window goes back 1 year', () => {
  const now = new Date('2026-05-31T00:00:00Z');
  const start = windowStartDate('season', now);
  assert.equal(utcDayKey(start), '2025-05-31');
});

test('windowStartDate — unknown window falls back to 30d', () => {
  const now = new Date('2026-05-31T00:00:00Z');
  const start = windowStartDate('forever', now);
  assert.equal(utcDayKey(start), '2026-05-01');
});

// ---------------------------------------------------------------------------
// buildPointsOverTime
// ---------------------------------------------------------------------------

test('buildPointsOverTime — empty rows → zero-filled span', () => {
  const start = new Date('2026-05-29T00:00:00Z');
  const end = new Date('2026-05-31T00:00:00Z');
  const out = buildPointsOverTime([], start, end);
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((d) => d.points),
    [0, 0, 0],
  );
  assert.deepEqual(
    out.map((d) => d.cumulative),
    [0, 0, 0],
  );
});

test('buildPointsOverTime — single scored row lands on its gameDate', () => {
  const start = new Date('2026-05-29T00:00:00Z');
  const end = new Date('2026-05-31T00:00:00Z');
  const rows = [{ scored: true, gameDate: '2026-05-30T15:00:00Z', points: 50 }];
  const out = buildPointsOverTime(rows, start, end);
  assert.equal(out[0].points, 0);
  assert.equal(out[1].points, 50);
  assert.equal(out[2].points, 0);
  // Cumulative carries forward
  assert.deepEqual(
    out.map((d) => d.cumulative),
    [0, 50, 50],
  );
});

test('buildPointsOverTime — multiple rows on same day aggregate', () => {
  const start = new Date('2026-05-30T00:00:00Z');
  const end = new Date('2026-05-30T00:00:00Z');
  const rows = [
    { scored: true, gameDate: '2026-05-30T15:00:00Z', points: 40 },
    { scored: true, gameDate: '2026-05-30T18:00:00Z', points: 25 },
    { scored: false, gameDate: '2026-05-30T20:00:00Z', points: 0 },
  ];
  const out = buildPointsOverTime(rows, start, end);
  assert.equal(out[0].points, 65);
});

test('buildPointsOverTime — unscored picks ignored', () => {
  const start = new Date('2026-05-30T00:00:00Z');
  const end = new Date('2026-05-30T00:00:00Z');
  const rows = [{ scored: false, gameDate: '2026-05-30T15:00:00Z', points: 99 }];
  const out = buildPointsOverTime(rows, start, end);
  assert.equal(out[0].points, 0);
});

// ---------------------------------------------------------------------------
// buildWinRateTrend
// ---------------------------------------------------------------------------

test('buildWinRateTrend — empty rows → empty series', () => {
  assert.deepEqual(buildWinRateTrend([]), []);
});

test('buildWinRateTrend — single-day win → 100% rate + MA', () => {
  const rows = [{ scored: true, gameDate: '2026-05-30T15:00:00Z', isWin: true }];
  const out = buildWinRateTrend(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].wins, 1);
  assert.equal(out[0].scored, 1);
  assert.equal(out[0].winRate, 1);
  assert.equal(out[0].winRateMA, 1);
});

test('buildWinRateTrend — 14d MA averages over rolling window', () => {
  // 3 days; day1 all wins, day2 all losses, day3 split.
  const rows = [
    { scored: true, gameDate: '2026-05-29T15:00:00Z', isWin: true },
    { scored: true, gameDate: '2026-05-29T16:00:00Z', isWin: true },
    { scored: true, gameDate: '2026-05-30T15:00:00Z', isWin: false },
    { scored: true, gameDate: '2026-05-31T15:00:00Z', isWin: true },
    { scored: true, gameDate: '2026-05-31T16:00:00Z', isWin: false },
  ];
  const out = buildWinRateTrend(rows);
  assert.equal(out.length, 3);
  // Day 1 daily winRate: 2/2 = 1.0; MA same since only one day in window
  assert.equal(out[0].winRate, 1);
  assert.equal(out[0].winRateMA, 1);
  // Day 2 daily winRate: 0/1 = 0; MA over (2/2 + 0/1) = 2/3
  assert.equal(out[1].winRate, 0);
  assert.equal(Math.round(out[1].winRateMA * 1000) / 1000, 0.667);
  // Day 3 daily winRate: 1/2 = 0.5; MA over (2/2 + 0/1 + 1/2) = 3/5
  assert.equal(out[2].winRate, 0.5);
  assert.equal(out[2].winRateMA, 0.6);
});

test('buildWinRateTrend — unscored rows skipped', () => {
  const rows = [
    { scored: false, gameDate: '2026-05-30T15:00:00Z', isWin: false },
    { scored: true, gameDate: '2026-05-30T16:00:00Z', isWin: true },
  ];
  const out = buildWinRateTrend(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].scored, 1);
});

// ---------------------------------------------------------------------------
// buildPerLeagueBreakdown
// ---------------------------------------------------------------------------

test('buildPerLeagueBreakdown — sorts by points desc', () => {
  const rows = [
    { leagueName: 'PL', isWin: true, isLoss: false, isDraw: false, points: 40 },
    { leagueName: 'PL', isWin: true, isLoss: false, isDraw: false, points: 60 },
    { leagueName: 'WC', isWin: false, isLoss: true, isDraw: false, points: 0 },
    { leagueName: 'WC', isWin: true, isLoss: false, isDraw: false, points: 50 },
  ];
  const out = buildPerLeagueBreakdown(rows);
  assert.equal(out[0].leagueName, 'PL');
  assert.equal(out[0].picks, 2);
  assert.equal(out[0].wins, 2);
  assert.equal(out[0].points, 100);
  assert.equal(out[1].leagueName, 'WC');
  assert.equal(out[1].losses, 1);
});

test('buildPerLeagueBreakdown — null leagueName → "Other"', () => {
  const rows = [{ leagueName: null, isWin: true, points: 50, isLoss: false, isDraw: false }];
  const out = buildPerLeagueBreakdown(rows);
  assert.equal(out[0].leagueName, 'Other');
});

test('buildPerLeagueBreakdown — draws counted separately', () => {
  const rows = [
    { leagueName: 'PL', isWin: false, isLoss: false, isDraw: true, points: 12 },
    { leagueName: 'PL', isWin: false, isLoss: true, isDraw: false, points: 0 },
  ];
  const out = buildPerLeagueBreakdown(rows);
  assert.equal(out[0].draws, 1);
  assert.equal(out[0].losses, 1);
  assert.equal(out[0].wins, 0);
});

// ---------------------------------------------------------------------------
// buildPickTimeHeatmap
// ---------------------------------------------------------------------------

test('buildPickTimeHeatmap — empty rows → all-zero 7x24', () => {
  const grid = buildPickTimeHeatmap([]);
  assert.equal(grid.length, 7);
  assert.equal(grid[0].length, 24);
  assert.equal(
    grid.flat().reduce((s, n) => s + n, 0),
    0,
  );
});

test('buildPickTimeHeatmap — single pick lands on correct cell', () => {
  // Sunday 2026-05-31T13:00:00Z → dow=0 (Sun), hour=13
  const grid = buildPickTimeHeatmap([{ submittedAt: '2026-05-31T13:00:00Z' }]);
  assert.equal(grid[0][13], 1);
  // Make sure exactly one cell is non-zero
  assert.equal(
    grid.flat().reduce((s, n) => s + n, 0),
    1,
  );
});

test('buildPickTimeHeatmap — invalid submittedAt skipped', () => {
  const grid = buildPickTimeHeatmap([{ submittedAt: 'not-a-date' }, { submittedAt: null }]);
  assert.equal(
    grid.flat().reduce((s, n) => s + n, 0),
    0,
  );
});

// ---------------------------------------------------------------------------
// buildBlindSpot
// ---------------------------------------------------------------------------

test('buildBlindSpot — empty rows → null', () => {
  assert.equal(buildBlindSpot([]), null);
});

test('buildBlindSpot — below 3-pick floor → null', () => {
  const rows = [
    {
      scored: true,
      choice: 'home',
      homeTeam: 'Arsenal',
      awayTeam: 'X',
      isWin: false,
      isLoss: true,
      isDraw: false,
    },
    {
      scored: true,
      choice: 'home',
      homeTeam: 'Arsenal',
      awayTeam: 'Y',
      isWin: false,
      isLoss: true,
      isDraw: false,
    },
  ];
  assert.equal(buildBlindSpot(rows), null);
});

test('buildBlindSpot — surfaces worst team by loss rate', () => {
  const rows = [
    // Arsenal: 3 picks, 0 wins, 3 losses
    {
      scored: true,
      choice: 'home',
      homeTeam: 'Arsenal',
      awayTeam: 'X',
      isWin: false,
      isLoss: true,
      isDraw: false,
    },
    {
      scored: true,
      choice: 'home',
      homeTeam: 'Arsenal',
      awayTeam: 'Y',
      isWin: false,
      isLoss: true,
      isDraw: false,
    },
    {
      scored: true,
      choice: 'home',
      homeTeam: 'Arsenal',
      awayTeam: 'Z',
      isWin: false,
      isLoss: true,
      isDraw: false,
    },
    // Chelsea: 4 picks, 3 wins, 1 loss
    {
      scored: true,
      choice: 'home',
      homeTeam: 'Chelsea',
      awayTeam: 'X',
      isWin: true,
      isLoss: false,
      isDraw: false,
    },
    {
      scored: true,
      choice: 'home',
      homeTeam: 'Chelsea',
      awayTeam: 'Y',
      isWin: true,
      isLoss: false,
      isDraw: false,
    },
    {
      scored: true,
      choice: 'home',
      homeTeam: 'Chelsea',
      awayTeam: 'Z',
      isWin: true,
      isLoss: false,
      isDraw: false,
    },
    {
      scored: true,
      choice: 'home',
      homeTeam: 'Chelsea',
      awayTeam: 'A',
      isWin: false,
      isLoss: true,
      isDraw: false,
    },
  ];
  const out = buildBlindSpot(rows);
  assert.equal(out.team, 'Arsenal');
  assert.equal(out.picks, 3);
  assert.equal(out.losses, 3);
  assert.equal(out.wins, 0);
  assert.match(out.insight, /Arsenal/);
});

test('buildBlindSpot — zero-loss team not surfaced', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    scored: true,
    choice: 'home',
    homeTeam: 'Arsenal',
    awayTeam: `X${i}`,
    isWin: true,
    isLoss: false,
    isDraw: false,
  }));
  assert.equal(buildBlindSpot(rows), null);
});

test('buildBlindSpot — picks the team chosen (home vs away)', () => {
  const rows = [
    // User backed AwayTeamX 3 times via 'away' choice — all losses
    {
      scored: true,
      choice: 'away',
      homeTeam: 'A',
      awayTeam: 'AwayTeamX',
      isWin: false,
      isLoss: true,
      isDraw: false,
    },
    {
      scored: true,
      choice: 'away',
      homeTeam: 'B',
      awayTeam: 'AwayTeamX',
      isWin: false,
      isLoss: true,
      isDraw: false,
    },
    {
      scored: true,
      choice: 'away',
      homeTeam: 'C',
      awayTeam: 'AwayTeamX',
      isWin: false,
      isLoss: true,
      isDraw: false,
    },
  ];
  const out = buildBlindSpot(rows);
  assert.equal(out.team, 'AwayTeamX');
});

// ---------------------------------------------------------------------------
// buildMostDisagreedFriend
// ---------------------------------------------------------------------------

test('buildMostDisagreedFriend — empty inputs → null', () => {
  assert.equal(buildMostDisagreedFriend(new Map(), []), null);
});

test('buildMostDisagreedFriend — agreed picks skipped', () => {
  const viewer = new Map([
    ['g1', 'home'],
    ['g2', 'away'],
  ]);
  const friends = [
    { userId: 'f1', gameId: 'g1', choice: 'home', username: 'bob' },
    { userId: 'f1', gameId: 'g2', choice: 'away', username: 'bob' },
  ];
  assert.equal(buildMostDisagreedFriend(viewer, friends), null);
});

test('buildMostDisagreedFriend — surfaces friend with most disagreements', () => {
  const viewer = new Map([
    ['g1', 'home'],
    ['g2', 'away'],
    ['g3', 'home'],
  ]);
  const friends = [
    // bob disagrees on 2 (g1, g2)
    { userId: 'f1', gameId: 'g1', choice: 'away', username: 'bob' },
    { userId: 'f1', gameId: 'g2', choice: 'home', username: 'bob' },
    { userId: 'f1', gameId: 'g3', choice: 'home', username: 'bob' },
    // carla disagrees on 1 (g1)
    { userId: 'f2', gameId: 'g1', choice: 'away', username: 'carla' },
  ];
  const out = buildMostDisagreedFriend(viewer, friends);
  assert.equal(out.friendId, 'f1');
  assert.equal(out.username, 'bob');
  assert.equal(out.disagreements, 2);
  assert.equal(out.sharedPicks, 3);
});

test('buildMostDisagreedFriend — only counts games viewer also picked', () => {
  const viewer = new Map([['g1', 'home']]);
  const friends = [
    { userId: 'f1', gameId: 'g1', choice: 'away', username: 'bob' }, // disagreement counted
    { userId: 'f1', gameId: 'g99', choice: 'away', username: 'bob' }, // not in viewer set, ignored
  ];
  const out = buildMostDisagreedFriend(viewer, friends);
  assert.equal(out.disagreements, 1);
  assert.equal(out.sharedPicks, 1);
});
