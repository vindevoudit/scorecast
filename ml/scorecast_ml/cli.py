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
from scorecast_ml.ingest.international import parse_intl_csv
from scorecast_ml.logging import configure_logging, get_logger
from scorecast_ml.train.model import FEATURE_NAMES, save_as_json, train as train_model

app = typer.Typer(
    add_completion=False,
    help="ScoreCast probability training (Tier 17 — elo-only XGBoost + JS-native runtime).",
    no_args_is_help=True,
)


# Typer collapses to single-command mode when only one @app.command() is
# registered. The empty callback forces multi-subcommand dispatch so
# `python -m scorecast_ml train --league PL` parses correctly. Without
# this Typer interprets `train` as an unexpected positional argument.
@app.callback()
def _root() -> None:
    """ScoreCast ML — train an XGBoost elo-only model and emit the
    native JSON dump the JS runtime consumes."""


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


def _canonicalize_frame(df: pd.DataFrame, aliases: dict[str, str], *, strict: bool = True) -> pd.DataFrame:
    """Apply alias lookup to home + away columns.

    `strict=True` (PL behavior, unchanged): any name not in the aliases
    dict raises loud — the PL corpus is static and clean, so a new club
    in the CSV is always operator-actionable (add to teams.json before
    retraining).

    `strict=False` (INT behavior): unmapped names fall through with
    identity. The CSV's own naming IS the canonical naming for the
    international dataset (see reconcile/teams.json "INT" block note).
    The alias map captures KNOWN SYNONYMS that the source uses
    inconsistently; everything else is preserved as-is. This is the
    appropriate guard when the upstream dataset isn't auditable for
    every team identity (333 nations + microstates + CONIFA).
    """
    raw_names = set(df["home"].astype(str).unique()) | set(df["away"].astype(str).unique())
    missing = [n for n in raw_names if n not in aliases]
    if missing and strict:
        raise KeyError(
            f"reconcile: {len(missing)} CSV team(s) without an alias in teams.json:\n"
            + "\n".join(f"  - {n}" for n in sorted(missing))
            + "\nAdd entries to ml/scorecast_ml/reconcile/teams.json (PL.aliases) and re-run."
        )
    out = df.copy()
    if strict:
        out["home"] = out["home"].map(aliases)
        out["away"] = out["away"].map(aliases)
    else:
        out["home"] = out["home"].map(lambda n: aliases.get(n, n))
        out["away"] = out["away"].map(lambda n: aliases.get(n, n))
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
    league: str = typer.Option("PL", "--league", help="ScoreCast league code (PL or INT)"),
    source: str = typer.Option(
        "fdco",
        "--source",
        help="Data source. 'fdco' (default) = Football-Data.co.uk CSV cache under ml/data/raw/ (PL). 'international' = international_match_archive/results.csv + former_names.csv (INT).",
    ),
    val_season: str = typer.Option("2324", "--val-season", help="[fdco only] Season code held out for early-stopping val"),
    train_through_season: str = typer.Option(
        "2223",
        "--train-through-season",
        help="[fdco only] Inclusive last season in the train fold (everything BEFORE val_season).",
    ),
    val_start_date: str = typer.Option(
        "2022-01-01",
        "--val-start-date",
        help="[international only] ISO date; rows on or after this date are the val fold.",
    ),
    train_through_date: str = typer.Option(
        "2021-12-31",
        "--train-through-date",
        help="[international only] ISO date; rows on or before this date are the train fold.",
    ),
    hfa: float = typer.Option(0.0, "--hfa", help="Home-field advantage in Elo points (default 0)"),
    output_dir: Path | None = typer.Option(
        None,
        "--output-dir",
        help="Where to write the model JSON. Defaults to ml/data/models/.",
    ),
) -> None:
    """Fit an XGBoost multi:softprob model on `[home_elo_pre, away_elo_pre]`
    features. Writes the booster's native JSON dump that
    lib/ml/xgboostInference.js loads at runtime.

    PL path (--source fdco, default): walks the committed PL_*.csv corpus,
    uses strict alias reconciliation + season-based train/val split.
    Bit-identical to the pre-international-model behavior — locked by the
    PL byte-diff check in the verification ladder.

    INT path (--source international, --league INT): walks the
    international_match_archive/ dataset, uses permissive reconciliation
    + date-based train/val split + FIFA-style K-multiplier as both the
    Elo K-factor weight AND the XGBoost row sample_weight.
    """
    configure_logging()

    settings = get_settings()

    if source == "fdco":
        _train_fdco(
            league=league,
            val_season=val_season,
            train_through_season=train_through_season,
            hfa=hfa,
            output_dir=output_dir,
            settings=settings,
        )
    elif source == "international":
        _train_international(
            league=league,
            val_start_date=val_start_date,
            train_through_date=train_through_date,
            hfa=hfa,
            output_dir=output_dir,
            settings=settings,
        )
    else:
        typer.echo(f"unknown --source {source!r}; expected 'fdco' or 'international'")
        raise typer.Exit(code=1)


