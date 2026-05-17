"""Rolling form computed AS-OF a match date, never as-of today.

The signature `compute_form(team_history, as_of, last_n)` exists to make
the canonical leak hard: if you accidentally pass today's date, you'll
include matches in `team_history` that hadn't been played yet at
prediction time. The `< as_of` filter inside is the load-bearing line.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

FORM_WINDOW = 5
DAYS_REST_CAP = 14


def build_per_team_history(matches: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Pivot the wide H/A match list into a per-team long-form view.

    Each match contributes two rows: one from the home team's perspective
    and one from the away team's. Each row has the gf/ga/points the team
    earned in that match. Sorted by date per team.
    """
    rows: list[dict] = []
    for r in matches.itertuples(index=False):
        # Home perspective
        home_points = 3 if r.ftr == "H" else (1 if r.ftr == "D" else 0)
        rows.append(
            {
                "team": r.home,
                "date": r.date,
                "gf": int(r.fthg),
                "ga": int(r.ftag),
                "points": home_points,
            }
        )
        # Away perspective
        away_points = 3 if r.ftr == "A" else (1 if r.ftr == "D" else 0)
        rows.append(
            {
                "team": r.away,
                "date": r.date,
                "gf": int(r.ftag),
                "ga": int(r.fthg),
                "points": away_points,
            }
        )
    long = pd.DataFrame(rows)
    if long.empty:
        return {}
    long = long.sort_values("date").reset_index(drop=True)
    return {team: g.reset_index(drop=True) for team, g in long.groupby("team")}


def compute_form(
    team_history: pd.DataFrame | None,
    as_of: pd.Timestamp,
    *,
    last_n: int = FORM_WINDOW,
) -> dict[str, float]:
    """Last-`last_n` matches before `as_of` → {ppg, gf, ga, days_rest, n_recent}.

    Missing data (new team, no prior matches) returns NaN for each metric
    except n_recent (which is 0). XGBoost handles NaN natively, so the
    caller can pass them straight through.
    """
    out: dict[str, float] = {
        "ppg": float("nan"),
        "gf": float("nan"),
        "ga": float("nan"),
        "days_rest": float("nan"),
        "matches_in_14d": 0,
    }
    if team_history is None or team_history.empty:
        return out

    prior = team_history[team_history["date"] < as_of]
    if prior.empty:
        return out

    recent = prior.tail(last_n)
    out["ppg"] = float(recent["points"].mean())
    out["gf"] = float(recent["gf"].mean())
    out["ga"] = float(recent["ga"].mean())

    last_date = prior["date"].iloc[-1]
    days = (as_of - last_date).days
    out["days_rest"] = float(min(max(days, 0), DAYS_REST_CAP))

    # Fixture congestion proxy: matches played in the 14 days BEFORE as_of.
    window_start = as_of - pd.Timedelta(days=14)
    out["matches_in_14d"] = int(((prior["date"] >= window_start) & (prior["date"] < as_of)).sum())
    return out


def compute_form_pair(
    per_team: dict[str, pd.DataFrame],
    home: str,
    away: str,
    as_of: pd.Timestamp,
    *,
    last_n: int = FORM_WINDOW,
) -> dict[str, float]:
    """Compute home + away form together; flatten into one prefixed dict."""
    h = compute_form(per_team.get(home), as_of, last_n=last_n)
    a = compute_form(per_team.get(away), as_of, last_n=last_n)
    return {
        "home_ppg_last5": h["ppg"],
        "home_gf_last5": h["gf"],
        "home_ga_last5": h["ga"],
        "home_days_rest": h["days_rest"],
        "home_matches_in_14d": h["matches_in_14d"],
        "away_ppg_last5": a["ppg"],
        "away_gf_last5": a["gf"],
        "away_ga_last5": a["ga"],
        "away_days_rest": a["days_rest"],
        "away_matches_in_14d": a["matches_in_14d"],
    }


def fill_nan_with_priors(features: pd.DataFrame, *, priors: dict[str, float] | None = None) -> pd.DataFrame:
    """Optional helper — fill NaN feature columns with reasonable priors
    instead of relying on XGBoost's native NaN handling. Not used by the
    Phase 1 training path (XGBoost handles NaN fine) but available for
    callers that want explicit defaults.
    """
    defaults = {
        "home_ppg_last5": 1.0,
        "away_ppg_last5": 1.0,
        "home_gf_last5": 1.3,
        "away_gf_last5": 1.3,
        "home_ga_last5": 1.3,
        "away_ga_last5": 1.3,
        "home_days_rest": 7.0,
        "away_days_rest": 7.0,
        "home_matches_in_14d": 1.0,
        "away_matches_in_14d": 1.0,
    }
    if priors:
        defaults.update(priors)
    out = features.copy()
    for col, default in defaults.items():
        if col in out.columns:
            out[col] = out[col].fillna(default)
    return np.where(False, out, out)  # type: ignore[return-value]
