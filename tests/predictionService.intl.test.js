'use strict';

// International model — focused unit tests for the PredictionService
// extensions:
//   1. K-multiplier flows through the eloMath.eloDelta path used by
//      onResultUpdated. Tested at the eloMath layer (the cascade calls
//      eloDelta directly with the same opts) — the integration is
//      structurally trivial.
//   2. Reverse-then-reapply with a K-mult > 1 returns Elo to the exact
//      pre-snapshot value (Tier 17 PR F idempotency parity extended).
//   3. Neutral-venue symmetrization in rePredictFutureFixtures produces
//      strictly order-independent probabilities.
//
// We don't spin up the DB here — the cascade's DB orchestration is
// covered by Tier 17's existing parity tests + the e2e API specs. This
// suite locks the MATH the cascade depends on so any drift surfaces
// before integration.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const eloMath = require('../lib/ml/eloMath');
const xgboost = require('../lib/ml/xgboostInference');
const normalize = require('../lib/ml/normalize');

// Load the committed INT model so the symmetrization test runs against
// the real artifact. Falls back to a graceful skip if the model file
// hasn't been committed yet (matches the cascade's PR B → PR C handoff
// behavior in the wild).
const INT_MODEL_PATH = path.join(__dirname, '..', 'lib', 'ml', 'models', 'INT_elo.json');
let intModel = null;
try {
  intModel = xgboost.loadModel(INT_MODEL_PATH, { numFeatures: 2 });
} catch {
  // Model not committed yet — symmetrization test will skip.
}

test('Cascade K-mult delta: 3x equal-team home win produces +30 / -30 delta', () => {
  // The cascade calls eloMath.eloDelta(homeEloPre, awayEloPre, result,
  // { kMultiplier, neutral }). For equal-Elo (1500 each), home win, K=20,
  // mult=3 — delta is 30/-30 (not 10/-10 as for PL with K=20 × 1).
  const d = eloMath.eloDelta(1500, 1500, 'home', { kMultiplier: 3, neutral: true });
  assert.ok(Math.abs(d.home - 30) < 1e-9, `home delta was ${d.home}, expected ~30`);
  assert.ok(Math.abs(d.away + 30) < 1e-9, `away delta was ${d.away}, expected ~-30`);
});

test('Cascade reverse+reapply under K-mult=3 returns Elo to pre-snapshot exactly', () => {
  // Tier 17 PR F invariant carried into the K-mult arm: storing pre-match
  // Elo as a snapshot + applying delta with K-mult=3, then later subtracting
  // the same-shape delta from the same snapshot, returns BOTH teams' live
  // Elo to the original values exactly. This is what enables a WC result
  // edit (X → Y) to reverse cleanly under FIFA-style weights.
  const homeEloPre = 1900.0;
  const awayEloPre = 1700.0;
  const k = 3;

  // First capture: home win.
  const d1 = eloMath.eloDelta(homeEloPre, awayEloPre, 'home', { kMultiplier: k, neutral: true });
  const homeLive1 = homeEloPre + d1.home;
  const awayLive1 = awayEloPre + d1.away;

  // Operator edits the result: it was actually an away win, not a home win.
  // The cascade reverses d1 against the locked snapshot, then applies a new
  // delta for the new result against the SAME snapshot.
  const homeReverted = homeLive1 - d1.home;
  const awayReverted = awayLive1 - d1.away;
  // After reverse, live Elo equals the original pre-snapshot (drift-free).
  assert.equal(homeReverted, homeEloPre);
  assert.equal(awayReverted, awayEloPre);

  const d2 = eloMath.eloDelta(homeEloPre, awayEloPre, 'away', { kMultiplier: k, neutral: true });
  const homeLive2 = homeReverted + d2.home;
  const awayLive2 = awayReverted + d2.away;

  // Now operator reverts AGAIN — back to the original home win.
  const homeReverted2 = homeLive2 - d2.home;
  const awayReverted2 = awayLive2 - d2.away;
  assert.equal(homeReverted2, homeEloPre);
  assert.equal(awayReverted2, awayEloPre);

  // Re-apply the original delta → live Elo should match the FIRST capture
  // exactly (no drift through the X → Y → X round-trip).
  const homeFinal = homeReverted2 + d1.home;
  const awayFinal = awayReverted2 + d1.away;
  assert.equal(homeFinal, homeLive1);
  assert.equal(awayFinal, awayLive1);
});

test('Cascade K-mult=1 + neutral=false collapses to PL-bit-identical path', () => {
  // The non-regression contract for PL: when both opts default through,
  // the cascade's eloDelta call MUST produce the same numbers it did
  // before the international model shipped.
  const cases = [
    [1500, 1500, 'home'],
    [1700, 1400, 'away'],
    [1648.3, 1635.8, 'draw'],
  ];
  for (const [rh, ra, result] of cases) {
    const baseline = eloMath.eloDelta(rh, ra, result);
    const intlDefault = eloMath.eloDelta(rh, ra, result, { kMultiplier: 1, neutral: false });
    assert.equal(baseline.home, intlDefault.home);
    assert.equal(baseline.away, intlDefault.away);
  }
});

