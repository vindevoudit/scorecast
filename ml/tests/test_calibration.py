"""Smoke tests for the isotonic calibration step (Phase 2).

Calibration fits per-class IsotonicRegression on the raw val probabilities
and applies them inside `ModelBundle.predict_proba`. These tests don't
verify that calibration IMPROVES log-loss (that requires real data and
varies); they verify the invariants:

- Calibrated probabilities are valid (in [0, 1], sum-to-1 per row).
- A bundle without calibrators behaves identically to before.
- predict_proba_raw bypasses calibration.
- IsotonicRegression with monotone-increasing val data round-trips
  approximately to the input.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import xgboost as xgb

from scorecast_ml.features.build import FEATURE_NAMES
from scorecast_ml.train.model import ModelBundle, fit_calibrators


def _toy_bundle() -> ModelBundle:
    """Train a tiny XGBoost on synthetic 3-class data so we have a real
    Booster to wrap. The model's quality doesn't matter — we're testing
    the calibration plumbing, not its effectiveness."""
    rng = np.random.default_rng(42)
    n = 600
    X = pd.DataFrame(
        rng.standard_normal((n, len(FEATURE_NAMES))), columns=FEATURE_NAMES
    )
    # Easy 3-class target: argmax of a linear projection. Gives the
    # Booster something learnable in a few rounds.
    logits = X.values @ rng.standard_normal((len(FEATURE_NAMES), 3))
    y = pd.Series(logits.argmax(axis=1), name="label")

    dtrain = xgb.DMatrix(X.values, label=y.values, feature_names=FEATURE_NAMES)
    booster = xgb.train(
        {
            "objective": "multi:softprob",
            "num_class": 3,
            "max_depth": 3,
            "eval_metric": "mlogloss",
            "seed": 42,
            "verbosity": 0,
        },
        dtrain,
        num_boost_round=20,
    )
    return ModelBundle(
        model=booster,
        feature_names=FEATURE_NAMES,
        trained_at="2026-01-01T00:00:00Z",
        data_through_date="2026-01-01",
        league_code="TEST",
    )


def _toy_val_split() -> tuple[pd.DataFrame, pd.Series]:
    rng = np.random.default_rng(7)
    n = 200
    X = pd.DataFrame(
        rng.standard_normal((n, len(FEATURE_NAMES))), columns=FEATURE_NAMES
    )
    logits = X.values @ rng.standard_normal((len(FEATURE_NAMES), 3))
    y = pd.Series(logits.argmax(axis=1), name="label")
    return X, y


def test_uncalibrated_bundle_returns_raw_probabilities():
    bundle = _toy_bundle()
    X_val, _ = _toy_val_split()
    raw = bundle.predict_proba_raw(X_val)
    via_predict_proba = bundle.predict_proba(X_val)
    np.testing.assert_array_equal(raw, via_predict_proba)


def test_fit_calibrators_attaches_three():
    bundle = _toy_bundle()
    X_val, y_val = _toy_val_split()
    fit_calibrators(bundle, X_val, y_val)
    assert bundle.calibrators is not None
    assert len(bundle.calibrators) == 3


def test_calibrated_probabilities_sum_to_one():
    bundle = _toy_bundle()
    X_val, y_val = _toy_val_split()
    fit_calibrators(bundle, X_val, y_val)
    proba = bundle.predict_proba(X_val)
    row_sums = proba.sum(axis=1)
    # Tolerance accounts for renormalize divide rounding.
    np.testing.assert_allclose(row_sums, 1.0, atol=1e-9)


def test_calibrated_probabilities_in_unit_interval():
    bundle = _toy_bundle()
    X_val, y_val = _toy_val_split()
    fit_calibrators(bundle, X_val, y_val)
    proba = bundle.predict_proba(X_val)
    assert proba.min() >= 0.0
    assert proba.max() <= 1.0


def test_predict_proba_raw_bypasses_calibration():
    bundle = _toy_bundle()
    X_val, y_val = _toy_val_split()
    raw_before = bundle.predict_proba_raw(X_val).copy()
    fit_calibrators(bundle, X_val, y_val)
    raw_after = bundle.predict_proba_raw(X_val)
    # Fitting calibrators must not mutate the underlying model.
    np.testing.assert_array_equal(raw_before, raw_after)


def test_legacy_bundle_without_calibrators_field_still_works():
    """Old pickled bundles (pre-Phase-2) won't have a `calibrators`
    attribute. The `getattr(self, 'calibrators', None)` fallback inside
    predict_proba must handle that gracefully."""
    bundle = _toy_bundle()
    X_val, _ = _toy_val_split()
    # Simulate the legacy bundle by deleting the attribute entirely.
    del bundle.__dict__["calibrators"]
    assert "calibrators" not in bundle.__dict__
    # Should NOT raise — predict_proba uses getattr-with-default.
    proba = bundle.predict_proba(X_val)
    assert proba.shape == (200, 3)


def test_calibrator_preserves_or_improves_calibration_on_perfectly_calibrated_input():
    """Sanity check on the isotonic step itself: if we feed in a fake set
    of probabilities that are ALREADY perfectly calibrated (the predicted
    probability of class k for a row equals the true class-k rate for
    rows with that predicted probability), the isotonic fit should be
    approximately identity on each class."""
    from sklearn.isotonic import IsotonicRegression

    rng = np.random.default_rng(3)
    n = 1000
    # Perfectly calibrated synthetic: class-0 probability is the
    # underlying true rate, used to sample the actual label.
    raw_p_class_0 = rng.uniform(0, 1, n)
    actual_class_0 = (rng.uniform(0, 1, n) < raw_p_class_0).astype(int)

    cal = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip")
    cal.fit(raw_p_class_0, actual_class_0)

    # The fitted curve should be approximately f(p) = p, modulo noise.
    test_points = np.linspace(0.05, 0.95, 19)
    fitted = cal.predict(test_points)
    # Allow 0.15 absolute deviation — isotonic on 1000 samples per class
    # is noisy but should be in the neighborhood of the identity.
    np.testing.assert_allclose(fitted, test_points, atol=0.15)


def test_fit_calibrators_with_missing_class_does_not_explode():
    """If val happens to contain zero of one class, the calibrator for
    that class fits against an all-zero target. IsotonicRegression
    handles this gracefully (the fitted function is constant 0)."""
    bundle = _toy_bundle()
    X_val, y_val = _toy_val_split()
    # Force all labels to class 0 — class 1 and 2 will have no positives.
    y_val_skewed = pd.Series(np.zeros(len(y_val), dtype=int), name="label")
    fit_calibrators(bundle, X_val, y_val_skewed)
    proba = bundle.predict_proba(X_val)
    # After renormalization, every row should still sum to 1.
    np.testing.assert_allclose(proba.sum(axis=1), 1.0, atol=1e-9)
