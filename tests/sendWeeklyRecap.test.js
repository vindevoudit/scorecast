'use strict';

// Tier 30 Phase 3 A5 — pure-function tests for the weekly recap job.
// Exercises aggregateWeeklyStats + formatRecap + topPercent directly so
// the suite doesn't need a live database. The end-to-end fan-out is
// covered by integration testing via Playwright if/when needed.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { aggregateWeeklyStats, formatRecap, topPercent } = require('../lib/jobs/sendWeeklyRecap');

// ============================================================
// aggregateWeeklyStats
// ============================================================

test('aggregateWeeklyStats — empty input → 0/0/0', () => {
  assert.deepEqual(aggregateWeeklyStats([]), { scored: 0, wins: 0, points: 0 });
});

test('aggregateWeeklyStats — single win → 1/1/N', () => {
  assert.deepEqual(aggregateWeeklyStats([{ won: true, points: 40 }]), {
    scored: 1,
    wins: 1,
    points: 40,
  });
});

test('aggregateWeeklyStats — single loss → 1/0/0', () => {
  assert.deepEqual(aggregateWeeklyStats([{ won: false, points: 0 }]), {
    scored: 1,
    wins: 0,
    points: 0,
  });
});

test('aggregateWeeklyStats — draw with partial credit → 1 scored, 0 wins, partial pts', () => {
  // Draw scoring: the row carries points but won=false because
  // pick.choice === game.result is the strict win semantic.
  assert.deepEqual(aggregateWeeklyStats([{ won: false, points: 12 }]), {
    scored: 1,
    wins: 0,
    points: 12,
  });
});

test('aggregateWeeklyStats — mixed week with wins, losses, draws', () => {
  const rows = [
    { won: true, points: 65 },
    { won: false, points: 0 },
    { won: true, points: 38 },
    { won: false, points: 9 }, // draw partial credit
    { won: false, points: 0 },
  ];
  assert.deepEqual(aggregateWeeklyStats(rows), { scored: 5, wins: 2, points: 112 });
});

test('aggregateWeeklyStats — handles missing points field as 0', () => {
  assert.deepEqual(aggregateWeeklyStats([{ won: true }]), { scored: 1, wins: 1, points: 0 });
});

// ============================================================
// formatRecap
// ============================================================

test('formatRecap — no flair', () => {
  const out = formatRecap({ scored: 4, wins: 2, points: 100 });
  assert.equal(out.title, 'Your week on Bantryx');
  assert.equal(out.body, 'You went 2/4 this week, +100 pts.');
});

test('formatRecap — zero points renders + sign', () => {
  const out = formatRecap({ scored: 3, wins: 0, points: 0 });
  assert.equal(out.body, 'You went 0/3 this week, +0 pts.');
});

test('formatRecap — negative points (theoretical) does not double-sign', () => {
  const out = formatRecap({ scored: 3, wins: 0, points: -10 });
  assert.equal(out.body, 'You went 0/3 this week, -10 pts.');
});

test('formatRecap — league flair only', () => {
  const out = formatRecap({
    scored: 5,
    wins: 3,
    points: 142,
    leagueFlair: 'Top 12% in this league.',
  });
  assert.equal(out.body, 'You went 3/5 this week, +142 pts. Top 12% in this league.');
});

test('formatRecap — group flair only', () => {
  const out = formatRecap({
    scored: 5,
    wins: 3,
    points: 142,
    groupFlair: 'Top 30% in your group.',
  });
  assert.equal(out.body, 'You went 3/5 this week, +142 pts. Top 30% in your group.');
});

test('formatRecap — both flairs join with separator', () => {
  const out = formatRecap({
    scored: 5,
    wins: 3,
    points: 142,
    leagueFlair: 'Top 12% in this league.',
    groupFlair: 'Top 30% in your group.',
  });
  assert.equal(
    out.body,
    'You went 3/5 this week, +142 pts. Top 12% in this league. · Top 30% in your group.',
  );
});

// ============================================================
// topPercent
// ============================================================

test('topPercent — rank 1 of 10 → top 10%', () => {
  assert.equal(topPercent(1, 10), 10);
});

test('topPercent — rank 2 of 10 → top 20%', () => {
  assert.equal(topPercent(2, 10), 20);
});

test('topPercent — rank 5 of 100 → top 5%', () => {
  assert.equal(topPercent(5, 100), 5);
});

test('topPercent — fractional ratios round up (rank 7 of 30 → top 24%, not 23%)', () => {
  // 7/30 = 23.33% → Math.ceil → 24%. We never advertise a better
  // percentile than the user actually achieved.
  assert.equal(topPercent(7, 30), 24);
});

test('topPercent — single-member group returns null (no useful comparison)', () => {
  assert.equal(topPercent(1, 1), null);
});

test('topPercent — missing inputs return null', () => {
  assert.equal(topPercent(0, 10), null);
  assert.equal(topPercent(1, 0), null);
  assert.equal(topPercent(null, 10), null);
});

test('topPercent — minimum percentile floor is 1 (a #1 rank never shows top 0%)', () => {
  // 1/1000 = 0.1% → ceil → 1. But the floor in the impl protects against
  // some pathological rounding that could yield 0.
  assert.equal(topPercent(1, 1000), 1);
});
