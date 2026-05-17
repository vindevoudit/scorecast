"""Persist + load Elo snapshots as Parquet.

A snapshot is one row per team in the dataset:
    team (str) | rating (float64) | matches_played (int) | last_match_date (datetime64[ns, UTC])

Per-league files named {league}_{as_of_date}.parquet under data/elo/.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd

from scorecast_ml.config import get_settings
from scorecast_ml.elo.engine import TeamState


def snapshot_path(league: str, as_of: date) -> Path:
    return get_settings().elo_dir() / f"{league}_{as_of.isoformat()}.parquet"


def state_to_dataframe(state: dict[str, TeamState]) -> pd.DataFrame:
    rows = [
        {
            "team": name,
            "rating": s.rating,
            "matches_played": s.matches_played,
            "last_match_date": s.last_match_date,
        }
        for name, s in state.items()
    ]
    df = pd.DataFrame(rows)
    if df.empty:
        df = pd.DataFrame(
            columns=["team", "rating", "matches_played", "last_match_date"]
        )
    return df.sort_values("rating", ascending=False).reset_index(drop=True)


def dataframe_to_state(df: pd.DataFrame) -> dict[str, TeamState]:
    out: dict[str, TeamState] = {}
    for row in df.itertuples(index=False):
        out[row.team] = TeamState(
            rating=float(row.rating),
            matches_played=int(row.matches_played),
            last_match_date=pd.Timestamp(row.last_match_date)
            if pd.notna(row.last_match_date)
            else None,
        )
    return out


def save(state: dict[str, TeamState], *, league: str, as_of: date) -> Path:
    df = state_to_dataframe(state)
    path = snapshot_path(league, as_of)
    df.to_parquet(path, index=False)
    return path


def load(path: Path) -> dict[str, TeamState]:
    df = pd.read_parquet(path)
    return dataframe_to_state(df)


def load_latest(league: str) -> tuple[dict[str, TeamState], Path]:
    """Find the most recent {league}_*.parquet by filename date suffix."""
    elo_dir = get_settings().elo_dir()
    candidates = sorted(elo_dir.glob(f"{league}_*.parquet"))
    if not candidates:
        raise FileNotFoundError(
            f"No Elo snapshot for league {league!r} in {elo_dir}. "
            "Run `python -m scorecast_ml elo --league {league}` first."
        )
    latest = candidates[-1]
    return load(latest), latest
