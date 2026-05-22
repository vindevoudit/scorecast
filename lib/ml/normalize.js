'use strict';

// Tier 17 — JS port of ml/scorecast_ml/inference/normalize.py to_three_way.
// Takes the raw (P_home, P_draw, P_away) tuple from the XGBoost tree walker
// and turns it into the (homeProbability, drawProbability, awayProbability)
// DECIMAL(3,2) trio that lands in the games table.
//
// Pipeline:
//  1. Validate range + sum (allow ≤5% drift from a calibrator that doesn't
//     exactly sum to 1; silently renormalize).
//  2. Clip each class to [0.01, 0.99] — DECIMAL(3,2) precision means
//     anything below 0.005 rounds to 0.00, which would emit "literal 0%"
//     probability writes (caught real Arsenal-vs-Burnley 1.00/0.00/0.00
//     outputs in the Python pipeline before the clip was added).
//  3. Round each class to 2 decimals.
//  4. Absorb the rounding residual (1.00 − sum) into the class with the
//     largest RAW probability, NOT the largest rounded value. Three close
//     classes often tie after rounding; using the raw input preserves the
//     model's implied ordering through ties.
//  5. Nudge off the (0.50, 0.00, 0.50) sentinel — that's the "untouched
//     by anyone" tuple a fresh game has after the draw-scoring migration.
//     If we emitted it, the runtime cascade's skip-existing logic would
//     treat the ML-written value as untouched on the next pass.
//
// Test parity: ml/tests/test_normalize.py already locks down the Python
// invariants (sum-to-1, clip, residual absorption); tests for the JS port
// mirror them.

const EPS = 1e-9;
const TRIPLE_SENTINEL = [0.5, 0.0, 0.5];
const CLIP_MIN = 0.01;
const CLIP_MAX = 0.99;

function clip(x, lo, hi) {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function round2(x) {
  // Math.round on (x * 100) / 100. Use Number.EPSILON-style tiebreak via
  // adding a tiny offset so 0.005 → 0.01 instead of 0.00 (Banker's rounding
  // would land on 0.00). Matches Python's `round()` for our value range.
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function isTripleSentinel(h, d, a) {
  return h === TRIPLE_SENTINEL[0] && d === TRIPLE_SENTINEL[1] && a === TRIPLE_SENTINEL[2];
}

// Round + rebalance — the residual lands on the largest-RAW class so
// ordering survives the rounding step even when two classes tie after
// rounding. `raw` is the pre-clip / pre-round triple used for the
// "largest RAW" decision.
function roundAndRebalanceTriple(raw) {
  const h = round2(raw.home);
  const d = round2(raw.draw);
  const a = round2(raw.away);
  const diff = round2(1.0 - (h + d + a));
  if (diff === 0) return { home: h, draw: d, away: a };
  // Pick the destination class by RAW magnitude (not rounded), with the
  // home > draw > away tiebreak order matching the Python.
  if (raw.home >= raw.draw && raw.home >= raw.away) {
    return { home: round2(h + diff), draw: d, away: a };
  }
  if (raw.away >= raw.draw) {
    return { home: h, draw: d, away: round2(a + diff) };
  }
  return { home: h, draw: round2(d + diff), away: a };
}

// Nudge off the (0.50, 0.00, 0.50) sentinel. Direction comes from the raw
// pre-rounding tuple (home-favored if raw.home ≥ raw.away). Tiny shift
// (0.01) just to step off the sentinel value — the model output's actual
// confidence is preserved everywhere else.
function nudgeOffTripleSentinel(triple, rawTriple) {
  if (!isTripleSentinel(triple.home, triple.draw, triple.away)) return triple;
  const nudgeHome = rawTriple ? rawTriple.home >= rawTriple.away : true;
  return nudgeHome ? { home: 0.51, draw: 0.0, away: 0.49 } : { home: 0.49, draw: 0.0, away: 0.51 };
}

// End-to-end: validate → renormalize-if-drifted → clip → round-and-rebalance
// → nudge-off-sentinel. Returns the final trio summing to exactly 1.00 at
// DECIMAL(3,2) precision. Throws on out-of-range inputs (the only failure
// mode that should ever reach this function is a broken model file —
// callers should let it propagate rather than swallow).
function toThreeWay(pH, pD, pA) {
  const inRange = (x) => -EPS <= x && x <= 1 + EPS;
  if (!inRange(pH) || !inRange(pD) || !inRange(pA)) {
    throw new Error(`toThreeWay: probabilities out of [0, 1]: (${pH}, ${pD}, ${pA})`);
  }
  const total = pH + pD + pA;
  if (Math.abs(total - 1.0) > 0.05) {
    throw new Error(
      `toThreeWay: probabilities don't sum to ~1.0: total=${total.toFixed(4)} (${pH} + ${pD} + ${pA})`,
    );
  }
  let h = pH;
  let d = pD;
  let a = pA;
  if (Math.abs(total - 1.0) > 1e-6) {
    h /= total;
    d /= total;
    a /= total;
  }
  // Clip BEFORE rounding so isotonic-edge values (raw 0.001) don't round
  // to literal 0.00 in the DB. Renormalize after the clip so the post-clip
  // trio sums to 1 going into the rounder.
  h = clip(h, CLIP_MIN, CLIP_MAX);
  d = clip(d, CLIP_MIN, CLIP_MAX);
  a = clip(a, CLIP_MIN, CLIP_MAX);
  const postClipTotal = h + d + a;
  h /= postClipTotal;
  d /= postClipTotal;
  a /= postClipTotal;

  const raw = { home: h, draw: d, away: a };
  const rounded = roundAndRebalanceTriple(raw);
  return nudgeOffTripleSentinel(rounded, raw);
}

module.exports = {
  CLIP_MIN,
  CLIP_MAX,
  TRIPLE_SENTINEL,
  clip,
  round2,
  roundAndRebalanceTriple,
  nudgeOffTripleSentinel,
  toThreeWay,
};
