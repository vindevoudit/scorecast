"""Single-subcommand CLI: `python -m scorecast_ml train --league PL`.

Tier 17 collapsed this from 6 subcommands (ingest / reconcile / elo /
train / predict / predict-and-write) to just `train`. The runtime
inference path is now JS-native (lib/ml/xgboostInference.js); the only
Python responsibility left is fitting an XGBoost booster on the
committed CSV corpus and emitting its native JSON dump for the JS
loader to read.

Run output:
  - `ml/data/models/<league>_elo_<YYYY-MM-DD>.json` (XGBoost native dump)
  - The operator copies/commits this to `lib/ml/models/<league>_elo.json`
    (without the date suffix). The JS cascade picks it up automatically
    on the next deploy.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd
import typer

from scorecast_ml.config import get_settings
from scorecast_ml.elo.engine import EloConfig, batch_compute
from scorecast_ml.ingest.football_data_uk import parse_csv
from scorecast_ml.logging import configure_logging, get_logger
from scorecast_ml.train.model import FEATURE_NAMES, save_as_json, train as train_model

app = typer.Typer(
    add_completion=False,
    help="ScoreCast probability training (Tier 17 — elo-only XGBoost + JS-native runtime).",
    no_args_is_help=True,
)

log = get_logger("cli")


# Strict reconciliation: load teams.json once, look up every CSV name
# against the per-league aliases map. Missing name → hard fail. The
# Python pipeline used to fall back to rapidfuzz for unknowns; Tier 17
# drops that because the historical corpus is static and known-clean —
# add new entries to teams.json BEFORE retraining if a new club shows up.
def _load_aliases(league: str) -> dict[str, str]:
    here = Path(__file__).resolve().parent
    teams_file = here / "reconcile" / "teams.json"
    if not teams_file.exists():
        raise FileNotFoundError(f"teams.json missing at {teams_file}")
    with teams_file.open(encoding="utf-8") as f:
        blob = json.load(f)
    block = blob.get(league)
    if not block:
        raise KeyError(f"League {league!r} not in teams.json")
    return block["aliases"]


def _canonicalize_frame(df: pd.DataFrame, aliases: dict[str, str]) -> pd.DataFrame:
    """Apply strict alias lookup to home + away columns. Loud-fail on
    any unknown so the training corpus stays clean."""
    raw_names = set(df["home"].astype(str).unique()) | set(df["away"].astype(str).unique())
    missing = [n for n in raw_names if n not in aliases]
    if missing:
        raise KeyError(
            f"reconcile: {len(missing)} CSV team(s) without an alias in teams.json:\n"
            + "\n".join(f"  - {n}" for n in sorted(missing))
            + "\nAdd entries to ml/scorecast_ml/reconcile/teams.json (PL.aliases) and re-run."
        )
    out = df.copy()
    out["home"] = out["home"].map(aliases)
    out["away"] = out["away"].map(aliases)
    return out


# Time-based train/val split by season code. The CSV corpus is named
# `PL_<YYYY>.csv` (4-char code: "9394" = 1993/94, "2425" = 2024/25). We
# train through `train_through_season` and validate on `val_season`
# (early-stopping signal). No held-out test set — Tier 17 dropped that
# step; honest OOS evaluation now happens in production via the picks
# that come in and resolve.
def _season_start_year(code: str) -> int:
    yy = int(code[:2])
    return 1900 + yy if yy >= 70 else 2000 + yy


def _label_from_ftr(ftr: str) -> int:
    return {"H": 0, "D": 1, "A": 2}[ftr]


@app.command()
def train(
    league: str = typer.Option("PL", "--league", help="ScoreCast league code (default PL — only PL is wired today)"),
    val_season: str = typer.Option("2324", "--val-season", help="Season code to hold out for early-stopping val"),
    train_through_season: str = typer.Option(
        "2223",
        "--train-through-season",
        help="Inclusive last season in the train fold (everything BEFORE val_season). Defaults to 2223.",
    ),
    hfa: float = typer.Option(0.0, "--hfa", help="Home-field advantage in Elo points (default 0)"),
    output_dir: Path | None = typer.Option(
        None,
        "--output-dir",
        help="Where to write the model JSON. Defaults to ml/data/models/.",
    ),
) -> None:
    """Fit an XGBoost multi:softprob model on `[home_elo_pre, away_elo_pre]`
    features over the committed PL_*.csv corpus. Writes the booster's
    native JSON dump that lib/ml/xgboostInference.js loads at runtime."""
    configure_logging()

    settings = get_settings()
    raw_dir = settings.raw_dir()
    csvs = sorted(raw_dir.glob(f"{league}_*.csv"))
    if not csvs:
        typer.echo(f"no cached CSVs for league {league!r} in {raw_dir}. The Tier 17 trim removed the `ingest` subcommand — commit CSVs manually to ml/data/raw/.")
        raise typer.Exit(code=1)

    # Load + sort by season-start-year (alphabetical sort breaks because
    # PL_0001 sorts before PL_9394 due to the two-digit-year wrap).
    csvs = sorted(
        csvs,
        key=lambda p: _season_start_year(re.match(rf"^{league}_(\d{{4}})", p.stem).group(1)),
    )
    frames = []
    for path in csvs:
        season = path.stem.split("_", 1)[1]
        frames.append(parse_csv(path, league=league, season_code=season))
    raw = pd.concat(frames, ignore_index=True).sort_values("date").reset_index(drop=True)

    # Strict reconciliation. raise loud on any unmapped team.
    aliases = _load_aliases(league)
    reconciled = _canonicalize_frame(raw, aliases)

    # Run Elo to populate home_elo_pre / away_elo_pre on every row.
    elo_cfg = EloConfig(home_field_advantage=hfa)
    augmented, _state = batch_compute(reconciled, elo_cfg)

    # Build the 2-feature matrix + 3-class labels.
    X = augmented[["home_elo_pre", "away_elo_pre"]].rename(
        columns={"home_elo_pre": "home_elo", "away_elo_pre": "away_elo"}
    )
    y = pd.Series([_label_from_ftr(f) for f in augmented["ftr"]], name="label")

    # Time-based split. Train rows are all seasons through (inclusive)
    # `train_through_season`; val rows are exactly `val_season`.
    season_col = augmented["season"]
    train_through_year = _season_start_year(train_through_season)
    val_year = _season_start_year(val_season)
    season_year = season_col.apply(_season_start_year)
    train_mask = season_year <= train_through_year
    val_mask = season_year == val_year

    X_train, y_train = X[train_mask], y[train_mask]
    X_val, y_val = X[val_mask], y[val_mask]
    typer.echo(
        f"split: train {len(X_train)} rows (through {train_through_season}),"
        f" val {len(X_val)} rows ({val_season})"
    )
    if X_train.empty or X_val.empty:
        typer.echo(
            "split produced empty train or val set — check --train-through-season"
            f"/--val-season against the cached CSVs ({csvs[0].stem}..{csvs[-1].stem})."
        )
        raise typer.Exit(code=2)

    # Verify FEATURE_NAMES contract holds (defensive — if model.py drifts
    # away from [home_elo, away_elo], training silently produces a model
    # the JS runtime can't consume because feature indices wouldn't match).
    if list(X_train.columns) != FEATURE_NAMES:
        raise RuntimeError(
            f"FEATURE_NAMES drift detected: cli produced {list(X_train.columns)}"
            f" but train.model expected {FEATURE_NAMES}. Realign before training."
        )

    booster = train_model(X_train, y_train, X_val, y_val)

    out_dir = output_dir or settings.models_dir()
    path = save_as_json(booster, league=league, out_dir=out_dir)
    typer.echo(f"\nmodel JSON written: {path}")
    typer.echo(
        f"Next step: copy/commit to lib/ml/models/{league}_elo.json so the JS"
        " runtime cascade picks it up on next deploy."
    )


def main() -> None:
    """Console-script entry point. Same as `python -m scorecast_ml train`."""
    app()


if __name__ == "__main__":
    main()
