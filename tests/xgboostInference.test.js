'use strict';

// Tier 17 — XGBoost JS inference. Validates the tree walker against a
// hand-built toy tree (deterministic, no model file needed) and locks in
// the graceful-missing-model contract that PR B → PR C handoff depends on.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { walkTree, softmax, buildModel, loadModel, predict } = require('../lib/ml/xgboostInference');

// Toy depth-2 tree, single class. Root splits on feature[0] at 1.5;
// left subtree splits on feature[1] at 0.5; right subtree is a leaf.
//
//             node 0  (split: f0 < 1.5)
//            /        \
//        node 1        node 4 (leaf: 5.0)
//       (split: f1<0.5)
//      /         \
//   node 2     node 3
//   (leaf: 1.0) (leaf: 2.0)
const TOY_TREE = {
  left_children: [1, 2, -1, -1, -1],
  right_children: [4, 3, -1, -1, -1],
  split_indices: [0, 1, 0, 0, 0],
  split_conditions: [1.5, 0.5, 1.0, 2.0, 5.0],
  default_left: [1, 1, 0, 0, 0],
  base_weights: [0, 0, 1.0, 2.0, 5.0],
};

test('walkTree: route through left/left to leaf 2 (weight=1.0)', () => {
  // f0=1, f1=0 → root left (f0<1.5), then left (f1<0.5) → node 2.
  assert.equal(walkTree(TOY_TREE, [1, 0]), 1.0);
});

test('walkTree: route through left/right to leaf 3 (weight=2.0)', () => {
  // f0=1, f1=1 → root left, then right → node 3.
  assert.equal(walkTree(TOY_TREE, [1, 1]), 2.0);
});

test('walkTree: route through right to leaf 4 (weight=5.0)', () => {
  // f0=3 → root right → node 4.
  assert.equal(walkTree(TOY_TREE, [3, 0]), 5.0);
});

test('walkTree: NaN feature uses default_left', () => {
  // f0=NaN → root default_left=1 → left subtree. f1=NaN → default_left=1
  // → left subtree of node 1 → node 2 (weight=1.0).
  assert.equal(walkTree(TOY_TREE, [NaN, NaN]), 1.0);
});

test('walkTree: throws on malformed cyclic tree', () => {
  const bad = {
    left_children: [1, 0], // cycle: 0 → 1 → 0 → ...
    right_children: [-1, -1],
    split_indices: [0, 0],
    split_conditions: [0.5, 0.5],
    default_left: [0, 0],
    base_weights: [0, 0],
  };
  assert.throws(() => walkTree(bad, [0]), /did not reach a leaf/);
});

test('softmax: stable for large logits, sums to 1', () => {
  const out = softmax([1000, 1001, 1002]);
  assert.ok(Math.abs(out.reduce((a, b) => a + b) - 1.0) < 1e-9);
  // Largest logit → largest probability.
  assert.ok(out[2] > out[1] && out[1] > out[0]);
});

test('softmax: uniform logits → uniform probs', () => {
  const out = softmax([0, 0, 0]);
  for (const v of out) assert.ok(Math.abs(v - 1 / 3) < 1e-12);
});

test('buildModel: parses string-encoded numbers (XGBoost JSON convention)', () => {
  const json = {
    learner: {
      learner_model_param: { num_class: '3', base_score: '0' },
      gradient_booster: {
        model: {
          trees: [
            {
              left_children: ['-1'],
              right_children: ['-1'],
              split_indices: ['0'],
              split_conditions: ['0.5'],
              default_left: ['0'],
              base_weights: ['1.5'],
            },
          ],
          tree_info: ['0'],
        },
      },
    },
  };
  const model = buildModel(json, { numFeatures: 2 });
  assert.equal(model.numClass, 3);
  assert.equal(model.baseScore, 0);
  assert.equal(model.trees.length, 1);
  assert.deepEqual(model.trees[0].base_weights, [1.5]);
  assert.deepEqual(model.treeInfo, [0]);
});

test('buildModel: throws on missing learner block', () => {
  assert.throws(() => buildModel({}, { numFeatures: 2 }), /missing learner/);
});

test('buildModel: throws on missing tree array field', () => {
  const json = {
    learner: {
      learner_model_param: { num_class: '3', base_score: '0' },
      gradient_booster: {
        model: {
          trees: [{ left_children: [-1], right_children: [-1] }],
          tree_info: [0],
        },
      },
    },
  };
  assert.throws(() => buildModel(json, { numFeatures: 2 }), /missing array field/);
});

test('loadModel: returns null when file missing (graceful no-op contract)', () => {
  const out = loadModel(path.join(os.tmpdir(), 'does-not-exist-' + Date.now() + '.json'));
  assert.equal(out, null);
});

