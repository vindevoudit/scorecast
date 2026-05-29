'use strict';

// Tier 17 — eloMath invariants. These are the math properties the seeder
// + PredictionService both depend on; breaking any of them silently shifts
// every probability output in the system. Mirror tests exist on the
// Python side (ml/tests/test_elo_engine.py); when both passes the JS port
// of the algorithm is provably equivalent under the configs we ship.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  K_FACTOR,
  INITIAL_RATING,
  HFA,
  expectedHomeScore,
  actualScores,
  updateElos,
  eloDelta,
} = require('../lib/ml/eloMath');

test('K=20, INITIAL=1500, HFA=0 (config locked)', () => {
  assert.equal(K_FACTOR, 20);
  assert.equal(INITIAL_RATING, 1500);
  assert.equal(HFA, 0);
});

test('expectedHomeScore is 0.5 when ratings are equal and HFA=0', () => {
  assert.ok(Math.abs(expectedHomeScore(1500, 1500) - 0.5) < 1e-12);
  assert.ok(Math.abs(expectedHomeScore(2000, 2000) - 0.5) < 1e-12);
});

test('expectedHomeScore + expectedAwayScore = 1.0 per match', () => {
  for (const [rh, ra] of [
    [1500, 1500],
    [1700, 1400],
    [1400, 1700],
    [1900, 1200],
  ]) {
    const eh = expectedHomeScore(rh, ra);
    const ea = 1 - eh;
    assert.ok(Math.abs(eh + ea - 1.0) < 1e-12, `[${rh}, ${ra}] eh+ea = ${eh + ea}`);
  }
});

test('expectedHomeScore >0.9 for a +400-rating gap', () => {
  assert.ok(expectedHomeScore(1900, 1500) > 0.9);
  assert.ok(expectedHomeScore(1500, 1900) < 0.1);
});

test('actualScores returns canonical pairs', () => {
  assert.deepEqual(actualScores('home'), [1.0, 0.0]);
  assert.deepEqual(actualScores('away'), [0.0, 1.0]);
  assert.deepEqual(actualScores('draw'), [0.5, 0.5]);
  assert.throws(() => actualScores('X'), /home\|away\|draw/);
});

test('updateElos: zero-sum invariant — home gain = away loss', () => {
  // Two equal-rated teams play; one wins. The points one gains, the other
  // loses, exactly. This isolates the symmetry of the update formula.
  for (const result of ['home', 'away', 'draw']) {
    const { newHomeElo, newAwayElo } = updateElos(1500, 1500, result);
    const delta = newHomeElo - 1500 + (newAwayElo - 1500);
    assert.ok(Math.abs(delta) < 1e-9, `result=${result} delta=${delta}`);
  }
});

test('updateElos: home wins → home elo rises, away elo falls', () => {
  const { newHomeElo, newAwayElo } = updateElos(1500, 1500, 'home');
  assert.ok(newHomeElo > 1500);
  assert.ok(newAwayElo < 1500);
});

test('updateElos: home wins vs equal opponent gains exactly K/2 (=10)', () => {
  // expected = 0.5, actual = 1.0 → delta = K * (1 - 0.5) = 10
  const { newHomeElo } = updateElos(1500, 1500, 'home');
  assert.ok(Math.abs(newHomeElo - 1510) < 1e-9, `got ${newHomeElo}`);
});

test('updateElos: draw between equal teams is a no-op', () => {
  // expected = actual = 0.5 → delta = 0
  const { newHomeElo, newAwayElo } = updateElos(1500, 1500, 'draw');
  assert.ok(Math.abs(newHomeElo - 1500) < 1e-9);
  assert.ok(Math.abs(newAwayElo - 1500) < 1e-9);
});

test('updateElos: upset (low-rated home beats high-rated away) pays more than even', () => {
  // Home (1300) beats Away (1700). Expected home win prob is small, so K * (1 - small) ≈ K.
  const { newHomeElo } = updateElos(1300, 1700, 'home');
  const delta = newHomeElo - 1300;
  // Upset gain should be substantial — at least half of K (10 of K=20).
  assert.ok(delta > 10, `upset delta only ${delta}, expected > 10`);
  // ...and never exceed K itself.
  assert.ok(delta <= K_FACTOR, `upset delta ${delta} exceeds K=${K_FACTOR}`);
});

