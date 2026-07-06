'use strict';

// Trophy Cabinet — pure-function tests for the placement math. Exercises the
// helpers exported by services/TrophyService.js without a live DB. The
// database-backed shape + visibility gate are covered by the per-endpoint API
// spec in tests/e2e/api/users.spec.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  rankAmong,
  topPercentOf,
  buildShowcase,
  orderStages,
} = require('../services/TrophyService');
const { stageLabel, medalFor } = require('../lib/stages');

// ---------------------------------------------------------------------------
// rankAmong — competition ranking (ties share the better rank)
// ---------------------------------------------------------------------------

test('rankAmong — top score ranks 1', () => {
  assert.equal(rankAmong(100, [100, 80, 60]), 1);
});

test('rankAmong — bottom score ranks last', () => {
  assert.equal(rankAmong(60, [100, 80, 60]), 3);
});

test('rankAmong — ties share the better rank (standard competition ranking)', () => {
  // Two participants tied at 100, one at 50. Both 100s are rank 1; the 50 is
  // rank 3 (1 + count strictly greater = 1 + 2).
  assert.equal(rankAmong(100, [100, 100, 50]), 1);
  assert.equal(rankAmong(50, [100, 100, 50]), 3);
});

test('rankAmong — lone participant ranks 1', () => {
  assert.equal(rankAmong(42, [42]), 1);
});

test('rankAmong — zero-point participant still ranks among peers', () => {
  assert.equal(rankAmong(0, [30, 0, 0]), 2);
});

// ---------------------------------------------------------------------------
// topPercentOf — "top X%", clamped to [1, 100]
// ---------------------------------------------------------------------------

test('topPercentOf — rank 1 of 100 is Top 1%', () => {
  assert.equal(topPercentOf(1, 100), 1);
});

test('topPercentOf — last of N is Top 100%', () => {
  assert.equal(topPercentOf(50, 50), 100);
});

test('topPercentOf — mid-pack rounds', () => {
  assert.equal(topPercentOf(3, 40), 8); // 3/40 = 7.5% → 8
});

test('topPercentOf — clamps rank 1 up from 0', () => {
  // 1/1000 rounds to 0 without the floor; must read Top 1%.
  assert.equal(topPercentOf(1, 1000), 1);
});

test('topPercentOf — empty pool defaults to 100', () => {
  assert.equal(topPercentOf(1, 0), 100);
});

// ---------------------------------------------------------------------------
// medalFor (lib/stages)
// ---------------------------------------------------------------------------

test('medalFor — podium', () => {
  assert.equal(medalFor(1), 'gold');
  assert.equal(medalFor(2), 'silver');
  assert.equal(medalFor(3), 'bronze');
  assert.equal(medalFor(4), null);
});

// ---------------------------------------------------------------------------
// stageLabel (lib/stages)
// ---------------------------------------------------------------------------

test('stageLabel — known tokens', () => {
  assert.equal(stageLabel('GROUP_STAGE'), 'Group Stage');
  assert.equal(stageLabel('LAST_32'), 'Round of 32');
  assert.equal(stageLabel('LAST_16'), 'Round of 16');
  assert.equal(stageLabel('QUARTER_FINALS'), 'Quarter Finals');
  assert.equal(stageLabel('SEMI_FINALS'), 'Semi Finals');
  assert.equal(stageLabel('THIRD_PLACE'), 'Third Place');
  assert.equal(stageLabel('FINAL'), 'Final');
});

test('stageLabel — unknown token falls back to title case', () => {
  assert.equal(stageLabel('PRELIMINARY_ROUND'), 'Preliminary Round');
});

test('stageLabel — null → Unknown Stage', () => {
  assert.equal(stageLabel(null), 'Unknown Stage');
});

// ---------------------------------------------------------------------------
// orderStages — WC order first, unknown tokens appended alphabetically
// ---------------------------------------------------------------------------

test('orderStages — sorts by WC_STAGE_ORDER', () => {
  assert.deepEqual(orderStages(['FINAL', 'GROUP_STAGE', 'SEMI_FINALS']), [
    'GROUP_STAGE',
    'SEMI_FINALS',
    'FINAL',
  ]);
});

test('orderStages — dedups + drops falsy', () => {
  assert.deepEqual(orderStages(['FINAL', 'FINAL', null, 'GROUP_STAGE']), ['GROUP_STAGE', 'FINAL']);
});

test('orderStages — unknown tokens land after known ones, alphabetically', () => {
  assert.deepEqual(orderStages(['ZEBRA', 'FINAL', 'ALPHA']), ['FINAL', 'ALPHA', 'ZEBRA']);
});

// ---------------------------------------------------------------------------
// buildShowcase — medal tally + best finish
// ---------------------------------------------------------------------------

test('buildShowcase — counts medals + best finish across entered stages', () => {
  const stages = [
    { stage: 'GROUP_STAGE', label: 'Group Stage', overall: { rank: 1, medal: 'gold' } },
    { stage: 'LAST_16', label: 'Round of 16', overall: { rank: 3, medal: 'bronze' } },
    { stage: 'QUARTER_FINALS', label: 'Quarter Finals', overall: null }, // not entered
    { stage: 'FINAL', label: 'Final', overall: { rank: 2, medal: 'silver' } },
  ];
  const showcase = buildShowcase(stages);
  assert.equal(showcase.gold, 1);
  assert.equal(showcase.silver, 1);
  assert.equal(showcase.bronze, 1);
  assert.equal(showcase.enteredStages, 3);
  assert.deepEqual(showcase.bestFinish, { rank: 1, stage: 'GROUP_STAGE', label: 'Group Stage' });
});

test('buildShowcase — empty when nothing entered', () => {
  const showcase = buildShowcase([
    { stage: 'FINAL', label: 'Final', overall: null },
    { stage: 'GROUP_STAGE', label: 'Group Stage', overall: null },
  ]);
  assert.deepEqual(showcase, {
    gold: 0,
    silver: 0,
    bronze: 0,
    enteredStages: 0,
    bestFinish: null,
  });
});

test('buildShowcase — bestFinish tracks the numerically smallest rank', () => {
  const showcase = buildShowcase([
    { stage: 'GROUP_STAGE', label: 'Group Stage', overall: { rank: 7, medal: null } },
    { stage: 'LAST_16', label: 'Round of 16', overall: { rank: 4, medal: null } },
  ]);
  assert.equal(showcase.bestFinish.rank, 4);
  assert.equal(showcase.bestFinish.stage, 'LAST_16');
});
