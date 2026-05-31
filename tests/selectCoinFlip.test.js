'use strict';

// Tier 30 Phase 3 A6 — pure-function tests for the coin-flip selector.
// Exercises selectMostUncertain + the UTC day helpers directly so the
// suite doesn't need a live database. End-to-end behavior (idempotency,
// active-league filtering, eligibility) is covered by Playwright.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  selectMostUncertain,
  todayDayKey,
  startOfUtcDay,
  startOfNextUtcDay,
} = require('../lib/jobs/selectCoinFlip');

// ============================================================
// selectMostUncertain
// ============================================================

test('selectMostUncertain — empty input → null', () => {
  assert.equal(selectMostUncertain([]), null);
  assert.equal(selectMostUncertain(null), null);
  assert.equal(selectMostUncertain(undefined), null);
});

test('selectMostUncertain — single game → that game', () => {
  const g = { id: 'a', homeProbability: 0.5, drawProbability: 0.25, awayProbability: 0.25 };
  assert.equal(selectMostUncertain([g]), g);
});

test('selectMostUncertain — picks the game with lowest max probability', () => {
  const confident = {
    id: 'confident',
    homeProbability: 0.8,
    drawProbability: 0.1,
    awayProbability: 0.1,
  };
  // Near-uniform 3-way uncertain game — max = 0.36.
  const uncertain = {
    id: 'uncertain',
    homeProbability: 0.34,
    drawProbability: 0.36,
    awayProbability: 0.3,
  };
  const tossUp = {
    id: 'tossup',
    homeProbability: 0.5,
    drawProbability: 0.0,
    awayProbability: 0.5,
  };
  // The 3-way uncertain game wins — its max (0.36) is below the 50%
  // legacy toss-up's max (0.50) and the confident game's max (0.80).
  assert.equal(selectMostUncertain([confident, uncertain, tossUp]), uncertain);
});

test('selectMostUncertain — perfect 3-way (1/3 each) beats anything else', () => {
  const uniform = {
    id: 'uniform',
    homeProbability: 0.33,
    drawProbability: 0.34,
    awayProbability: 0.33,
  };
  const close = {
    id: 'close',
    homeProbability: 0.35,
    drawProbability: 0.35,
    awayProbability: 0.3,
  };
  assert.equal(selectMostUncertain([close, uniform]), uniform);
});

test('selectMostUncertain — ties broken by gameId ASC for determinism', () => {
  // Both games have max = 0.4.
  const a = { id: 'aaa', homeProbability: 0.4, drawProbability: 0.3, awayProbability: 0.3 };
  const b = { id: 'bbb', homeProbability: 0.4, drawProbability: 0.3, awayProbability: 0.3 };
  // 'aaa' < 'bbb' so 'aaa' wins.
  assert.equal(selectMostUncertain([a, b]).id, 'aaa');
  // Reverse input order — same answer.
  assert.equal(selectMostUncertain([b, a]).id, 'aaa');
});

test('selectMostUncertain — parses string-encoded probabilities (DECIMAL columns)', () => {
  // Sequelize returns DECIMAL columns as strings. The function must
  // parseFloat them — otherwise '0.50' > '0.36' lexicographically would
  // pick wrong.
  const confident = {
    id: 'confident',
    homeProbability: '0.80',
    drawProbability: '0.10',
    awayProbability: '0.10',
  };
  const uncertain = {
    id: 'uncertain',
    homeProbability: '0.34',
    drawProbability: '0.36',
    awayProbability: '0.30',
  };
  assert.equal(selectMostUncertain([confident, uncertain]).id, 'uncertain');
});

// ============================================================
// UTC day helpers
// ============================================================

test('todayDayKey — returns YYYY-MM-DD in UTC', () => {
  // Pick a moment near midnight in different timezones to verify UTC.
  const fixed = new Date('2026-05-31T23:30:00Z');
  assert.equal(todayDayKey(fixed), '2026-05-31');
});

test('todayDayKey — rolls forward at UTC midnight, not local', () => {
  const justBefore = new Date('2026-05-31T23:59:59Z');
  const justAfter = new Date('2026-06-01T00:00:01Z');
  assert.equal(todayDayKey(justBefore), '2026-05-31');
  assert.equal(todayDayKey(justAfter), '2026-06-01');
});

test('todayDayKey — pads month + day with leading zeros', () => {
  const earlyJan = new Date('2026-01-05T12:00:00Z');
  assert.equal(todayDayKey(earlyJan), '2026-01-05');
});

test('startOfUtcDay / startOfNextUtcDay — window bookends are 24h apart', () => {
  const noon = new Date('2026-05-31T14:23:45Z');
  const start = startOfUtcDay(noon);
  const end = startOfNextUtcDay(noon);
  assert.equal(start.toISOString(), '2026-05-31T00:00:00.000Z');
  assert.equal(end.toISOString(), '2026-06-01T00:00:00.000Z');
  assert.equal(end.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
});