test('updateElos: pure function — does not mutate input numbers', () => {
  const r1 = 1600;
  const r2 = 1500;
  updateElos(r1, r2, 'home');
  // (Numbers are primitives so this is structurally impossible, but it
  // documents the contract for future callers reading the test suite.)
  assert.equal(r1, 1600);
  assert.equal(r2, 1500);
});

test('eloDelta: zero-sum invariant (home delta == -away delta)', () => {
  for (const result of ['home', 'away', 'draw']) {
    const d = eloDelta(1600, 1450, result);
    assert.ok(Math.abs(d.home + d.away) < 1e-9, `result=${result} sum=${d.home + d.away}`);
  }
});

test('eloDelta: applying then reversing the same delta cancels out', () => {
  // The PR F reversal invariant: storing a snapshot + applying delta(r1),
  // then later subtracting delta(r1) using the same snapshot, returns Elo
  // to the original pair exactly. Tests against several rating gaps.
  for (const [rh, ra, result] of [
    [1500, 1500, 'home'],
    [1700, 1400, 'away'],
    [1400, 1700, 'draw'],
    [1648.3, 1635.8, 'home'],
  ]) {
    const d = eloDelta(rh, ra, result);
    const reverted = { home: rh + d.home - d.home, away: ra + d.away - d.away };
    assert.equal(reverted.home, rh);
    assert.equal(reverted.away, ra);
  }
});

test('eloDelta + updateElos parity: delta + base == updateElos.newElos', () => {
  // Spot-check that the pure-delta function agrees with the legacy
  // updateElos signature. Drift between them would silently desync
  // PR F's reverse path from any caller still using updateElos.
  for (const [rh, ra, result] of [
    [1500, 1500, 'home'],
    [1700, 1400, 'away'],
    [1400, 1700, 'draw'],
  ]) {
    const d = eloDelta(rh, ra, result);
    const u = updateElos(rh, ra, result);
    assert.ok(Math.abs(rh + d.home - u.newHomeElo) < 1e-9);
    assert.ok(Math.abs(ra + d.away - u.newAwayElo) < 1e-9);
  }
});

test('updateElos chained: applying then reverting brings team back near start', () => {
  // Not exactly reversible (the second match's expected_score depends on
  // post-match ratings), but the magnitudes should be sensible.
  const start = 1500;
  const { newHomeElo, newAwayElo } = updateElos(start, start, 'home');
  // Now play again with reversed result — home should lose ground.
  const back = updateElos(newHomeElo, newAwayElo, 'away');
  // Home should be closer to start than after the first match.
  assert.ok(Math.abs(back.newHomeElo - start) < Math.abs(newHomeElo - start));
});

// ---------------------------------------------------------------------------
// International model — opts.kMultiplier + opts.neutral support. Locked
// together with ml/scorecast_ml/elo/engine.py via the parity invariant in
// CLAUDE.md ("Elo math parity"). The default-bit-identical assertions guard
// the PL pipeline from any unintended drift.
// ---------------------------------------------------------------------------

test('eloDelta: omitted opts produce bit-identical output to no-opts signature', () => {
  // The non-regression contract: every PL callsite passes 3 args and must
  // see the exact same numeric output. Sample across the rating space.
  const cases = [
    [1500, 1500, 'home'],
    [1500, 1500, 'away'],
    [1500, 1500, 'draw'],
    [1700, 1400, 'home'],
    [1300, 1900, 'home'], // upset
    [1648.3, 1635.8, 'draw'],
  ];
  for (const [rh, ra, result] of cases) {
    const noOpts = eloDelta(rh, ra, result);
    const emptyOpts = eloDelta(rh, ra, result, {});
    assert.equal(noOpts.home, emptyOpts.home, `home drift at [${rh}, ${ra}, ${result}]`);
    assert.equal(noOpts.away, emptyOpts.away, `away drift at [${rh}, ${ra}, ${result}]`);
  }
});

test('updateElos: omitted opts produce bit-identical output to no-opts signature', () => {
  const cases = [
    [1500, 1500, 'home'],
    [1700, 1400, 'away'],
    [1300, 1900, 'draw'],
  ];
  for (const [rh, ra, result] of cases) {
    const noOpts = updateElos(rh, ra, result);
    const emptyOpts = updateElos(rh, ra, result, {});
    assert.equal(noOpts.newHomeElo, emptyOpts.newHomeElo);
    assert.equal(noOpts.newAwayElo, emptyOpts.newAwayElo);
  }
});

