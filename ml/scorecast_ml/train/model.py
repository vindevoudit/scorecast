"""XGBoost wrapper + joblib bundle save/load.

Phase 1 keeps it simple: multi:softprob with shallow trees, early stopping
on val mlogloss, NO calibration. Calibration is Phase 2 work.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb

from scorecast_ml.config import get_settings
from scorecast_ml.features.build import FEATURE_NAMES
from scorecast_ml.logging import get_logger

log = get_logger(__name__)


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


@dataclass
class ModelBundle:
    model: xgb.Booster
    feature_names: list[str]
    trained_at: str  # ISO 8601 UTC
    data_through_date: str  # ISO 8601 (date only)
    league_code: str
    metrics: dict = field(default_factory=dict)
    git_sha: str | None = None
    params: dict = field(default_factory=dict)
    num_boost_round: int = DEFAULT_NUM_BOOST_ROUND
    best_iteration: int | None = None

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        """Returns (n_rows, 3) probabilities — columns are
        [P_home_win, P_draw, P_away_win] per the FTR → 0/1/2 mapping."""
        if list(X.columns) != self.feature_names:
            X = X[self.feature_names]
        dmat = xgb.DMatrix(X.values, feature_names=self.feature_names)
        # best_iteration is set when early stopping kicked in.
        if self.best_iteration is not None:
            preds = self.model.predict(
                dmat, iteration_range=(0, self.best_iteration + 1)
            )
        else:
            preds = self.model.predict(dmat)
        return np.asarray(preds, dtype=np.float64)


def _git_sha() -> str | None:
    try:
        sha = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
            timeout=3,
        )
        return sha.decode().strip() or None
    except (subprocess.SubprocessError, FileNotFoundError):
        return None


def train(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
    *,
    league: str,
    data_through_date: str,
    params: dict | None = None,
    num_boost_round: int = DEFAULT_NUM_BOOST_ROUND,
    early_stopping_rounds: int = DEFAULT_EARLY_STOPPING_ROUNDS,
) -> ModelBundle:
    """Fit XGBoost with early stopping on val mlogloss."""
    if list(X_train.columns) != FEATURE_NAMES:
        X_train = X_train[FEATURE_NAMES]
    if list(X_val.columns) != FEATURE_NAMES:
        X_val = X_val[FEATURE_NAMES]

    final_params = {**DEFAULT_PARAMS, **(params or {})}
    dtrain = xgb.DMatrix(X_train.values, label=y_train.values, feature_names=FEATURE_NAMES)
    dval = xgb.DMatrix(X_val.values, label=y_val.values, feature_names=FEATURE_NAMES)

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
    if best_iter is not None:
        best_iter = int(best_iter)

    log.info(
        "train_complete",
        league=league,
        train_rows=len(X_train),
        val_rows=len(X_val),
        best_iteration=best_iter,
        best_val_mlogloss=(
            float(evals_result["val"]["mlogloss"][best_iter])
            if best_iter is not None
            else float(evals_result["val"]["mlogloss"][-1])
        ),
    )

    return ModelBundle(
        model=booster,
        feature_names=FEATURE_NAMES,
        trained_at=datetime.now(timezone.utc).isoformat(),
        data_through_date=data_through_date,
        league_code=league,
        params=final_params,
        num_boost_round=num_boost_round,
        best_iteration=best_iter,
        git_sha=_git_sha(),
    )


def save_bundle(bundle: ModelBundle, path: Path | None = None) -> tuple[Path, Path]:
    """Persist the bundle. Returns (joblib_path, meta_json_path)."""
    if path is None:
        date_str = bundle.data_through_date
        path = get_settings().models_dir() / f"{bundle.league_code}_{date_str}.joblib"
    joblib.dump(bundle, path)
    meta_path = path.with_suffix(".meta.json")
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "league_code": bundle.league_code,
                "trained_at": bundle.trained_at,
                "data_through_date": bundle.data_through_date,
                "feature_names": bundle.feature_names,
                "metrics": bundle.metrics,
                "git_sha": bundle.git_sha,
                "params": bundle.params,
                "num_boost_round": bundle.num_boost_round,
                "best_iteration": bundle.best_iteration,
            },
            f,
            indent=2,
            sort_keys=True,
        )
    log.info("bundle_saved", path=str(path), meta=str(meta_path))
    return path, meta_path


def load_bundle(path: Path) -> ModelBundle:
    bundle = joblib.load(path)
    if not isinstance(bundle, ModelBundle):
        raise TypeError(f"{path} is not a ModelBundle (got {type(bundle).__name__})")
    return bundle


def load_latest_bundle(league: str) -> tuple[ModelBundle, Path]:
    """Find the most recent canonical {league}_YYYY-MM-DD.joblib bundle.

    Suffixed variants (e.g. {league}_YYYY-MM-DD_hfa0.joblib produced by
    --model-suffix runs) are deliberately ignored — those are A/B
    artifacts, not the production model. Load them explicitly by path
    via load_bundle().
    """
    import re
    models_dir = get_settings().models_dir()
    canonical = re.compile(rf"^{re.escape(league)}_\d{{4}}-\d{{2}}-\d{{2}}\.joblib$")
    candidates = sorted(
        [p for p in models_dir.glob(f"{league}_*.joblib") if canonical.match(p.name)]
    )
    if not candidates:
        raise FileNotFoundError(
            f"No canonical trained model for league {league!r} in {models_dir}. "
            f"Run `python -m scorecast_ml train --league {league}` first."
        )
    latest = candidates[-1]
    return load_bundle(latest), latest
