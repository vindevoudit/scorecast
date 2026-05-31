'use strict';

// Tier 30 Phase 3 A1 Revision (2026-05-31) — Win-streak service tests.
//
// Exercises the pure functions (classify, computeStreakFromPicks,
// resolveMilestone) directly so the suite doesn't need a live DB.
// applyForUser is covered by e2e (it touches User.save +
// NotificationService).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  classify,
  computeStreakFromPicks,
  resolveMilestone,
  STREAK_MILESTONES,
} = require('../services/StreakService');

// Helper — build a scored-pick row in the shape computeStreakFromPicks
// expects ({choice, game: {id, date, result}}).
function pick({ id, date, choice, result }) {
  return {
    choice,
    game: { id, date, result },
  };
}

// Build a W/D/L sequence on sequential days. Each entry is a one-char
// kind: 'W', 'D', 'L'. Day 1 = 2026-01-01, day 2 = 2026-01-02, ...
function sequence(spec) {
  return spec.split('').map((kind, i) => {
    const day = String(i + 1).padStart(2, '0');
    const date = `2026-01-${day}T15:00:00Z`;
    const gameId = `g${i}`;
    if (kind === 'W') return pick({ id: gameId, date, choice: 'home', result: 'home' });
    if (kind === 'L') return pick({ id: gameId, date, choice: 'home', result: 'away' });
    return pick({ id: gameId, date, choice: 'home', result: 'draw' });
  });
}

// Build a batch where every pick shares the same kickoff timestamp.
function batch(spec, { date = '2026-01-01T15:00:00Z', start = 0 } = {}) {
  return spec.split('').map((kind, i) => {
    const gameId = `b${start + i}`;
    if (kind === 'W') return pick({ id: gameId, date, choice: 'home', result: 'home' });
    if (kind === 'L') return pick({ id: gameId, date, choice: 'home', result: 'away' });
    return pick({ id: gameId, date, choice: 'home', result: 'draw' });
  });
}

// ============================================================
// classify
// ============================================================

test('classify — pick.choice matches non-draw result → win', () => {
  assert.equal(classify({ choice: 'home' }, { result: 'home' }), 'win');
  assert.equal(classify({ choice: 'away' }, { result: 'away' }), 'win');
});

test('classify — game.result is "draw" → draw regardless of choice', () => {
  assert.equal(classify({ choice: 'home' }, { result: 'draw' }), 'draw');
  assert.equal(classify({ choice: 'away' }, { result: 'draw' }), 'draw');
});

test('classify — pick.choice does not match non-draw result → loss', () => {
  assert.equal(classify({ choice: 'home' }, { result: 'away' }), 'loss');
  assert.equal(classify({ choice: 'away' }, { result: 'home' }), 'loss');
});

// ============================================================
// computeStreakFromPicks — sequential cases
// ============================================================

test('computeStreakFromPicks — empty input → 0/0', () => {
  assert.deepEqual(computeStreakFromPicks([]), { current: 0, longest: 0 });
});

test('computeStreakFromPicks — single W → 1/1', () => {
  assert.deepEqual(computeStreakFromPicks(sequence('W')), { current: 1, longest: 1 });
});

test('computeStreakFromPicks — W/W/W → 3/3', () => {
  assert.deepEqual(computeStreakFromPicks(sequence('WWW')), { current: 3, longest: 3 });
});

test('computeStreakFromPicks — W/L → current 0, longest captures the W', () => {
  assert.deepEqual(computeStreakFromPicks(sequence('WL')), { current: 0, longest: 1 });
});

test('computeStreakFromPicks — W/W/L → current 0, longest captures peak before loss', () => {
  assert.deepEqual(computeStreakFromPicks(sequence('WWL')), { current: 0, longest: 2 });
});

test('computeStreakFromPicks — W/W/L/W → current 1, longest stays at 2', () => {
  assert.deepEqual(computeStreakFromPicks(sequence('WWLW')), { current: 1, longest: 2 });
});