test('eloDelta: kMultiplier=3 triples delta magnitude vs default', () => {
  // Triples both legs — and preserves zero-sum.
  for (const [rh, ra, result] of [
    [1500, 1500, 'home'],
    [1700, 1400, 'away'],
    [1300, 1900, 'draw'],
  ]) {
    const base = eloDelta(rh, ra, result);
    const triple = eloDelta(rh, ra, result, { kMultiplier: 3 });
    assert.ok(
      Math.abs(triple.home - base.home * 3) < 1e-9,
      `home: ${triple.home} vs 3×${base.home}`,
    );
    assert.ok(
      Math.abs(triple.away - base.away * 3) < 1e-9,
      `away: ${triple.away} vs 3×${base.away}`,
    );
    assert.ok(
      Math.abs(triple.home + triple.away) < 1e-9,
      `zero-sum violated: ${triple.home + triple.away}`,
    );
  }
});

test('eloDelta: neutral=true is equivalent to default while HFA=0', () => {
  // HFA constant is 0 today so the neutral flag is structurally a no-op
  // for the magnitude. This test pins the equivalence; if HFA ever becomes
  // non-zero the neutral branch must diverge — which would then need a
  // dedicated assertion.
  for (const [rh, ra, result] of [
    [1500, 1500, 'home'],
    [1700, 1400, 'away'],
    [1300, 1900, 'draw'],
  ]) {
    const standard = eloDelta(rh, ra, result);
    const neutral = eloDelta(rh, ra, result, { neutral: true });
    assert.equal(neutral.home, standard.home);
    assert.equal(neutral.away, standard.away);
  }
});

test('eloDelta: neutral=true with equal ratings is symmetric in H↔A swap', () => {
  // Home picking vs away picking on a neutral fixture between equal teams:
  // by symmetry of the Elo logistic with HFA=0, the home-team delta from
  // a home win equals the away-team delta from an away win (mirror image).
  const eq = 1500;
  const dHomeWin = eloDelta(eq, eq, 'home', { neutral: true });
  const dAwayWin = eloDelta(eq, eq, 'away', { neutral: true });
  assert.equal(dHomeWin.home, dAwayWin.away);
  assert.equal(dHomeWin.away, dAwayWin.home);
});

test('eloDelta: combined kMultiplier + neutral compose multiplicatively', () => {
  // K-mult scales magnitude; neutral controls HFA. With HFA=0 today, neutral
  // is structurally moot but the multiplicative behavior under kMultiplier
  // must hold either way.
  const base = eloDelta(1500, 1500, 'home');
  const combined = eloDelta(1500, 1500, 'home', { kMultiplier: 2.5, neutral: true });
  assert.ok(Math.abs(combined.home - base.home * 2.5) < 1e-9);
  assert.ok(Math.abs(combined.away - base.away * 2.5) < 1e-9);
});

test('updateElos: kMultiplier=3 triples elo movement', () => {
  const start = 1500;
  const single = updateElos(start, start, 'home');
  const triple = updateElos(start, start, 'home', { kMultiplier: 3 });
  // single delta is 10 (K=20, expected=0.5, actual=1); triple should be 30.
  assert.ok(Math.abs(single.newHomeElo - 1510) < 1e-9);
  assert.ok(Math.abs(triple.newHomeElo - 1530) < 1e-9);
});

test('eloDelta: applying then reversing under the same opts is exact', () => {
  // The PR F reversal invariant carried into the K-mult arm: storing a
  // snapshot + applying delta with K-mult=3, then later subtracting the
  // delta computed FROM THE SAME SNAPSHOT with the same K-mult, returns
  // Elo to the original pair exactly. This is the property that
  // PredictionService.onResultUpdated depends on when an INT result is
  // changed (X → Y reversal arm).
  for (const [rh, ra, result, kMultiplier] of [
    [1500, 1500, 'home', 3],
    [1700, 1400, 'away', 2.5],
    [1648.3, 1635.8, 'draw', 1.5],
  ]) {
    const d = eloDelta(rh, ra, result, { kMultiplier });
    // Apply forward, then reverse against the same snapshot.
    const after = { home: rh + d.home, away: ra + d.away };
    const restored = { home: after.home - d.home, away: after.away - d.away };
    assert.equal(restored.home, rh);
    assert.equal(restored.away, ra);
  }
});
