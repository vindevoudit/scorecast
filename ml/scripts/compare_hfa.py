"""HFA ablation: compare the HFA=65 (production default) and HFA=0
(ablation) models head-to-head.

Reads metrics from each bundle's stored metadata and runs the same
Liverpool-vs-Arsenal demo fixture through both to show how the inference
output differs.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from scorecast_ml.config import get_settings
from scorecast_ml.elo.engine import EloConfig, batch_compute
from scorecast_ml.ingest.football_data_uk import parse_csv
from scorecast_ml.inference.predict import predict_upcoming
from scorecast_ml.reconcile.team_mapping import reconcile_dataframe
from scorecast_ml.train.model import load_bundle

LEAGUE = "PL"
HOME = "Liverpool FC"
AWAY = "Arsenal FC"
KICKOFF = pd.Timestamp("2025-08-16T16:30:00+00:00")


def fmt(x: float, prec: int = 3) -> str:
    return f"{x:.{prec}f}"


def main() -> None:
    models_dir = get_settings().models_dir()
    hfa65_path = models_dir / "PL_2025-05-25_hfa65.joblib"
    hfa0_path = models_dir / "PL_2025-05-25_hfa0.joblib"
    if not hfa65_path.exists() or not hfa0_path.exists():
        raise FileNotFoundError(
            f"Both bundles must exist: {hfa65_path}, {hfa0_path}. Run "
            "the HFA=0 train and rename the existing model first."
        )

    bundle65 = load_bundle(hfa65_path)
    bundle0 = load_bundle(hfa0_path)

    # --- Metrics side-by-side ---
    def row(metric: str, val65: float, val0: float, prec: int = 3) -> str:
        delta = val0 - val65
        sign = "+" if delta >= 0 else "-"
        return f"  {metric:<14}  HFA=65: {fmt(val65, prec):>8}   HFA=0: {fmt(val0, prec):>8}   delta: {sign}{fmt(abs(delta), prec)}"

    val65 = bundle65.metrics["val"]
    val0 = bundle0.metrics["val"]
    test65 = bundle65.metrics["test"]
    test0 = bundle0.metrics["test"]

    print("=" * 80)
    print("HFA ABLATION COMPARISON")
    print("=" * 80)
    print(f"Train window: 5 seasons (2004/05 - 2008/09), 1900 matches")
    print(f"Val:          1 season (2009/10), 380 matches")
    print(f"Test:         15 seasons (2010/11 - 2024/25), 5700 matches")
    print()

    print("--- Validation set (380 matches) ---")
    print(row("mlogloss", val65["mlogloss"], val0["mlogloss"]))
    print(row("accuracy", val65["accuracy"], val0["accuracy"]))
    print(row("Brier", val65["brier"], val0["brier"]))
    print()
    print("--- Test set (5700 matches, 15-year backtest) ---")
    print(row("mlogloss", test65["mlogloss"], test0["mlogloss"]))
    print(row("accuracy", test65["accuracy"], test0["accuracy"]))
    print(row("Brier", test65["brier"], test0["brier"]))
    print()

    baseline = bundle65.metrics["baseline_test"]
    print(f"--- Baseline (always predict marginal) ---")
    print(f"  mlogloss: {baseline['mlogloss']:.3f}   accuracy: {baseline['accuracy']:.3f}   Brier: {baseline['brier']:.3f}")
    print()

    # --- Sample prediction: Liverpool vs Arsenal ---
    raw_dir = Path(__file__).parent / "data" / "raw"
    frames = [
        parse_csv(p, league=LEAGUE, season_code=p.stem.split("_", 1)[1])
        for p in sorted(raw_dir.glob(f"{LEAGUE}_*.csv"))
    ]
    history = pd.concat(frames, ignore_index=True).sort_values("date").reset_index(drop=True)
    reconciled, _ = reconcile_dataframe(history, league=LEAGUE)

    upcoming = pd.DataFrame(
        [{"id": "demo", "date": KICKOFF, "home": HOME, "away": AWAY}]
    )

    # Each model needs to be paired with Elo built using its OWN HFA — the
    # Elo trajectory differs by HFA so the feature values are different.
    elo65 = EloConfig(home_field_advantage=65.0)
    _, state65 = batch_compute(reconciled, elo65)
    pred65 = predict_upcoming(bundle=bundle65, upcoming=upcoming, history_for_form=reconciled, elo_snapshot=state65, elo_config=elo65)

    elo0 = EloConfig(home_field_advantage=0.0)
    _, state0 = batch_compute(reconciled, elo0)
    pred0 = predict_upcoming(bundle=bundle0, upcoming=upcoming, history_for_form=reconciled, elo_snapshot=state0, elo_config=elo0)

    r65 = pred65.iloc[0]
    r0 = pred0.iloc[0]

    print(f"--- Sample prediction: {HOME} vs {AWAY} on {KICKOFF.date()} ---")
    print()
    print("                          HFA=65            HFA=0          delta")
    print(f"  Liverpool Elo:        {state65[HOME].rating:8.1f}        {state0[HOME].rating:8.1f}      {state0[HOME].rating - state65[HOME].rating:+6.1f}")
    print(f"  Arsenal Elo:          {state65[AWAY].rating:8.1f}        {state0[AWAY].rating:8.1f}      {state0[AWAY].rating - state65[AWAY].rating:+6.1f}")
    print(f"  elo_diff (+HFA):      {state65[HOME].rating + 65 - state65[AWAY].rating:+8.1f}        {state0[HOME].rating - state0[AWAY].rating:+8.1f}      {(state0[HOME].rating - state0[AWAY].rating) - (state65[HOME].rating + 65 - state65[AWAY].rating):+6.1f}")
    print()
    print(f"  P(Liverpool win):     {r65['p_home']*100:7.1f}%        {r0['p_home']*100:7.1f}%       {(r0['p_home'] - r65['p_home'])*100:+6.1f}pp")
    print(f"  P(draw):              {r65['p_draw']*100:7.1f}%        {r0['p_draw']*100:7.1f}%       {(r0['p_draw'] - r65['p_draw'])*100:+6.1f}pp")
    print(f"  P(Arsenal win):       {r65['p_away']*100:7.1f}%        {r0['p_away']*100:7.1f}%       {(r0['p_away'] - r65['p_away'])*100:+6.1f}pp")
    print()
    print(f"  DB-write homeProb:    {r65['home_out']:8.2f}        {r0['home_out']:8.2f}      {r0['home_out'] - r65['home_out']:+6.2f}")
    print(f"  DB-write awayProb:    {r65['away_out']:8.2f}        {r0['away_out']:8.2f}      {r0['away_out'] - r65['away_out']:+6.2f}")


if __name__ == "__main__":
    main()
