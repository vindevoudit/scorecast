'use strict';

// Cross-runtime parity test for the international Elo seeder. Runs a tiny
// fixture through BOTH the JS seeder math (via the internal helpers) AND
// the Python engine (via a recorded reference value). Same fixture, same
// K-mults, same neutral flags → bit-identical final Elo. Drift here is
// the load-bearing failure mode — without parity, the seeder's bootstrap
// state disagrees with PredictionService's runtime cascade and
// probabilities silently shift over time.
//
// The reference Python-side values are reproducible via:
//   cd ml && .venv/Scripts/python -c "
//   import pandas as pd
//   from scorecast_ml.elo.engine import EloConfig, batch_compute
//   df = pd.DataFrame([
//     {'date': pd.Timestamp('2018-07-15', tz='UTC'),
//      'home': 'France', 'away': 'Croatia', 'ftr': 'H',
//      'k_mult': 3.0, 'neutral': True},
//     {'date': pd.Timestamp('2024-03-22', tz='UTC'),
//      'home': 'Argentina', 'away': 'Brazil', 'ftr': 'D',
//      'k_mult': 1.0, 'neutral': False},
//     {'date': pd.Timestamp('2024-07-14', tz='UTC'),
//      'home': 'Argentina', 'away': 'Colombia', 'ftr': 'H',
//      'k_mult': 2.5, 'neutral': True},
//   ])
//   cfg = EloConfig(promoted_team_strategy='initial',
//                   k_multiplier_column='k_mult', neutral_column='neutral')
//   _, state = batch_compute(df, cfg)
//   for k, v in sorted(state.items()):
//       print(f'{k!r}: {v.rating}')
//   "

const { test } = require('node:test');
const assert = require('node:assert/strict');
const eloMath = require('../lib/ml/eloMath');

// The K-mult table mirrored in the seeder. Test isolates the math: we
// pre-compute the table inline rather than rely on the seeder's module
// load (which expects reconcileMap.json + an archive directory).
function applyMatch(state, home, away, ftr, kMultiplier, neutral) {
  if (!state.has(home)) state.set(home, 1500);
  if (!state.has(away)) state.set(away, 1500);
  const h = state.get(home);
  const a = state.get(away);
  const result = ftr === 'H' ? 'home' : ftr === 'A' ? 'away' : 'draw';
  const delta = eloMath.eloDelta(h, a, result, { kMultiplier, neutral });
  state.set(home, h + delta.home);
  state.set(away, a + delta.away);
}

test('seeder Elo math parity with Python batch_compute over 3-row INT fixture', () => {
  const state = new Map();
  // Row 1: 2018 WC final-like — France beats Croatia, K=3, neutral.
  applyMatch(state, 'France', 'Croatia', 'H', 3.0, true);
  // Row 2: Friendly draw between Argentina + Brazil, K=1, non-neutral.
  applyMatch(state, 'Argentina', 'Brazil', 'D', 1.0, false);
  // Row 3: Continental final — Argentina beats Colombia, K=2.5, neutral.
  applyMatch(state, 'Argentina', 'Colombia', 'H', 2.5, true);

  // Reference values from the Python engine (computed via the snippet
  // in this file's header). Bit-identical because both engines use
  // HFA=0 today and the same Elo logistic.
  const expected = {
    France: 1530.0,
    Croatia: 1470.0,
    Argentina: 1525.0, // 1500 + 0 (draw vs Brazil) + 25 (win vs Colombia at K=2.5 vs 1500)
    Brazil: 1500.0, // draw vs equal team → no change
    Colombia: 1475.0,
  };

  for (const [team, expectedRating] of Object.entries(expected)) {
    const actual = state.get(team);
    assert.ok(
      actual !== undefined,
      `team ${team} missing from state (have: ${[...state.keys()].join(', ')})`,
    );
    assert.ok(
      Math.abs(actual - expectedRating) < 1e-6,
      `${team}: JS produced ${actual}, expected ${expectedRating} (drift ${Math.abs(actual - expectedRating)})`,
    );
  }
});

test('seeder zero-sum invariant across mixed K-mult fixture', () => {
  const state = new Map();
  applyMatch(state, 'France', 'Croatia', 'H', 3.0, true);
  applyMatch(state, 'Argentina', 'Brazil', 'D', 1.0, false);
  applyMatch(state, 'Argentina', 'Colombia', 'H', 2.5, true);
  applyMatch(state, 'Spain', 'Germany', 'A', 2.5, false);
  let total = 0;
  for (const r of state.values()) total += r - 1500;
  assert.ok(Math.abs(total) < 1e-6, `total drift ${total} violates zero-sum`);
});
