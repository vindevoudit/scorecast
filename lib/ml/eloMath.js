'use strict';

// Tier 17 — pure incremental Elo. Mirrors ml/scorecast_ml/elo/engine.py
// exactly so the seeder's bootstrap (history walk) and PredictionService's
// runtime cascade (per-result update) share the same math. Drift here
// would cause Python-trained probabilities to disagree with JS-inferred
// ones over time; tests/eloMath.parity.test.js locks parity by feeding a
// fixed match vector through both implementations and asserting identical
// outputs.
//
// Config constants are exported so callers can sanity-check assumptions
// rather than passing them around.

const K_FACTOR = 20;
const INITIAL_RATING = 1500;
const HFA = 0; // home-field advantage; structurally a no-op for the tree
//                model — see ml/scorecast_ml/elo/engine.py EloConfig note.

// Home team's expected score (win probability if treating draw as 0.5)
// under the standard Elo logistic. HFA is added to the home rating ONLY
// during this calculation — never persisted on the team's rating itself,
// so it doesn't travel to away games. The optional `hfaOverride` arg
// (international model support) lets a per-match neutral-venue flag set
// HFA=0 just for that match — used by eloDelta when called with
// `{ neutral: true }`. When omitted, behavior is bit-identical to
// pre-international-model callers.
function expectedHomeScore(homeElo, awayElo, hfaOverride) {
  const hfa = hfaOverride === undefined ? HFA : hfaOverride;
  return 1 / (1 + Math.pow(10, (awayElo - (homeElo + hfa)) / 400));
}

// Result code → (home_actual, away_actual) pair. The pair always sums to 1.
function actualScores(result) {
  if (result === 'home') return [1.0, 0.0];
  if (result === 'away') return [0.0, 1.0];
  if (result === 'draw') return [0.5, 0.5];
  throw new Error(`actualScores: expected home|away|draw, got ${JSON.stringify(result)}`);
}

// Per-match incremental update. Returns the new Elo pair (does NOT mutate
// inputs). PredictionService.onResultUpdated drives this inside the
// transaction that's committing the result. The international model adds
// optional `opts.kMultiplier` (per-tournament tier weight; default 1.0)
// and `opts.neutral` (skip HFA bonus; default false). Bit-identical to
// the pre-opts callsite when both are absent.
function updateElos(homeElo, awayElo, result, opts) {
  const kMultiplier = (opts && opts.kMultiplier) || 1;
  const neutral = !!(opts && opts.neutral);
  const expHome = expectedHomeScore(homeElo, awayElo, neutral ? 0 : undefined);
  const expAway = 1 - expHome;
  const [actHome, actAway] = actualScores(result);
  const k = K_FACTOR * kMultiplier;
  return {
    newHomeElo: homeElo + k * (actHome - expHome),
    newAwayElo: awayElo + k * (actAway - expAway),
  };
}

// Tier 17 PR F — pure delta function. Returns the per-team Elo deltas
// from a single match without applying them to a base rating. Lets
// PredictionService reverse a prior delta against a stored snapshot when
// a result is changed, then apply the new delta — all against the same
// pre-match Elo pair. By symmetry of the Elo formula, the home delta is
// always the negative of the away delta (zero-sum invariant).
//
// International model: optional `opts.kMultiplier` (default 1.0) scales
// the magnitude (FIFA-style tier weight); `opts.neutral` (default false)
// drops HFA for the match (relevant when HFA constant ever becomes
// non-zero — today HFA=0 so neutral is structurally a no-op for the
// magnitude but still correct semantically). When opts is omitted, the
// function returns the same value the pre-opts signature returned —
// locked by tests/eloMath.test.js defaults-bit-identical assertions.
function eloDelta(homeElo, awayElo, result, opts) {
  const kMultiplier = (opts && opts.kMultiplier) || 1;
  const neutral = !!(opts && opts.neutral);
  const expHome = expectedHomeScore(homeElo, awayElo, neutral ? 0 : undefined);
  const expAway = 1 - expHome;
  const [actHome, actAway] = actualScores(result);
  const k = K_FACTOR * kMultiplier;
  return {
    home: k * (actHome - expHome),
    away: k * (actAway - expAway),
  };
}

module.exports = {
  K_FACTOR,
  INITIAL_RATING,
  HFA,
  expectedHomeScore,
  actualScores,
  updateElos,
  eloDelta,
};
