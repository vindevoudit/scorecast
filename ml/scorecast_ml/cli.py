"""Typer CLI: `python -m scorecast_ml <subcommand>`.

Phase 1 subcommands: ingest, reconcile, elo, train, predict, predict-and-write.
The `pipeline` composite is deferred to Phase 2 per the plan.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pandas as pd
import typer

from scorecast_ml.config import get_settings
from scorecast_ml.logging import configure_logging, get_logger

app = typer.Typer(
    add_completion=False,
    help="ScoreCast probability pipeline (Elo + XGBoost).",
    no_args_is_help=True,
)

log = get_logger("cli")


# --- ingest -----------------------------------------------------------------

@app.command()
def ingest(
    league: str = typer.Option(..., "--league", help="ScoreCast league code (e.g. PL)"),
    seasons: str = typer.Option(
        ..., "--seasons", help="Season range like '1819-2324' or single '2324'"
    ),
    force_redownload: bool = typer.Option(
        False, "--force-redownload", help="Re-fetch even if cached"
    ),
) -> None:
    """Download + cache Football-Data.co.uk CSVs for the requested seasons."""
    configure_logging()
    from scorecast_ml.ingest.football_data_uk import load_seasons
    from scorecast_ml.ingest.seasons import parse_season_range

    season_codes = parse_season_range(seasons)
    df = load_seasons(league, season_codes, force_redownload=force_redownload)
    typer.echo(
        f"ingested {len(df)} rows across {len(season_codes)} seasons "
        f"({season_codes[0]} -> {season_codes[-1]})"
    )


# --- reconcile --------------------------------------------------------------

@app.command()
def reconcile(
    league: str = typer.Option(..., "--league"),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Print every team name + its canonical match"
    ),
) -> None:
    """Walk every team in the cached CSVs against teams.json. Fails loudly
    on any name without a mapping (errors include the unmatched name)."""
    configure_logging()
    from scorecast_ml.ingest.football_data_uk import csv_cache_path, parse_csv
    from scorecast_ml.reconcile.team_mapping import canonicalize, UnknownTeamError

    raw_dir = get_settings().raw_dir()
    csvs = sorted(raw_dir.glob(f"{league}_*.csv"))
    if not csvs:
        typer.echo(f"no cached CSVs for league {league!r} in {raw_dir}. Run ingest first.")
        raise typer.Exit(code=1)

    all_names: set[str] = set()
    for path in csvs:
        season = path.stem.split("_", 1)[1]
        df = parse_csv(path, league=league, season_code=season)
        all_names.update(df["home"].astype(str).unique())
        all_names.update(df["away"].astype(str).unique())

    errors: list[str] = []
    rows: list[tuple[str, str, str]] = []
    for name in sorted(all_names):
        try:
            canon, score = canonicalize(name, league)
            score_str = "exact" if score is None else f"fuzzy {score:.1f}"
            rows.append((name, canon, score_str))
        except UnknownTeamError as exc:
            errors.append(str(exc))

    if dry_run or errors:
        typer.echo(f"\nLeague {league}: {len(all_names)} unique team names across {len(csvs)} CSVs.")
        typer.echo(f"{'CSV name':<20}  {'Canonical':<32}  Match")
        typer.echo("-" * 70)
        for raw, canon, score_str in rows:
            typer.echo(f"{raw:<20}  {canon:<32}  {score_str}")

    if errors:
        typer.echo("\nERRORS:")
        for e in errors:
            typer.echo(f"  - {e}")
        raise typer.Exit(code=2)

    typer.echo(f"\nreconcile ok: {len(rows)} teams mapped (no unknown).")
    csv_cache_path  # silence unused import: useful in future for cache validation


# --- elo --------------------------------------------------------------------

@app.command()
def elo(
    league: str = typer.Option(..., "--league"),
) -> None:
    """Compute Elo snapshot from all cached CSVs for the league.
    Writes data/elo/{league}_{as_of}.parquet."""
    configure_logging()
    from scorecast_ml.elo.engine import EloConfig, batch_compute
    from scorecast_ml.elo.snapshot import save
    from scorecast_ml.ingest.football_data_uk import parse_csv
    from scorecast_ml.reconcile.team_mapping import reconcile_dataframe

    raw_dir = get_settings().raw_dir()
    csvs = sorted(raw_dir.glob(f"{league}_*.csv"))
    if not csvs:
        typer.echo(f"no cached CSVs for league {league!r}.")
        raise typer.Exit(code=1)

    frames = []
    for path in csvs:
        season = path.stem.split("_", 1)[1]
        frames.append(parse_csv(path, league=league, season_code=season))
    raw = pd.concat(frames, ignore_index=True).sort_values("date").reset_index(drop=True)
    reconciled, _ = reconcile_dataframe(raw, league=league)
    _, state = batch_compute(reconciled, EloConfig())

    as_of = reconciled["date"].max().date()
    path = save(state, league=league, as_of=as_of)
    top5 = sorted(state.items(), key=lambda kv: kv[1].rating, reverse=True)[:5]
    typer.echo(f"elo snapshot saved: {path}")
    typer.echo("top 5 teams by rating:")
    for team, s in top5:
        typer.echo(f"  {s.rating:>7.1f}  {team}  ({s.matches_played} matches)")


# --- train ------------------------------------------------------------------

@app.command()
def train(
    league: str = typer.Option(..., "--league"),
    train_last_season: str = typer.Option(
        "2223", "--train-last-season", help="Last season included in train fold (code)"
    ),
    val_season: str = typer.Option("2324", "--val-season"),
    test_season: str = typer.Option("2425", "--test-season"),
    train_from_season: str | None = typer.Option(
        None, "--train-from-season",
        help="Earliest season in train fold (code). Defaults to all-available.",
    ),
    hfa: float = typer.Option(
        0.0, "--hfa",
        help="Home-field advantage in Elo points (default 0 since the ablation "
             "showed it's a structural no-op for XGBoost). Pass --hfa 65 to "
             "reproduce the legacy training.",
    ),
    no_calibration: bool = typer.Option(
        False, "--no-calibration",
        help="Skip the per-class isotonic calibration step. Calibration is "
             "fit on the val set after training; honest OOS evaluation must "
             "then be on a held-out test set (scripts/backtest_2526.py).",
    ),
    model_suffix: str | None = typer.Option(
        None, "--model-suffix",
        help="Suffix appended to the model filename (before .joblib). Useful "
             "for A/B comparisons: --model-suffix hfa0 yields PL_<date>_hfa0.joblib.",
    ),
) -> None:
    """Train XGBoost on cached CSVs. Time-based split: train through
    `train_last_season`, val on `val_season`, test on `test_season`.

    Optional `--train-from-season` constrains the training window to a
    fixed range (e.g. 5-season window: --train-from-season 0506
    --train-last-season 0910). Elo is always computed on the FULL history
    available — only the training labels are windowed."""
    configure_logging()
    from scorecast_ml.elo.engine import EloConfig, batch_compute
    from scorecast_ml.features.build import build_training_features
    from scorecast_ml.ingest.football_data_uk import parse_csv
    from scorecast_ml.reconcile.team_mapping import reconcile_dataframe
    from scorecast_ml.train.dataset import split_by_season_boundary
    from scorecast_ml.train.eval import evaluate, majority_class_baseline
    from scorecast_ml.train.model import fit_calibrators, save_bundle, train as train_model

    raw_dir = get_settings().raw_dir()
    csvs = sorted(raw_dir.glob(f"{league}_*.csv"))
    if not csvs:
        typer.echo(f"no cached CSVs for league {league!r}.")
        raise typer.Exit(code=1)

    frames = []
    for path in csvs:
        season = path.stem.split("_", 1)[1]
        frames.append(parse_csv(path, league=league, season_code=season))
    raw = pd.concat(frames, ignore_index=True).sort_values("date").reset_index(drop=True)
    reconciled, _ = reconcile_dataframe(raw, league=league)
    elo_cfg = EloConfig(home_field_advantage=hfa)
    augmented, _state = batch_compute(reconciled, elo_cfg)

    X, y = build_training_features(augmented, elo_config=elo_cfg)
    dates = augmented["date"].reset_index(drop=True)

    split = split_by_season_boundary(
        X, y, dates,
        train_last_season=train_last_season,
        val_season=val_season,
        test_season=test_season,
        train_from_season=train_from_season,
    )
    summary = split.summary()
    typer.echo(f"split: {summary}")
    if len(split.X_train) == 0 or len(split.X_val) == 0:
        typer.echo("Empty train or val set — check season codes vs cached data.")
        raise typer.Exit(code=2)

    data_through = str(augmented["date"].max().date())
    bundle = train_model(
        split.X_train, split.y_train,
        split.X_val, split.y_val,
        league=league,
        data_through_date=data_through,
    )
    # Record the Elo config so the bundle is self-describing — without
    # this an HFA=0 vs HFA=65 ablation can't be told apart from the
    # bundle alone.
    bundle.metrics["elo_config"] = {
        "initial_rating": elo_cfg.initial_rating,
        "k_factor": elo_cfg.k_factor,
        "home_field_advantage": elo_cfg.home_field_advantage,
        "promoted_team_strategy": elo_cfg.promoted_team_strategy,
    }
    bundle.metrics["split_summary"] = summary
    bundle.metrics["calibrated"] = not no_calibration

    # Always capture the uncalibrated val baseline before fitting the
    # calibrators — this is the model's true generalization signal before
    # the calibration step gets to peek at val. Reported alongside the
    # calibrated number so reviewers can see exactly how much calibration
    # shifted the metrics on val (which is, by construction, optimistic).
    raw_val_proba = bundle.predict_proba_raw(split.X_val)
    bundle.metrics["val_uncalibrated"] = evaluate(
        split.y_val.values, raw_val_proba, label="val_uncalibrated"
    )

    if not no_calibration:
        fit_calibrators(bundle, split.X_val, split.y_val)

    # After this point, bundle.predict_proba returns CALIBRATED probs
    # when calibrators are fit. The val metric is intentionally
    # optimistic — the honest OOS check is a held-out test set.
    val_proba = bundle.predict_proba(split.X_val)
    val_metrics = evaluate(split.y_val.values, val_proba, label="val")
    bundle.metrics["val"] = val_metrics
    if len(split.X_test) > 0:
        test_proba = bundle.predict_proba(split.X_test)
        bundle.metrics["test"] = evaluate(split.y_test.values, test_proba, label="test")
        bundle.metrics["baseline_test"] = majority_class_baseline(split.y_test.values)

    save_path = None
    if model_suffix:
        from scorecast_ml.config import get_settings as _get_settings
        save_path = (
            _get_settings().models_dir() / f"{league}_{data_through}_{model_suffix}.joblib"
        )
    path, meta = save_bundle(bundle, save_path)
    typer.echo(f"\nmodel saved: {path}")
    typer.echo(f"metadata:    {meta}")
    typer.echo(json.dumps(bundle.metrics, indent=2, default=str))


# --- predict ----------------------------------------------------------------

def _build_inference_context(league: str):
    """Shared helper: load latest model + Elo, fetch upcoming + history
    from the DB, return everything needed for predict / predict-and-write."""
    from scorecast_ml.db.connection import connect
    from scorecast_ml.db.queries import (
        fetch_completed_for_league,
        fetch_league_by_code,
        fetch_upcoming_for_league,
    )
    from scorecast_ml.elo.engine import EloConfig, batch_compute
    from scorecast_ml.ingest.football_data_uk import parse_csv
    from scorecast_ml.reconcile.team_mapping import reconcile_dataframe
    from scorecast_ml.train.model import load_latest_bundle

    bundle, bundle_path = load_latest_bundle(league)

    # Rebuild Elo from CSVs + DB completed games. Cheaper than caching for
    # MVP — sub-second on ~6 seasons. Phase 2 can swap to the cached
    # snapshot + an incremental update from the DB tail.
    raw_dir = get_settings().raw_dir()
    csvs = sorted(raw_dir.glob(f"{league}_*.csv"))
    csv_frames = []
    for path in csvs:
        season = path.stem.split("_", 1)[1]
        csv_frames.append(parse_csv(path, league=league, season_code=season))
    csv_history = (
        pd.concat(csv_frames, ignore_index=True)
        if csv_frames
        else pd.DataFrame(
            columns=["date", "home", "away", "fthg", "ftag", "ftr", "league", "season"]
        )
    )

    with connect() as conn:
        league_row = fetch_league_by_code(conn, code=league)
        if not league_row:
            raise RuntimeError(
                f"League {league!r} not in DB. Was it seeded? "
                "Check `SELECT * FROM leagues`."
            )
        completed = fetch_completed_for_league(conn, league_id=str(league_row["id"]))
        upcoming = fetch_upcoming_for_league(
            conn, league_id=str(league_row["id"]), horizon_days=10_000
        )

    # Build a CSV-shaped frame from DB completed games so the Elo + form
    # functions can consume them uniformly with the CSV history.
    db_history_rows = []
    for r in completed:
        if r["homeScore"] is None or r["awayScore"] is None:
            continue
        if r["homeScore"] > r["awayScore"]:
            ftr = "H"
        elif r["homeScore"] < r["awayScore"]:
            ftr = "A"
        else:
            ftr = "D"
        db_history_rows.append(
            {
                "date": pd.Timestamp(r["date"], tz="UTC")
                if pd.Timestamp(r["date"]).tzinfo is None
                else pd.Timestamp(r["date"]),
                "home": r["homeTeam"],
                "away": r["awayTeam"],
                "fthg": int(r["homeScore"]),
                "ftag": int(r["awayScore"]),
                "ftr": ftr,
                "league": league,
                "season": "db",
            }
        )
    db_history = pd.DataFrame(db_history_rows)

    csv_reconciled, _ = reconcile_dataframe(csv_history, league=league) if not csv_history.empty else (csv_history, None)
    full_history = pd.concat([csv_reconciled, db_history], ignore_index=True).sort_values("date").reset_index(drop=True)

    _, elo_state = batch_compute(full_history, EloConfig())

    upcoming_df = pd.DataFrame(
        [
            {
                "id": str(g["id"]),
                "date": pd.Timestamp(g["date"], tz="UTC")
                if pd.Timestamp(g["date"]).tzinfo is None
                else pd.Timestamp(g["date"]),
                "home": g["homeTeam"],
                "away": g["awayTeam"],
                "homeProbability": float(g["homeProbability"])
                if g["homeProbability"] is not None
                else None,
                "awayProbability": float(g["awayProbability"])
                if g["awayProbability"] is not None
                else None,
            }
            for g in upcoming
        ]
    )

    return bundle, bundle_path, upcoming_df, full_history, elo_state


@app.command()
def predict(
    league: str = typer.Option(..., "--league"),
    horizon_days: int = typer.Option(7, "--horizon-days"),
    out: Path | None = typer.Option(None, "--out", help="Write predictions to JSON"),
) -> None:
    """Predict upcoming fixtures and print/write the per-game probabilities.
    No DB writes — use `predict-and-write` for that."""
    configure_logging()
    from scorecast_ml.inference.predict import predict_upcoming

    bundle, bundle_path, upcoming_df, history, elo_state = _build_inference_context(league)
    if upcoming_df.empty:
        typer.echo(f"no upcoming fixtures for league {league!r}.")
        return

    upcoming_df = upcoming_df[upcoming_df["date"] <= upcoming_df["date"].min() + pd.Timedelta(days=horizon_days)]
    preds = predict_upcoming(
        bundle=bundle,
        upcoming=upcoming_df,
        history_for_form=history,
        elo_snapshot=elo_state,
    )

    typer.echo(f"model: {bundle_path}")
    typer.echo(f"upcoming (next {horizon_days}d): {len(preds)} fixtures\n")
    typer.echo(
        f"{'date':<16}  {'home vs away':<60}  {'P_h':>5}  {'P_d':>5}  {'P_a':>5}  ->  {'h_out':>5} / {'a_out':>5}"
    )
    typer.echo("-" * 120)
    for r in preds.itertuples(index=False):
        matchup = f"{r.home} vs {r.away}"
        typer.echo(
            f"{str(r.date.date()):<16}  {matchup:<60}  "
            f"{r.p_home:>5.2f}  {r.p_draw:>5.2f}  {r.p_away:>5.2f}  ->  "
            f"{r.home_out:>5.2f} / {r.away_out:>5.2f}"
        )

    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        preds.to_json(out, orient="records", date_format="iso", indent=2)
        typer.echo(f"\nwrote {len(preds)} rows to {out}")


@app.command("predict-and-write")
def predict_and_write(
    league: str = typer.Option(..., "--league"),
    horizon_days: int = typer.Option(7, "--horizon-days"),
    dry_run: bool = typer.Option(False, "--dry-run"),
    overwrite_existing: bool = typer.Option(
        False, "--overwrite-existing",
        help="By default we skip games whose probabilities aren't the (0.50, 0.50) sentinel.",
    ),
) -> None:
    """Predict upcoming fixtures and push probabilities via PUT /api/admin/games/:id."""
    configure_logging()
    from scorecast_ml.db.writer import write_probabilities
    from scorecast_ml.inference.predict import predict_upcoming

    bundle, bundle_path, upcoming_df, history, elo_state = _build_inference_context(league)
    if upcoming_df.empty:
        typer.echo(f"no upcoming fixtures for league {league!r}.")
        return

    upcoming_df = upcoming_df[upcoming_df["date"] <= upcoming_df["date"].min() + pd.Timedelta(days=horizon_days)]
    preds = predict_upcoming(
        bundle=bundle,
        upcoming=upcoming_df,
        history_for_form=history,
        elo_snapshot=elo_state,
    )

    rows = preds.to_dict(orient="records")
    typer.echo(f"model: {bundle_path}")
    typer.echo(f"will consider {len(rows)} upcoming fixtures (dry_run={dry_run}, overwrite={overwrite_existing})")
    result = write_probabilities(
        rows, overwrite_existing=overwrite_existing, dry_run=dry_run
    )
    typer.echo(
        f"\nsummary: written={result.written}  skipped={result.skipped}  failed={result.failed}"
    )
    if result.failures:
        typer.echo("first 5 failures:")
        for game_id, status, body in result.failures[:5]:
            typer.echo(f"  {game_id}  HTTP {status}  {body}")
        raise typer.Exit(code=3)


def main() -> None:
    """Console-script entry point. Same as `python -m scorecast_ml`."""
    app()


if __name__ == "__main__":
    main()