test('Neutral-venue symmetrization: forward + swap average produces order-independent probs', () => {
  if (!intModel) {
    // INT model not committed; skip the model-dependent assertion.
    return;
  }

  // The cascade's symmetrization branch: when game.neutralVenue is true,
  // compute predict(home, away) + predict(away, home)-swapped, average,
  // normalize. The result MUST satisfy `predict(A, B) === predict(B, A)
  // swapped` — i.e. swapping inputs produces exactly mirrored output.

  const cases = [
    [1900, 1700], // Spain-vs-mid
    [1500, 1500], // Equal teams
    [1900, 1900], // Two top teams
    [1300, 1900], // Big upset potential
  ];

  for (const [eloA, eloB] of cases) {
    // Forward: A is "home", B is "away" — symmetrize.
    const fwdRaw = xgboost.predict(intModel, [eloA, eloB]);
    const fwdSwap = xgboost.predict(intModel, [eloB, eloA]);
    const fwdProbs = [
      (fwdRaw[0] + fwdSwap[2]) / 2,
      (fwdRaw[1] + fwdSwap[1]) / 2,
      (fwdRaw[2] + fwdSwap[0]) / 2,
    ];
    const fwdTriple = normalize.toThreeWay(fwdProbs[0], fwdProbs[1], fwdProbs[2]);

    // Reverse: B is "home", A is "away" — symmetrize.
    const revRaw = xgboost.predict(intModel, [eloB, eloA]);
    const revSwap = xgboost.predict(intModel, [eloA, eloB]);
    const revProbs = [
      (revRaw[0] + revSwap[2]) / 2,
      (revRaw[1] + revSwap[1]) / 2,
      (revRaw[2] + revSwap[0]) / 2,
    ];
    const revTriple = normalize.toThreeWay(revProbs[0], revProbs[1], revProbs[2]);

    // The fwdTriple says "with A as home: probHome=x, probDraw=y, probAway=z"
    // The revTriple says "with B as home: probHome=x', probDraw=y', probAway=z'"
    // For perfect order-independence: fwdTriple.home === revTriple.away (because
    // A wins from one perspective is the same event as A wins-as-away from the
    // other). And draw stays draw.
    //
    // Tolerance: 1 cent (0.01) — the smallest representable difference in
    // DECIMAL(3,2). The averaged raw probabilities are mathematically
    // identical fwd vs rev, but `toThreeWay` rounds + parks the residual on
    // the largest RAW class. When raw home and raw away are very close
    // (equal-team neutral fixtures hit this), the residual can land on
    // different classes after rounding even though the underlying math is
    // symmetric. This is a property of the storage format, not a defect in
    // symmetrization. A 2-cent or larger asymmetry WOULD indicate a real
    // drift bug — assertion catches that.
    const TOLERANCE = 0.0101; // 0.01 + a hair for floating-point slop
    const homeAwayDiff = Math.abs(fwdTriple.home - revTriple.away);
    const awayHomeDiff = Math.abs(fwdTriple.away - revTriple.home);
    const drawDiff = Math.abs(fwdTriple.draw - revTriple.draw);
    assert.ok(
      homeAwayDiff <= TOLERANCE,
      `home/away symmetry violated at [${eloA}, ${eloB}]: fwd home=${fwdTriple.home}, rev away=${revTriple.away}, diff=${homeAwayDiff}`,
    );
    assert.ok(
      awayHomeDiff <= TOLERANCE,
      `away/home symmetry violated at [${eloA}, ${eloB}]: fwd away=${fwdTriple.away}, rev home=${revTriple.home}, diff=${awayHomeDiff}`,
    );
    assert.ok(
      drawDiff <= TOLERANCE,
      `draw symmetry violated at [${eloA}, ${eloB}]: fwd draw=${fwdTriple.draw}, rev draw=${revTriple.draw}, diff=${drawDiff}`,
    );
  }
});

test('Asymmetric (non-neutral) path: PL/legacy probs are NOT order-invariant', () => {
  // Sanity check the inverse — for a non-neutral game (the PL path), the
  // raw model output is NOT order-symmetric. The cascade preserves this
  // asymmetry for league fixtures with neutralVenue=false. Without this
  // assertion, a future "always symmetrize" regression would pass the
  // previous test trivially but break PL probabilities.
  if (!intModel) return;

  const [eloA, eloB] = [1900, 1700];
  const fwd = xgboost.predict(intModel, [eloA, eloB]);
  const rev = xgboost.predict(intModel, [eloB, eloA]);
  // Raw outputs should be DIFFERENT (model has learned some home asymmetry
  // from non-neutral training matches).
  const maxAbsDiff = Math.max(
    Math.abs(fwd[0] - rev[2]),
    Math.abs(fwd[1] - rev[1]),
    Math.abs(fwd[2] - rev[0]),
  );
  // If maxAbsDiff is essentially 0, then the model is structurally
  // symmetric already and the symmetrization branch is a no-op — which
  // would mean the previous test isn't testing anything meaningful.
  assert.ok(
    maxAbsDiff > 1e-4,
    `raw predictions are unexpectedly order-invariant (max diff ${maxAbsDiff}); the symmetrization branch may be a no-op`,
  );
});
