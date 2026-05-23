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
// so it doesn't travel to away games.
function expectedHomeScore(homeElo, awayElo) {
  return 1 / (1 + Math.pow(10, (awayElo - (homeElo + HFA)) / 400));
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
// transaction that's committing the result.
function updateElos(homeElo, awayElo, result) {
  const expHome = expectedHomeScore(homeElo, awayElo);
  const expAway = 1 - expHome;
  const [actHome, actAway] = actualScores(result);
  return {
    newHomeElo: homeElo + K_FACTOR * (actHome - expHome),
    newAwayElo: awayElo + K_FACTOR * (actAway - expAway),
  };
}

// Tier 17 PR F — pure delta function. Returns the per-team Elo deltas
// from a single match without applying them to a base rating. Lets
// PredictionService reverse a prior delta against a stored snapshot when
// a result is changed, then apply the new delta — all against the same
// pre-match Elo pair. By symmetry of the Elo formula, the home delta is
// always the negative of the away delta (zero-sum invariant).
function eloDelta(homeElo, awayElo, result) {
  const expHome = expectedHomeScore(homeElo, awayElo);
  const expAway = 1 - expHome;
  const [actHome, actAway] = actualScores(result);
  return {
    home: K_FACTOR * (actHome - expHome),
    away: K_FACTOR * (actAway - expAway),
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