test('computeStreakFromPicks — W/D/W → draw does NOT reset; current 2, longest 2', () => {
  assert.deepEqual(computeStreakFromPicks(sequence('WDW')), { current: 2, longest: 2 });
});

test('computeStreakFromPicks — D/W → leading draw is no-op; current 1, longest 1', () => {
  assert.deepEqual(computeStreakFromPicks(sequence('DW')), { current: 1, longest: 1 });
});

test('computeStreakFromPicks — W/D/L → current 0, longest 1', () => {
  assert.deepEqual(computeStreakFromPicks(sequence('WDL')), { current: 0, longest: 1 });
});

test('computeStreakFromPicks — D-only sequence → 0/0', () => {
  assert.deepEqual(computeStreakFromPicks(sequence('DDDD')), { current: 0, longest: 0 });
});

test('computeStreakFromPicks — L-only sequence → 0/0', () => {
  assert.deepEqual(computeStreakFromPicks(sequence('LLLL')), { current: 0, longest: 0 });
});

// ============================================================
// computeStreakFromPicks — same-kickoff batch ordering
// ============================================================

test('computeStreakFromPicks — batch W/L → wins-first; current 0, longest 1', () => {
  // No prior history. Batch is W + L. Order applied: W first → current=1
  // (longest=1) → L → current=0. Final {0, 1}.
  assert.deepEqual(computeStreakFromPicks(batch('WL')), { current: 0, longest: 1 });
});

test('computeStreakFromPicks — batch W/W/L → wins-first; longest captures 2', () => {
  assert.deepEqual(computeStreakFromPicks(batch('WWL')), { current: 0, longest: 2 });
});

test('computeStreakFromPicks — batch W/D/L → wins-first then draw then loss; longest 1', () => {
  assert.deepEqual(computeStreakFromPicks(batch('WDL')), { current: 0, longest: 1 });
});

test('computeStreakFromPicks — batch D-only → unchanged 0/0', () => {
  assert.deepEqual(computeStreakFromPicks(batch('DDD')), { current: 0, longest: 0 });
});

test('computeStreakFromPicks — batch L-only → current resets, longest stays 0', () => {
  assert.deepEqual(computeStreakFromPicks(batch('LL')), { current: 0, longest: 0 });
});

test('computeStreakFromPicks — user wording scenario: prev=5 then batch W/W/L → longest captures 7', () => {
  // Simulate a user mid-history at current=5 then a batch of W/W/L at
  // the same kickoff. Build the prior 5 wins as a leading run, then the
  // batch.
  const prior = sequence('WWWWW'); // current=5, longest=5
  const concurrent = batch('WWL', { date: '2026-02-01T15:00:00Z', start: 100 });
  const all = [...prior, ...concurrent];
  // Wins-first inside the batch: 5 → 6 → 7 (longest captures 7) → L
  // resets to 0. Final {0, 7}.
  assert.deepEqual(computeStreakFromPicks(all), { current: 0, longest: 7 });
});

// ============================================================
// computeStreakFromPicks — mixed-kickoff sequence
// ============================================================

test('computeStreakFromPicks — solo W, then batch W/W/L, then solo W → final 1, longest captures batch peak', () => {
  const solo1 = sequence('W'); // 2026-01-01
  const concurrent = batch('WWL', { date: '2026-02-01T15:00:00Z', start: 10 });
  const solo2 = [
    pick({ id: 'late', date: '2026-03-01T15:00:00Z', choice: 'home', result: 'home' }),
  ];
  const all = [...solo1, ...concurrent, ...solo2];
  // Walk: solo W → 1 (long=1). Batch W → 2 → 3 (long=3) → L → 0. Solo W → 1.
  assert.deepEqual(computeStreakFromPicks(all), { current: 1, longest: 3 });
});

