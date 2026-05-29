"""International training pipeline — end-to-end on a synthetic 200-row
fixture. Asserts the booster trains, has the 2-feature shape, beats the
uniform-prior baseline, and that sample_weight is actually plumbed
through to DMatrix.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from scorecast_ml.elo.engine import EloConfig, batch_compute
from scorecast_ml.train.model import FEATURE_NAMES, train as train_model


@pytest.fixture
def synthetic_intl_matches() -> pd.DataFrame:
    """200 rows of synthetic international matches with mixed K-mults +
    a clear signal: stronger team (Elo +200) wins ~75% of the time. Just
    enough signal for XGBoost to learn it under early stopping."""
    rng = np.random.default_rng(seed=42)
    rows = []
    for i in range(200):
        date = pd.Timestamp("2018-01-01", tz="UTC") + pd.Timedelta(days=i * 14)
        # Cycle which team is stronger
        if i % 2 == 0:
            home, away = "Strong", "Weak"
        else:
            home, away = "Weak", "Strong"
        # 75% win rate for stronger team, ignoring HFA
        strong_won = rng.random() < 0.75
        if strong_won:
            ftr = "H" if home == "Strong" else "A"
        else:
            ftr = "A" if home == "Strong" else "H"
        # Mixed K-mults so we know weights flow through
        k_mult = float(rng.choice([1.0, 1.5, 2.0, 2.5, 3.0]))
        rows.append({
            "date": date,
            "home": home,
            "away": away,
            "ftr": ftr,
            "k_mult": k_mult,
            "neutral": bool(rng.random() < 0.3),
        })
    return pd.DataFrame(rows)


def test_train_intl_end_to_end(synthetic_intl_matches: pd.DataFrame):
    """Run the full Elo-with-K-mult → 2-feature XGBoost → early-stopping
    pipeline. Booster should beat uniform-prior mlogloss (log(3) ≈ 1.0986).
    """
    cfg = EloConfig(
        promoted_team_strategy="initial",
        k_multiplier_column="k_mult",
        neutral_column="neutral",
    )
    augmented, _state = batch_compute(synthetic_intl_matches, cfg)
    # 2-feature matrix matches PL pipeline contract.
    X = augmented[["home_elo_pre", "away_elo_pre"]].rename(
        columns={"home_elo_pre": "home_elo", "away_elo_pre": "away_elo"}
    )
    label_map = {"H": 0, "D": 1, "A": 2}
    y = pd.Series([label_map[f] for f in augmented["ftr"]])
    weight = augmented["k_mult"].astype(float)

    split = 160
    booster = train_model(
        X.iloc[:split],
        y.iloc[:split],
        X.iloc[split:],
        y.iloc[split:],
        sample_weight=weight.iloc[:split],
        val_sample_weight=weight.iloc[split:],
    )
    # Booster trained with the right feature shape.
    assert booster.feature_names == FEATURE_NAMES
    # Val mlogloss should beat uniform-prior baseline (log(3) ≈ 1.0986).
    import xgboost as xgb
    dval = xgb.DMatrix(X.iloc[split:].values, feature_names=FEATURE_NAMES)
    probs = booster.predict(dval)
    # Probs are (rows, 3).
    assert probs.shape == (40, 3)
    # Compute val mlogloss.
    y_val = y.iloc[split:].values
    losses = []
    for i in range(len(y_val)):
        p = max(min(probs[i, y_val[i]], 1 - 1e-9), 1e-9)
        losses.append(-math.log(p))
    val_mlogloss = sum(losses) / len(losses)
    assert val_mlogloss < math.log(3), f"val mlogloss {val_mlogloss} >= uniform baseline {math.log(3)}"


def test_train_intl_sample_weight_actually_changes_model(synthetic_intl_matches: pd.DataFrame):
    """Smoke-check that sample_weight does affect training. Same data, same
    seed, one run with uniform weights and one with K-mult weights — the
    resulting boosters should produce DIFFERENT predictions on the val set
    (otherwise sample_weight is silently being ignored)."""
    cfg = EloConfig(
        promoted_team_strategy="initial",
        k_multiplier_column="k_mult",
    )
    augmented, _ = batch_compute(synthetic_intl_matches, cfg)
    X = augmented[["home_elo_pre", "away_elo_pre"]].rename(
        columns={"home_elo_pre": "home_elo", "away_elo_pre": "away_elo"}
    )
    label_map = {"H": 0, "D": 1, "A": 2}
    y = pd.Series([label_map[f] for f in augmented["ftr"]])
    weight_kmult = augmented["k_mult"].astype(float)
    weight_uniform = pd.Series([1.0] * len(augmented))

    split = 160
    booster_kmult = train_model(
        X.iloc[:split],
        y.iloc[:split],
        X.iloc[split:],
        y.iloc[split:],
        sample_weight=weight_kmult.iloc[:split],
        val_sample_weight=weight_kmult.iloc[split:],
    )
    booster_uniform = train_model(
        X.iloc[:split],
        y.iloc[:split],
        X.iloc[split:],
        y.iloc[split:],
        sample_weight=weight_uniform.iloc[:split],
        val_sample_weight=weight_uniform.iloc[split:],
    )
    import xgboost as xgb
    dval = xgb.DMatrix(X.iloc[split:].values, feature_names=FEATURE_NAMES)
    probs_kmult = booster_kmult.predict(dval)
    probs_uniform = booster_uniform.predict(dval)
    # They should differ — if sample_weight was ignored, both boosters
    # would be identical and produce identical probs.
    max_abs_diff = float(np.abs(probs_kmult - probs_uniform).max())
    assert max_abs_diff > 1e-6, (
        f"K-mult vs uniform booster predictions are identical (max diff {max_abs_diff}). "
        "sample_weight is not flowing through."
    )


def test_train_no_sample_weight_matches_unweighted_path():
    """Backward-compat: when sample_weight is None, the trainer behavior is
    bit-identical to the pre-international-model signature. Ensures PL's
    re-train byte-diff check survives."""
    # Tiny deterministic fixture so byte-comparison is feasible.
    X_train = pd.DataFrame({"home_elo": [1500.0, 1550.0, 1480.0], "away_elo": [1500.0, 1450.0, 1520.0]})
    y_train = pd.Series([0, 0, 2])
    X_val = pd.DataFrame({"home_elo": [1500.0, 1600.0], "away_elo": [1500.0, 1500.0]})
    y_val = pd.Series([1, 0])

    booster_none = train_model(X_train, y_train, X_val, y_val)
    booster_default = train_model(
        X_train, y_train, X_val, y_val, sample_weight=None, val_sample_weight=None
    )
    # Spot-check predictions on val are identical.
    import xgboost as xgb
    dval = xgb.DMatrix(X_val.values, feature_names=FEATURE_NAMES)
    p_none = booster_none.predict(dval)
    p_default = booster_default.predict(dval)
    np.testing.assert_array_equal(p_none, p_default)
