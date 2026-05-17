"""Feature matrix construction for training + inference.

Phase 1 feature set (11 columns — see plan §5):
  - elo_diff = home_elo_pre + HFA - away_elo_pre
  - home_elo, away_elo (raw)
  - home_ppg_last5, away_ppg_last5
  - home_gf_last5, away_gf_last5, home_ga_last5, away_ga_last5
  - home_days_rest, away_days_rest

XGBoost handles NaN natively, so early-season matches with no prior form
pass through unmodified.
"""

from __future__ import annotations

import pandas as pd

from scorecast_ml.elo.engine import EloConfig
from scorecast_ml.features.form import build_per_team_history, compute_form_pair

FEATURE_NAMES = [
    "elo_diff",
    "home_elo",
    "away_elo",
    "home_ppg_last5",
    "away_ppg_last5",
    "home_gf_last5",
    "away_gf_last5",
    "home_ga_last5",
    "away_ga_last5",
    "home_days_rest",
    "away_days_rest",
]


def _ftr_to_label(ftr: str) -> int:
    """H/D/A → 0/1/2 — matches XGBoost `multi:softprob` column order
    {0: home_win, 1: draw, 2: away_win} used everywhere downstream."""
    return {"H": 0, "D": 1, "A": 2}[ftr]


def build_training_features(
    matches_with_elo: pd.DataFrame, *, elo_config: EloConfig | None = None
) -> tuple[pd.DataFrame, pd.Series]:
    """Walk matches in chronological order, computing AS-OF features for
    each. Returns (X, y).

    Required input columns: date, home, away, ftr, fthg, ftag,
    home_elo_pre, away_elo_pre. (The Elo engine's `batch_compute`
    produces these.)
    """
    cfg = elo_config or EloConfig()
    if not matches_with_elo["date"].is_monotonic_increasing:
        matches_with_elo = matches_with_elo.sort_values("date").reset_index(drop=True)

    per_team = build_per_team_history(matches_with_elo)

    rows: list[dict] = []
    labels: list[int] = []
    for r in matches_with_elo.itertuples(index=False):
        form = compute_form_pair(per_team, r.home, r.away, r.date)
        rows.append(
            {
                "elo_diff": r.home_elo_pre + cfg.home_field_advantage - r.away_elo_pre,
                "home_elo": r.home_elo_pre,
                "away_elo": r.away_elo_pre,
                **{k: v for k, v in form.items() if k in FEATURE_NAMES},
            }
        )
        labels.append(_ftr_to_label(r.ftr))

    X = pd.DataFrame(rows)[FEATURE_NAMES]
    y = pd.Series(labels, name="label")
    return X, y


def build_inference_features(
    upcoming: pd.DataFrame,
    history_for_form: pd.DataFrame,
    elo_snapshot: dict[str, float],
    *,
    elo_config: EloConfig | None = None,
) -> pd.DataFrame:
    """Build the feature matrix for upcoming matches.

    Args:
      upcoming: DataFrame with at least [date, home, away]. May carry
                additional columns (game_id etc.) — they're ignored by
                the feature builder but useful to keep aligned with the
                output for joining downstream.
      history_for_form: DataFrame of past matches in the same column
                shape as the training CSV (date, home, away, fthg, ftag,
                ftr). Used to compute rolling form for each upcoming
                team as-of the upcoming match date. Typically the
                training CSV + completed current-season DB games.
      elo_snapshot: team_name → final rating (float). Unknown teams get
                the EloConfig default rating.

    Returns a DataFrame indexed like `upcoming` with columns FEATURE_NAMES
    plus an `_index` column carrying the original row index for joining.
    """
    cfg = elo_config or EloConfig()
    per_team = build_per_team_history(history_for_form)

    rows: list[dict] = []
    for r in upcoming.itertuples(index=False):
        home_elo = float(elo_snapshot.get(r.home, cfg.initial_rating))
        away_elo = float(elo_snapshot.get(r.away, cfg.initial_rating))
        form = compute_form_pair(per_team, r.home, r.away, r.date)
        rows.append(
            {
                "elo_diff": home_elo + cfg.home_field_advantage - away_elo,
                "home_elo": home_elo,
                "away_elo": away_elo,
                **{k: v for k, v in form.items() if k in FEATURE_NAMES},
            }
        )
    return pd.DataFrame(rows)[FEATURE_NAMES]