test('loadModel: throws on malformed JSON', () => {
  const tmp = path.join(os.tmpdir(), `bad-model-${Date.now()}.json`);
  fs.writeFileSync(tmp, '{ this is not json }');
  try {
    assert.throws(() => loadModel(tmp), /failed to parse/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('predict: throws when model is null', () => {
  assert.throws(() => predict(null, [1500, 1500]), /model is null/);
});

test('predict: end-to-end on hand-built 3-class model with one tree per class', () => {
  // Each class has a single tree that emits a constant — softmax of the
  // constants gives predictable probabilities. Verifies the multi-class
  // accumulation + softmax wiring without needing a trained model.
  const constTree = (weight) => ({
    left_children: [-1],
    right_children: [-1],
    split_indices: [0],
    split_conditions: [0],
    default_left: [0],
    base_weights: [weight],
  });
  const json = {
    learner: {
      learner_model_param: { num_class: '3', base_score: '0' },
      gradient_booster: {
        model: {
          trees: [constTree(1.0), constTree(0.0), constTree(2.0)],
          tree_info: [0, 1, 2], // one tree per class
        },
      },
    },
  };
  const model = buildModel(json, { numFeatures: 2 });
  const probs = predict(model, [1500, 1500]);
  assert.equal(probs.length, 3);
  // Sums to 1, and class 2 (weight 2.0) has the largest probability.
  assert.ok(Math.abs(probs.reduce((a, b) => a + b) - 1.0) < 1e-9);
  assert.ok(probs[2] > probs[0] && probs[0] > probs[1]);
});

test('buildModel: hex-encoded base_score (XGBoost 2.x emits "5E-1F") defaults to 0', () => {
  // XGBoost 2.x serializes base_score as a C99 hex-float string. JS's
  // Number() can't parse that and returns NaN. Pre-fix this poisoned every
  // logit and produced [NaN, NaN, NaN] out of softmax. parseBaseScore now
  // falls back to 0 when Number() fails, which is correct for
  // multi:softprob since base_score broadcasts equally and cancels under
  // softmax. Caught live in prod during Tier 17 PR C verification.
  const constTree = (w) => ({
    left_children: [-1],
    right_children: [-1],
    split_indices: [0],
    split_conditions: [0],
    default_left: [0],
    base_weights: [w],
  });
  const json = {
    learner: {
      learner_model_param: { num_class: '3', base_score: '5E-1F' },
      gradient_booster: {
        model: {
          trees: [constTree(1.0), constTree(0.0), constTree(2.0)],
          tree_info: [0, 1, 2],
        },
      },
    },
  };
  const model = buildModel(json, { numFeatures: 2 });
  assert.equal(model.baseScore, 0);
  const probs = predict(model, [1500, 1500]);
  // Sum to 1, all finite, ordering preserved (class 2 weight=2.0 wins).
  assert.ok(probs.every(Number.isFinite));
  assert.ok(Math.abs(probs.reduce((a, b) => a + b) - 1.0) < 1e-9);
  assert.ok(probs[2] > probs[0] && probs[0] > probs[1]);
});

test('predict: throws loud if logits go non-finite (defensive NaN guard)', () => {
  // A tree with a NaN leaf weight produces NaN logits → NaN probs. Pre-fix
  // these silently propagated to normalize.toThreeWay where the error
  // message was less actionable. The guard now surfaces the root cause
  // (logits + baseScore) in the message.
  const nanTree = {
    left_children: [-1],
    right_children: [-1],
    split_indices: [0],
    split_conditions: [0],
    default_left: [0],
    base_weights: [NaN],
  };
  const json = {
    learner: {
      learner_model_param: { num_class: '1', base_score: '0' },
      gradient_booster: { model: { trees: [nanTree], tree_info: [0] } },
    },
  };
  const model = buildModel(json, { numFeatures: 2 });
  assert.throws(() => predict(model, [1500, 1500]), /non-finite probabilities/);
});

test('predict: throws on feature-length mismatch', () => {
  const model = buildModel(
    {
      learner: {
        learner_model_param: { num_class: '1', base_score: '0' },
        gradient_booster: {
          model: {
            trees: [
              {
                left_children: [-1],
                right_children: [-1],
                split_indices: [0],
                split_conditions: [0],
                default_left: [0],
                base_weights: [0],
              },
            ],
            tree_info: [0],
          },
        },
      },
    },
    { numFeatures: 2 },
  );
  assert.throws(() => predict(model, [1500]), /feature length 1.*model.numFeatures 2/);
});
