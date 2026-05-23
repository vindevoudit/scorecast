'use strict';

// Tier 17 — JS-native XGBoost inference. Pure tree walker over the
// `bst.save_model('foo.json')` native dump format. Zero dependencies; the
// tree-walk math is depth-4 × num_round trees per class, microseconds per
// inference for our 2-feature elo-only model.
//
// JSON schema parsed (XGBoost 1.6+ native dump):
//   {
//     learner: {
//       learner_model_param: { num_class: "3", base_score: "...", ... },
//       gradient_booster: {
//         model: {
//           trees: [
//             {
//               tree_param: { num_nodes: "N" },
//               left_children:    [int...],   // -1 => leaf
//               right_children:   [int...],
//               split_indices:    [int...],   // feature index at split node
//               split_conditions: [float...], // threshold (or leaf weight)
//               default_left:     [0|1...],   // direction for NaN inputs
//               base_weights:     [float...]  // leaf output
//             }, ...
//           ],
//           tree_info: [int...]               // class index per tree
//         }
//       }
//     }
//   }
//
// For multi:softprob the dump emits NUM_BOOST_ROUNDS × NUM_CLASS trees;
// `tree_info[t]` says which class tree t belongs to. Sum each class's tree
// outputs, add base_score uniformly (softmax-invariant), softmax → probs.
//
// Graceful missing model: loadModel(path) returns null when the file isn't
// present. The cascade calls predict(null, …) → throw, and PredictionService
// catches the throw + logs a warn so a missing model never crashes a
// result-capture transaction. This lets PR B ship the inference code BEFORE
// the trained PL_elo.json is committed.

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

// Walk a single tree to a leaf. Returns the leaf's base_weight (== its
// `split_conditions` value in some XGBoost dumps; they're equal at leaves
// in the multi:softprob format we use).
function walkTree(tree, features) {
  let i = 0;
  const left = tree.left_children;
  const right = tree.right_children;
  const splitIdx = tree.split_indices;
  const splitVal = tree.split_conditions;
  const defaultLeft = tree.default_left;
  const baseWeights = tree.base_weights;
  // Safety bound: a malformed tree (cyclic children pointers) could spin
  // forever. Cap at num_nodes iterations.
  const numNodes = left.length;
  for (let steps = 0; steps < numNodes; steps += 1) {
    if (left[i] === -1) return baseWeights[i];
    const f = features[splitIdx[i]];
    let goLeft;
    if (Number.isNaN(f)) {
      goLeft = defaultLeft[i] === 1;
    } else {
      goLeft = f < splitVal[i];
    }
    i = goLeft ? left[i] : right[i];
  }
  throw new Error('walkTree: did not reach a leaf within num_nodes steps (malformed tree?)');
}

// Numerically-stable softmax. Subtracts max(logits) before exp() so large
// scores don't overflow Number.MAX_VALUE.
function softmax(logits) {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  const exps = new Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i += 1) {
    const e = Math.exp(logits[i] - max);
    exps[i] = e;
    sum += e;
  }
  for (let i = 0; i < exps.length; i += 1) exps[i] /= sum;
  return exps;
}

function predict(model, features) {
  if (!model) {
    throw new Error('predict: model is null — call loadModel() first or check return value');
  }
  if (!Array.isArray(features)) {
    throw new Error('predict: features must be an array');
  }
  if (features.length !== model.numFeatures) {
    throw new Error(
      `predict: feature length ${features.length} doesn't match model.numFeatures ${model.numFeatures}`,
    );
  }
  const logits = new Array(model.numClass).fill(0);
  const { trees, treeInfo } = model;
  for (let t = 0; t < trees.length; t += 1) {
    logits[treeInfo[t]] += walkTree(trees[t], features);
  }
  // base_score is broadcast identically to every class, so it's a no-op
  // for softmax — but we still add it to keep parity with Python's
  // bundle.predict(raw_logits + base_score).
  for (let c = 0; c < logits.length; c += 1) logits[c] += model.baseScore;
  const probs = softmax(logits);
  // Defensive: surface a NaN/Infinity escape as a loud throw rather than
  // letting it propagate to normalize.toThreeWay (which throws with a
  // less actionable message). Caught the XGBoost 2.x hex-encoded
  // base_score parse bug live in prod (Tier 17 PR C smoke).
  if (!probs.every(Number.isFinite)) {
    throw new Error(
      `predict: non-finite probabilities ${JSON.stringify(probs)} from logits ${JSON.stringify(logits)} (baseScore=${model.baseScore})`,
    );
  }
  return probs;
}

