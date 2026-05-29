"""XGBoost training + native JSON export for the elo-only model.

Tier 17 trimmed this module from ~280 LOC to ~80. Calibration / joblib
bundling / load_latest_bundle / FEATURE_NAMES are all gone — the runtime
inference path is now JS-native (lib/ml/xgboostInference.js) and reads
the booster's native JSON dump directly.

Only export path: `booster.save_model(json_path)`. Commit the resulting
JSON file to `lib/ml/models/<league>_elo.json` and the JS cascade picks
it up on the next deploy.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd
import xgboost as xgb

from scorecast_ml.logging import get_logger

log = get_logger(__name__)


# Elo-only feature set: just the two pre-match Elo ratings. The 11-feature
# build (form/days-rest/etc.) was deliberately dropped per Tier 17 — the
# JS runtime cascade can rebuild Elo incrementally but has no source for
# rolling form, so the production feature set has to match what the
# cascade can supply.
FEATURE_NAMES = ["home_elo", "away_elo"]


DEFAULT_PARAMS: dict = {
    "objective": "multi:softprob",
    "num_class": 3,
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "reg_lambda": 1.0,
    "min_child_weight": 3,
    "tree_method": "hist",
    "eval_metric": "mlogloss",
    "seed": 42,
}

DEFAULT_NUM_BOOST_ROUND = 400
DEFAULT_EARLY_STOPPING_ROUNDS = 30


def train(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
    *,
    sample_weight: pd.Series | None = None,
    val_sample_weight: pd.Series | None = None,
    params: dict | None = None,
    num_boost_round: int = DEFAULT_NUM_BOOST_ROUND,
    early_stopping_rounds: int = DEFAULT_EARLY_STOPPING_ROUNDS,
) -> xgb.Booster:
    """Fit XGBoost multi:softprob on the 2-feature matrix. Returns the
    raw Booster — save via `save_as_json` (no joblib bundle wrapper).

    International model support: optional `sample_weight` (per-row weight
    aligned to X_train, typically the FIFA-style K-multiplier) is passed
    through to the train DMatrix; `val_sample_weight` does the same for
    early-stopping val. Both default `None` → bit-identical to the
    pre-international-model PL path.
    """
    if list(X_train.columns) != FEATURE_NAMES:
        X_train = X_train[FEATURE_NAMES]
    if list(X_val.columns) != FEATURE_NAMES:
        X_val = X_val[FEATURE_NAMES]

    final_params = {**DEFAULT_PARAMS, **(params or {})}
    # CRITICAL non-regression invariant: when sample_weight is None we must
    # NOT pass the `weight=` kwarg to DMatrix at all. Passing `weight=None`
    # vs omitting the kwarg produces a different internal DMatrix and shifts
    # XGBoost's serialized output even though they're "functionally
    # equivalent" — broke PL byte-identity until this branch landed.
    dtrain_kwargs: dict = {"label": y_train.values, "feature_names": FEATURE_NAMES}
    if sample_weight is not None:
        dtrain_kwargs["weight"] = sample_weight.values
    dval_kwargs: dict = {"label": y_val.values, "feature_names": FEATURE_NAMES}
    if val_sample_weight is not None:
        dval_kwargs["weight"] = val_sample_weight.values
    dtrain = xgb.DMatrix(X_train.values, **dtrain_kwargs)
    dval = xgb.DMatrix(X_val.values, **dval_kwargs)

    evals_result: dict = {}
    booster = xgb.train(
        final_params,
        dtrain,
        num_boost_round=num_boost_round,
        evals=[(dtrain, "train"), (dval, "val")],
        early_stopping_rounds=early_stopping_rounds,
        evals_result=evals_result,
        verbose_eval=False,
    )

    best_iter = getattr(booster, "best_iteration", None)
    log.info(
        "train_complete",
        train_rows=len(X_train),
        val_rows=len(X_val),
        best_iteration=int(best_iter) if best_iter is not None else None,
        best_val_mlogloss=(
            float(evals_result["val"]["mlogloss"][int(best_iter)])
            if best_iter is not None
            else float(evals_result["val"]["mlogloss"][-1])
        ),
    )
    return booster


def save_as_json(booster: xgb.Booster, *, league: str, out_dir: Path) -> Path:
    """Write the native XGBoost JSON dump that the JS tree walker
    (lib/ml/xgboostInference.js) parses. Filename pattern:
    `<league>_elo_<YYYY-MM-DD>.json`. Commit the resulting file to
    `lib/ml/models/<league>_elo.json` (without the date suffix) — the
    JS loader looks up by that exact name."""
    out_dir.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    path = out_dir / f"{league}_elo_{today}.json"
    booster.save_model(str(path))
    log.info("model_saved_json", path=str(path))
    return path