// ============================================================
// computeStreakFromPicks — filtering + determinism
// ============================================================

test('computeStreakFromPicks — pending picks (result=null) are filtered out', () => {
  const scored = sequence('WW');
  const pending = [pick({ id: 'pen', date: '2026-04-01T15:00:00Z', choice: 'home', result: null })];
  assert.deepEqual(computeStreakFromPicks([...scored, ...pending]), { current: 2, longest: 2 });
});

test('computeStreakFromPicks — sort is fully stable; 100 random shuffles produce identical output', () => {
  const ordered = [
    ...sequence('WWL'),
    ...batch('WWLD', { date: '2026-05-01T15:00:00Z', start: 50 }),
    ...sequence('W'),
  ];
  const expected = computeStreakFromPicks(ordered);
  for (let trial = 0; trial < 100; trial += 1) {
    const shuffled = [...ordered].sort(() => Math.random() - 0.5);
    assert.deepEqual(computeStreakFromPicks(shuffled), expected);
  }
});

test('computeStreakFromPicks — gameId tiebreaker is deterministic for same-date same-result picks', () => {
  // Two picks at identical kickoff, both W, different gameIds. Order
  // must be deterministic. The function sorts by id ascending, but
  // since both are W they aggregate to current=2 regardless. Check
  // that swapping input order doesn't change the output.
  const a = [
    pick({ id: 'a', date: '2026-06-01T15:00:00Z', choice: 'home', result: 'home' }),
    pick({ id: 'b', date: '2026-06-01T15:00:00Z', choice: 'home', result: 'home' }),
  ];
  const b = [a[1], a[0]];
  assert.deepEqual(computeStreakFromPicks(a), computeStreakFromPicks(b));
});

// ============================================================
// resolveMilestone — dedup
// ============================================================

test('resolveMilestone — new current crosses milestone → fires that milestone', () => {
  // 0 → 5: cross the 5 milestone.
  assert.deepEqual(resolveMilestone(5, 0), { fire: 5, nextStamp: 5 });
});

test('resolveMilestone — current stays at a previously-fired milestone → no re-fire', () => {
  // Already fired 5; current is back to 5 on a recompute. No re-fire.
  assert.deepEqual(resolveMilestone(5, 5), { fire: null, nextStamp: 5 });
});

test('resolveMilestone — current jumps past multiple milestones → fires the largest one', () => {
  // 0 → 12. Eligible: [5, 10]. Fire 10 (largest), stamp 10.
  assert.deepEqual(resolveMilestone(12, 0), { fire: 10, nextStamp: 10 });
});

test('resolveMilestone — current drops below stamp → stamp drops to largest M ≤ new current', () => {
  // 12 stamp at 10, current now 6 (loss recompute). Largest M ≤ 6 is 5.
  // Drop stamp to 5 so a future re-cross of 10 will re-fire.
  assert.deepEqual(resolveMilestone(6, 10), { fire: null, nextStamp: 5 });
});

test('resolveMilestone — current drops to 0 → stamp drops to 0', () => {
  assert.deepEqual(resolveMilestone(0, 10), { fire: null, nextStamp: 0 });
});

test('resolveMilestone — re-cross fires correctly after a reset', () => {
  // First: 0 → 5 → fire 5 → reset to 0 → re-cross to 5 → fire 5 again.
  let stamp = 0;
  let r = resolveMilestone(5, stamp);
  assert.equal(r.fire, 5);
  stamp = r.nextStamp;
  r = resolveMilestone(0, stamp);
  assert.equal(r.fire, null);
  stamp = r.nextStamp;
  r = resolveMilestone(5, stamp);
  assert.equal(r.fire, 5);
});

test('resolveMilestone — STREAK_MILESTONES contains 5,10,15,20,30,50', () => {
  assert.deepEqual(STREAK_MILESTONES, [5, 10, 15, 20, 30, 50]);
});
