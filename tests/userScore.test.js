'use strict';

// Tier 24 — UserScoreService pure-function invariants. Backs the e2e
// verification gate (`tests/e2e/api/tier24-user-scores.spec.js` Layer 2)
// with pure-function-level coverage of the 8-arm idempotency matrix and
// the counter-delta derivation. No Sequelize / no DB — the actual UPDATE
// path is exercised end-to-end in the e2e layer.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computePoints, deriveCounterDeltas } = require('../services/UserScoreService');

// Minimal Game + Pick shapes that satisfy lib/scoring.js scorePick. The
// pick-time snapshot is what lib/scoring.js prefers when present, so we
// populate all three to match the post-Tier-17 wire shape.
function game(result, { home = 0.6, draw = 0.2, away = 0.2 } = {}) {
  return {
    result,
    homeProbability: home,
    drawProbability: draw,
    awayProbability: away,
  };
}
function pick(choice, snapshot = { home: 0.6, draw: 0.2, away: 0.2 }) {
  return {
    choice,
    pickedHomeProbability: snapshot.home,
    pickedDrawProbability: snapshot.draw,
    pickedAwayProbability: snapshot.away,
  };
}

test('computePoints — null result returns 0', () => {
  assert.equal(computePoints(pick('home'), game(null)), 0);
});

test('computePoints — winning home pick at 0.6 returns +40', () => {
  // (1 - 0.6) * 100 = 40
  assert.equal(computePoints(pick('home'), game('home')), 40);
});

test('computePoints — winning away pick at 0.2 returns +80', () => {
  // (1 - 0.2) * 100 = 80
  assert.equal(computePoints(pick('away'), game('away')), 80);
});

test('computePoints — losing pick returns 0 on home/away result', () => {
  assert.equal(computePoints(pick('home'), game('away')), 0);
  assert.equal(computePoints(pick('away'), game('home')), 0);
});

test('computePoints — draw branch awards partial credit to home pick', () => {
  // pts_home = round(P_d × P_a / (P_h + P_a) × 100)
  //         = round(0.2 × 0.2 / 0.8 × 100) = round(5) = 5
  assert.equal(computePoints(pick('home'), game('draw')), 5);
});

test('computePoints — draw branch awards partial credit to away pick', () => {
  // pts_away = round(P_d × P_h / (P_h + P_a) × 100)
  //         = round(0.2 × 0.6 / 0.8 × 100) = round(15) = 15
  assert.equal(computePoints(pick('away'), game('draw')), 15);
});

test('computePoints — uses pick-time snapshot when present (Tier 17)', () => {
  const p = pick('home', { home: 0.3, draw: 0.2, away: 0.5 });
  // Game.{home,draw,away} differs from snapshot; scoring must honor the
  // snapshot — (1 - 0.3) * 100 = 70, not (1 - 0.6) * 100 = 40.
  assert.equal(computePoints(p, game('home', { home: 0.6, draw: 0.2, away: 0.2 })), 70);
});

// Idempotency matrix — counter delta derivation. The matrix table in
// tier24.md "Idempotency + reversibility matrix" enumerates 8 arms.
// We test the 8 transitions of (oldResult, newResult) for the counter
// columns (picksScored + picksWon). Points delta is just (newPoints -
// oldPoints) and is exercised by the computePoints tests above + the
// integration tests in Layer 2.

test('deriveCounterDeltas — null → home: +1 scored, +1 won for matching choice', () => {
  const d = deriveCounterDeltas(pick('home'), null, 'home');
  assert.deepEqual(d, { scoredDelta: 1, wonDelta: 1 });
});

test('deriveCounterDeltas — null → home: +1 scored, +0 won for non-matching choice', () => {
  const d = deriveCounterDeltas(pick('away'), null, 'home');
  assert.deepEqual(d, { scoredDelta: 1, wonDelta: 0 });
});

test('deriveCounterDeltas — null → draw: +1 scored, +0 won (draws never count as wins)', () => {
  const d = deriveCounterDeltas(pick('home'), null, 'draw');
  assert.deepEqual(d, { scoredDelta: 1, wonDelta: 0 });
});

test('deriveCounterDeltas — home → null (cleared): -1 scored, -1 won', () => {
  const d = deriveCounterDeltas(pick('home'), 'home', null);
  assert.deepEqual(d, { scoredDelta: -1, wonDelta: -1 });
});

test('deriveCounterDeltas — home → away (changed): -1 won (home pick), away pick now wrong = 0 won', () => {
  const d = deriveCounterDeltas(pick('home'), 'home', 'away');
  // 0 scored (was scored before AND after — cancels), -1 won (was correct, no longer correct).
  assert.deepEqual(d, { scoredDelta: 0, wonDelta: -1 });
});

test('deriveCounterDeltas — home → away (changed) where pick was away: +1 won', () => {
  const d = deriveCounterDeltas(pick('away'), 'home', 'away');
  assert.deepEqual(d, { scoredDelta: 0, wonDelta: 1 });
});

test('deriveCounterDeltas — home → draw: -1 won (home pick was correct, draws never count)', () => {
  const d = deriveCounterDeltas(pick('home'), 'home', 'draw');
  assert.deepEqual(d, { scoredDelta: 0, wonDelta: -1 });
});

test('deriveCounterDeltas — same result re-saved: zero delta on both counters', () => {
  // The applyPickTransition short-circuit catches this before
  // applyDelta sees it; testing the counter math here proves that even
  // if it slipped through, the math is a no-op.
  assert.deepEqual(deriveCounterDeltas(pick('home'), 'home', 'home'), {
    scoredDelta: 0,
    wonDelta: 0,
  });
  assert.deepEqual(deriveCounterDeltas(pick('away'), 'draw', 'draw'), {
    scoredDelta: 0,
    wonDelta: 0,
  });
});

// Round-trip invariants — every transition path that returns to a
// known state must produce a counter sum that returns to the same state.
// Mirrors the e2e "round-trips" group (Layer 2 cases 16-18) at unit
// granularity.

test('round-trip null → home → null produces zero net delta', () => {
  const a = deriveCounterDeltas(pick('home'), null, 'home');
  const b = deriveCounterDeltas(pick('home'), 'home', null);
  assert.equal(a.scoredDelta + b.scoredDelta, 0);
  assert.equal(a.wonDelta + b.wonDelta, 0);
});

test('round-trip home → away → home produces zero net delta', () => {
  const a = deriveCounterDeltas(pick('home'), 'home', 'away');
  const b = deriveCounterDeltas(pick('home'), 'away', 'home');
  assert.equal(a.scoredDelta + b.scoredDelta, 0);
  assert.equal(a.wonDelta + b.wonDelta, 0);
});

test('round-trip null → home → away → draw → null produces zero net delta', () => {
  const p = pick('home');
  const a = deriveCounterDeltas(p, null, 'home');
  const b = deriveCounterDeltas(p, 'home', 'away');
  const c = deriveCounterDeltas(p, 'away', 'draw');
  const d = deriveCounterDeltas(p, 'draw', null);
  assert.equal(a.scoredDelta + b.scoredDelta + c.scoredDelta + d.scoredDelta, 0);
  assert.equal(a.wonDelta + b.wonDelta + c.wonDelta + d.wonDelta, 0);
});