// Parse a possibly-string number (XGBoost JSON serializes some ints/floats
// as strings). Defensive against schema drift across XGBoost versions.
function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  throw new Error(`num: unexpected value ${JSON.stringify(v)}`);
}

// XGBoost 2.x emits `learner_model_param.base_score` as a hex-encoded
// float string (e.g. "5E-1F" for 0.5 — C99 %a format). JS's Number()
// can't parse that, so the live cascade was getting baseScore=NaN, which
// poisoned every logit and produced [NaN, NaN, NaN] out of softmax.
//
// For multi:softprob (our case), base_score is broadcast identically to
// every class and therefore cancels under softmax — safe to default to 0
// when parsing fails. For binary:logistic this would matter; if we ever
// train one, swap this for a proper hex-float parser.
function parseBaseScore(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

// Normalize an XGBoost native JSON dump into a flat shape ready for
// prediction. We intentionally re-shape rather than walk the nested
// learner/gradient_booster/model path every inference.
function buildModel(json, { numFeatures }) {
  if (!json || !json.learner) {
    throw new Error('buildModel: JSON missing learner block (not an XGBoost native dump?)');
  }
  const lp = json.learner.learner_model_param || {};
  const numClass = num(lp.num_class || '1') || 1;
  const baseScore = parseBaseScore(lp.base_score ?? '0');
  const gbModel = json.learner.gradient_booster && json.learner.gradient_booster.model;
  if (!gbModel || !Array.isArray(gbModel.trees) || !Array.isArray(gbModel.tree_info)) {
    throw new Error('buildModel: missing gradient_booster.model.trees / tree_info');
  }
  const trees = gbModel.trees.map((t, idx) => {
    const required = [
      'left_children',
      'right_children',
      'split_indices',
      'split_conditions',
      'default_left',
      'base_weights',
    ];
    for (const k of required) {
      if (!Array.isArray(t[k])) {
        throw new Error(`buildModel: tree ${idx} missing array field ${k}`);
      }
    }
    return {
      left_children: t.left_children.map((x) => num(x)),
      right_children: t.right_children.map((x) => num(x)),
      split_indices: t.split_indices.map((x) => num(x)),
      split_conditions: t.split_conditions.map((x) => num(x)),
      default_left: t.default_left.map((x) => num(x)),
      base_weights: t.base_weights.map((x) => num(x)),
    };
  });
  const treeInfo = gbModel.tree_info.map((x) => num(x));
  if (treeInfo.length !== trees.length) {
    throw new Error(
      `buildModel: tree_info length ${treeInfo.length} ≠ trees length ${trees.length}`,
    );
  }
  return { numClass, baseScore, trees, treeInfo, numFeatures };
}

// Load a model from disk. Returns null when the file is missing so the
// runtime can gracefully no-op the cascade until the trained model is
// committed (load-bearing for PR B → PR C handoff). Loud-throws on
// schema errors so a malformed model never silently produces nonsense.
function loadModel(modelPath, { numFeatures = 2 } = {}) {
  const abs = path.isAbsolute(modelPath) ? modelPath : path.resolve(modelPath);
  if (!fs.existsSync(abs)) {
    logger.warn(
      { modelPath: abs },
      'xgboostInference.loadModel: model file missing — predict() will throw if called. PredictionService cascade should null-check before predicting.',
    );
    return null;
  }
  let json;
  try {
    json = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new Error(`loadModel: failed to parse ${abs}: ${err.message}`);
  }
  return buildModel(json, { numFeatures });
}

module.exports = {
  walkTree,
  softmax,
  buildModel,
  loadModel,
  predict,
};
