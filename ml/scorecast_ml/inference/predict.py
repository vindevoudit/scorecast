"""Inference path: load bundle + Elo snapshot, compute features for upcoming
matches, predict 3-class probabilities, round to DECIMAL(3,2) for the DB.
"""

from __future__ import annotations

import pandas as pd

from scorecast_ml.elo.engine import EloConfig, TeamState
from scorecast_ml.features.build import build_inference_features
from scorecast_ml.inference.normalize import Triple, to_three_way
from scorecast_ml.train.model import ModelBundle


def predict_upcoming(
    *,
    bundle: ModelBundle,
    upcoming: pd.DataFrame,
    history_for_form: pd.DataFrame,
    elo_snapshot: dict[str, TeamState] | dict[str, float],
    elo_config: EloConfig | None = None,
) -> pd.DataFrame:
    """Generate per-game probabilities for an upcoming-fixtures DataFrame.

    Args:
      bundle: trained ModelBundle.
      upcoming: DataFrame with [date, home, away] at minimum. Any extra
                columns (e.g. game_id) are preserved on the output.
      history_for_form: prior-match DataFrame for rolling form lookups.
                Typically training CSV + completed current-season DB rows.
      elo_snapshot: either team→TeamState (from `elo.engine.batch_compute`)
                or team→float (from a manual override). Internally
                normalized to team→float.

    Returns the original `upcoming` DataFrame plus 6 new columns:
      p_home, p_draw, p_away          — raw 3-class probabilities (sum to 1.0)
      home_out, draw_out, away_out    — rounded write values (sum to 1.00)
    """
    if upcoming.empty:
        out = upcoming.copy()
        for col in ("p_home", "p_draw", "p_away", "home_out", "draw_out", "away_out"):
            out[col] = []
        return out

    # Normalize the Elo snapshot to team→float for the feature builder.
    flat_snapshot: dict[str, float] = {}
    for team, val in elo_snapshot.items():
        flat_snapshot[team] = (
            float(val.rating) if isinstance(val, TeamState) else float(val)
        )

    X = build_inference_features(
        upcoming, history_for_form, flat_snapshot, elo_config=elo_config
    )
    proba = bundle.predict_proba(X)

    rows = []
    for i in range(len(upcoming)):
        p_h, p_d, p_a = float(proba[i, 0]), float(proba[i, 1]), float(proba[i, 2])
        triple: Triple = to_three_way(p_h, p_d, p_a)
        rows.append(
            {
                "p_home": p_h,
                "p_draw": p_d,
                "p_away": p_a,
                "home_out": triple.home,
                "draw_out": triple.draw,
                "away_out": triple.away,
            }
        )
    preds = pd.DataFrame(rows)

    return pd.concat([upcoming.reset_index(drop=True), preds], axis=1)