def _train_fdco(
    *, league: str, val_season: str, train_through_season: str, hfa: float, output_dir: Path | None, settings
) -> None:
    """Original PL training path. Kept structurally bit-identical to its
    pre-international-model form so re-training PL produces byte-identical
    JSON output (XGBoost is deterministic at seed=42)."""
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
    reconciled = _canonicalize_frame(raw, aliases, strict=True)

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


def _train_international(
    *, league: str, val_start_date: str, train_through_date: str, hfa: float, output_dir: Path | None, settings
) -> None:
    """International training path. Wired against international_match_archive/
    (martj42 Kaggle dataset). Uses:
      - permissive reconcile (identity fallback for unmapped names),
      - date-based train/val split (no notion of "season" in international
        football),
      - FIFA-style K-multiplier as both Elo K-factor weight AND XGBoost
        row sample_weight, so high-stakes matches dominate both the rating
        calculation AND the gradient.
      - promoted_team_strategy='initial' — when a new nation appears in the
        dataset we start it at 1500 rather than min(current), because the
        "promoted from below" semantic doesn't apply across confederations.
    """
    # Locate the archive folder. Convention: it sits at the repo root,
    # i.e. ml/.. (two levels up from cli.py).
    repo_root = Path(__file__).resolve().parents[2]
    archive_dir = repo_root / "international_match_archive"
    results_path = archive_dir / "results.csv"
    former_names_path = archive_dir / "former_names.csv"
    if not results_path.exists():
        typer.echo(
            f"international source missing: {results_path} not found. "
            f"Drop martj42's results.csv into {archive_dir} (the standard "
            "'International football results from 1872' Kaggle dataset)."
        )
        raise typer.Exit(code=1)
    if not former_names_path.exists():
        typer.echo(f"international source missing: {former_names_path} not found.")
        raise typer.Exit(code=1)

    raw = parse_intl_csv(results_path, former_names_path)

    # Permissive reconcile — INT block's aliases are typically empty (the
    # CSV's own naming is canonical) but the alias map captures any known
    # synonyms a future Kaggle re-drop introduces.
    aliases = _load_aliases(league)
    reconciled = _canonicalize_frame(raw, aliases, strict=False)

    # Elo config: per-match K-multiplier (k_mult column from ingest) and
    # neutral flag (per-match HFA=0). promoted_team_strategy='initial'
    # because nations don't "promote" from another league — every new
    # nation enters at 1500.
    elo_cfg = EloConfig(
        home_field_advantage=hfa,
        promoted_team_strategy="initial",
        k_multiplier_column="k_mult",
        neutral_column="neutral",
    )
    augmented, _state = batch_compute(reconciled, elo_cfg)

    X = augmented[["home_elo_pre", "away_elo_pre"]].rename(
        columns={"home_elo_pre": "home_elo", "away_elo_pre": "away_elo"}
    )
    y = pd.Series([_label_from_ftr(f) for f in augmented["ftr"]], name="label")
    # K-multiplier doubles as the XGBoost row sample_weight so high-stakes
    # matches dominate the gradient as well as the Elo rating.
    weight = augmented["k_mult"].astype(float)

    # Date-based split.
    val_start = pd.Timestamp(val_start_date, tz="UTC")
    train_through = pd.Timestamp(train_through_date, tz="UTC")
    if val_start <= train_through:
        typer.echo(
            f"--val-start-date {val_start_date} must be AFTER --train-through-date {train_through_date}"
        )
        raise typer.Exit(code=2)
    dates = augmented["date"]
    train_mask = dates <= train_through
    val_mask = dates >= val_start

    X_train, y_train = X[train_mask], y[train_mask]
    X_val, y_val = X[val_mask], y[val_mask]
    w_train = weight[train_mask]
    w_val = weight[val_mask]
    typer.echo(
        f"split: train {len(X_train)} rows (<= {train_through_date}),"
        f" val {len(X_val)} rows (>= {val_start_date})"
    )
    if X_train.empty or X_val.empty:
        typer.echo("split produced empty train or val set — check --val-start-date / --train-through-date.")
        raise typer.Exit(code=2)

    if list(X_train.columns) != FEATURE_NAMES:
        raise RuntimeError(
            f"FEATURE_NAMES drift detected: cli produced {list(X_train.columns)}"
            f" but train.model expected {FEATURE_NAMES}. Realign before training."
        )

    booster = train_model(
        X_train,
        y_train,
        X_val,
        y_val,
        sample_weight=w_train,
        val_sample_weight=w_val,
    )

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
