"""2025/26 walk-forward backtest using the HFA=0 production model.

Pulls finished 2025/26 PL games from the ScoreCast DB (so it includes
whatever the football-data.org sync has populated), combines them with
the historical CSV training corpus, walks Elo + features forward
chronologically, and scores each 25/26 prediction against its actual
result.

Walk-forward correctness: features for every match are computed using
ONLY data dated strictly before that match (Elo's home_elo_pre / away_elo_pre
columns + compute_form's `prior = team_history[date < as_of]` filter).
No data leakage.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

# Bring the Node app's DATABASE_URL through to the ml pipeline. Done
# BEFORE importing anything that touches pydantic-settings.
_ROOT_ENV = Path(__file__).resolve().parent.parent.parent / ".env"
if _ROOT_ENV.exists() and not os.environ.get("SCORECAST_DB_URL"):
    for line in _ROOT_ENV.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            os.environ["SCORECAST_DB_URL"] = line.split("=", 1)[1].strip().strip('"').strip("'")
            break

import numpy as np  # noqa: E402

from scorecast_ml.config import get_settings  # noqa: E402
from scorecast_ml.db.connection import connect  # noqa: E402
from scorecast_ml.db.queries import fetch_league_by_code  # noqa: E402
from scorecast_ml.elo.engine import EloConfig, batch_compute  # noqa: E402
from scorecast_ml.features.build import build_training_features  # noqa: E402
from scorecast_ml.ingest.football_data_uk import parse_csv  # noqa: E402
from scorecast_ml.inference.normalize import to_two_way  # noqa: E402
from scorecast_ml.reconcile.team_mapping import reconcile_dataframe  # noqa: E402
from scorecast_ml.train.eval import evaluate, majority_class_baseline  # noqa: E402
from scorecast_ml.train.model import load_bundle  # noqa: E402

LEAGUE = "PL"
SEASON_START = pd.Timestamp("2025-07-01", tz="UTC")
SEASON_END = pd.Timestamp("2026-07-01", tz="UTC")
HFA = 0.0
MODEL_FILENAME = "PL_2025-05-25_hfa0.joblib"


def fetch_finished_in_window(conn, league_id: str) -> pd.DataFrame:
    """Pull every finished PL match in the 25/26 window from the DB."""
    from psycopg.rows import dict_row

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            'SELECT id, "homeTeam", "awayTeam", "date", "homeScore", "awayScore", '
            '       result, status, "seasonId" '
            'FROM games '
            'WHERE "leagueId" = %s AND status = %s '
            '  AND "homeScore" IS NOT NULL AND "awayScore" IS NOT NULL '
            '  AND "date" >= %s AND "date" < %s '
            'ORDER BY "date" ASC',
            (league_id, "finished", SEASON_START, SEASON_END),
        )
        return [dict(r) for r in cur.fetchall()]


def db_rows_to_csv_shape(rows: list[dict]) -> pd.DataFrame:
    """Convert DB rows into the same shape parse_csv produces, so they
    drop straight into the Elo + features pipeline."""
    out = []
    for r in rows:
        hs = int(r["homeScore"])
        as_ = int(r["awayScore"])
        if hs > as_:
            ftr = "H"
        elif hs < as_:
            ftr = "A"
        else:
            ftr = "D"
        date = pd.Timestamp(r["date"])
        if date.tzinfo is None:
            date = date.tz_localize("UTC")
        out.append(
            {
                "date": date,
                "home": r["homeTeam"],
                "away": r["awayTeam"],
                "fthg": hs,
                "ftag": as_,
                "ftr": ftr,
                "league": LEAGUE,
                "season": "2526",
                "_db_id": str(r["id"]),
            }
        )
    return pd.DataFrame(out)


def main() -> None:
    settings = get_settings()
    print(f"DB:    {settings.db_url[:50]}{'...' if len(settings.db_url) > 50 else ''}")

    # 1. Pull 25/26 finished games from the DB.
    with connect() as conn:
        league_row = fetch_league_by_code(conn, code=LEAGUE)
        if not league_row:
            raise RuntimeError(
                f"League {LEAGUE!r} not in DB. Has it been seeded? "
                "Check `SELECT * FROM leagues WHERE \"sourceLeagueId\" = 'PL'`."
            )
        db_rows = fetch_finished_in_window(conn, str(league_row["id"]))

    db_df = db_rows_to_csv_shape(db_rows)
    print(f"DB:    fetched {len(db_df)} finished 25/26 PL matches "
          f"({db_df['date'].min().date()} -> {db_df['date'].max().date()})"
          if not db_df.empty else "DB:    no 25/26 finished matches yet")
    if db_df.empty:
        print("Nothing to backtest. Has the football-data.org sync been running?")
        return

    # 2. Load CSV training history through 24/25.
    raw_dir = settings.raw_dir()
    csv_frames = [
        parse_csv(p, league=LEAGUE, season_code=p.stem.split("_", 1)[1])
        for p in sorted(raw_dir.glob(f"{LEAGUE}_*.csv"))
    ]
    csv_df = pd.concat(csv_frames, ignore_index=True).sort_values("date").reset_index(drop=True)
    csv_reconciled, _ = reconcile_dataframe(csv_df, league=LEAGUE)
    print(f"CSV:   loaded {len(csv_reconciled)} rows ({csv_reconciled['date'].min().date()} -> {csv_reconciled['date'].max().date()})")

    # 3. Combine. DB team names already use the canonical (football-data.org)
    #    form, so no reconcile needed for db_df. Add a marker column so we
    #    can slice the 25/26 predictions out at the end.
    csv_reconciled["_db_id"] = None
    combined = pd.concat([csv_reconciled, db_df], ignore_index=True)
    combined = combined.sort_values("date").reset_index(drop=True)

    # 4. Run Elo across everything (with HFA=0 to match the model's training).
    elo_cfg = EloConfig(home_field_advantage=HFA)
    augmented, final_state = batch_compute(combined, elo_cfg)
    print(f"Elo:   {len(augmented)} matches, {len(final_state)} teams, HFA={HFA}")

    # 5. Build per-match features. compute_form filters by date < as_of so
    #    each match's features use only prior data — exactly walk-forward.
    X, y = build_training_features(augmented, elo_config=elo_cfg)

    # 6. Slice out the 25/26 rows.
    mask = augmented["date"] >= SEASON_START
    mask &= augmented["date"] < SEASON_END
    X_25_26 = X.loc[mask].reset_index(drop=True)
    y_25_26 = y.loc[mask].reset_index(drop=True)
    test_meta = augmented.loc[mask, ["date", "home", "away", "fthg", "ftag", "ftr"]].reset_index(drop=True)
    print(f"Test:  {len(X_25_26)} 25/26 matches to score")

    # 7. Load model + predict.
    bundle_path = settings.models_dir() / MODEL_FILENAME
    bundle = load_bundle(bundle_path)
    proba = bundle.predict_proba(X_25_26)
    print(f"Model: {bundle_path.name}  (trained on {bundle.metrics.get('split_summary', {}).get('train_through', '?')})")

    # 8. Metrics.
    metrics = evaluate(y_25_26.values, proba, label="2025-26-test")
    baseline = majority_class_baseline(y_25_26.values)
    print()
    print("=" * 70)
    print("2025/26 SEASON BACKTEST (HFA=0 model, walk-forward features)")
    print("=" * 70)
    print(f"Matches scored:    {metrics['n']}")
    print()
    print(f"{'Metric':<14}  {'Model':>10}  {'Baseline':>10}  {'Delta':>10}")
    print(f"{'mlogloss':<14}  {metrics['mlogloss']:>10.3f}  {baseline['mlogloss']:>10.3f}  {metrics['mlogloss']-baseline['mlogloss']:>+10.3f}")
    print(f"{'accuracy':<14}  {metrics['accuracy']:>10.3f}  {baseline['accuracy']:>10.3f}  {metrics['accuracy']-baseline['accuracy']:>+10.3f}")
    print(f"{'Brier':<14}  {metrics['brier']:>10.3f}  {baseline['brier']:>10.3f}  {metrics['brier']-baseline['brier']:>+10.3f}")
    print()
    print("Class share (25/26 actual):")
    print(f"  home wins: {metrics['class_share']['home_win']*100:.1f}%   draws: {metrics['class_share']['draw']*100:.1f}%   away wins: {metrics['class_share']['away_win']*100:.1f}%")
    print()

    # 9. Sample predictions: 10 highest-confidence + 10 actually-played-but-upset.
    pred_df = test_meta.copy()
    pred_df["p_home"] = proba[:, 0]
    pred_df["p_draw"] = proba[:, 1]
    pred_df["p_away"] = proba[:, 2]
    pred_df["pred_label"] = np.argmax(proba, axis=1)
    pred_df["actual_label"] = y_25_26.values
    pred_df["correct"] = pred_df["pred_label"] == pred_df["actual_label"]
    pred_df["max_proba"] = proba.max(axis=1)

    print("--- 5 highest-confidence predictions ---")
    print(f"{'date':<12}  {'matchup':<55}  {'pred':>5}  {'p':>6}  {'actual':>7}  {'OK':>3}")
    top = pred_df.nlargest(5, "max_proba")
    for r in top.itertuples(index=False):
        matchup = f"{r.home[:25]} vs {r.away[:25]}"
        pred_str = ["H", "D", "A"][r.pred_label]
        actual_str = r.ftr
        print(f"{str(r.date.date()):<12}  {matchup:<55}  {pred_str:>5}  {r.max_proba:>6.3f}  {actual_str:>7}  {('Y' if r.correct else 'X'):>3}")
    print()

    print("--- 5 biggest upsets (model was confidently wrong) ---")
    wrong = pred_df[~pred_df["correct"]]
    if not wrong.empty:
        ups = wrong.nlargest(5, "max_proba")
        print(f"{'date':<12}  {'matchup':<55}  {'pred':>5}  {'p':>6}  {'actual':>7}")
        for r in ups.itertuples(index=False):
            matchup = f"{r.home[:25]} vs {r.away[:25]}"
            pred_str = ["H", "D", "A"][r.pred_label]
            print(f"{str(r.date.date()):<12}  {matchup:<55}  {pred_str:>5}  {r.max_proba:>6.3f}  {r.ftr:>7}")
    print()

    # 10. Calibration check: bucket by predicted probability of the
    # chosen class, see if hit-rate roughly matches probability.
    print("--- Calibration (predicted-class bucket vs actual hit rate) ---")
    bins = [0.0, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0]
    bin_labels = ["<40%", "40-50%", "50-60%", "60-70%", "70-80%", ">80%"]
    pred_df["bucket"] = pd.cut(pred_df["max_proba"], bins=bins, labels=bin_labels, include_lowest=True)
    cal = pred_df.groupby("bucket", observed=True).agg(
        n=("correct", "size"),
        hit_rate=("correct", "mean"),
        avg_pred=("max_proba", "mean"),
    )
    print(cal.to_string(float_format="%.3f"))


if __name__ == "__main__":
    main()
