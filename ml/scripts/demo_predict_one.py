"""One-off predictor: shows a single Liverpool-vs-Arsenal prediction for
the 2025/26 season opener (no DB needed). Demonstrates the inference
pipeline end-to-end on a synthetic upcoming fixture."""

import sys
from pathlib import Path

# Make `scorecast_ml` importable when running this script directly from
# its file path (e.g. `python scripts/demo_predict_one.py`). When run as
# `python -m scripts.demo_predict_one` from ml/, this is a no-op.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from scorecast_ml.elo.snapshot import load_latest as load_latest_elo
from scorecast_ml.features.form import build_per_team_history, compute_form_pair
from scorecast_ml.ingest.football_data_uk import parse_csv
from scorecast_ml.inference.predict import predict_upcoming
from scorecast_ml.reconcile.team_mapping import reconcile_dataframe
from scorecast_ml.train.model import load_latest_bundle

LEAGUE = "PL"
HOME = "Liverpool FC"
AWAY = "Arsenal FC"
KICKOFF = pd.Timestamp("2025-08-16T16:30:00+00:00")  # PL opening weekend slot


def main() -> None:
    # 1. Load the trained model + Elo snapshot (most recent on disk).
    bundle, model_path = load_latest_bundle(LEAGUE)
    elo_state, elo_path = load_latest_elo(LEAGUE)

    # 2. Build the rolling-form history from the cached CSVs.
    from scorecast_ml.config import get_settings
    raw_dir = get_settings().raw_dir()
    frames = [
        parse_csv(p, league=LEAGUE, season_code=p.stem.split("_", 1)[1])
        for p in sorted(raw_dir.glob(f"{LEAGUE}_*.csv"))
    ]
    history = (
        pd.concat(frames, ignore_index=True).sort_values("date").reset_index(drop=True)
    )
    reconciled, _ = reconcile_dataframe(history, league=LEAGUE)

    # 3. Synthetic upcoming match.
    upcoming = pd.DataFrame(
        [{"id": "demo-lfc-vs-afc", "date": KICKOFF, "home": HOME, "away": AWAY}]
    )

    # 4. Predict.
    preds = predict_upcoming(
        bundle=bundle,
        upcoming=upcoming,
        history_for_form=reconciled,
        elo_snapshot=elo_state,
    )
    row = preds.iloc[0]

    # 5. Diagnostics: show what fed the model.
    per_team = build_per_team_history(reconciled)
    form = compute_form_pair(per_team, HOME, AWAY, KICKOFF)
    home_elo = elo_state[HOME].rating
    away_elo = elo_state[AWAY].rating

    print(f"Model:          {model_path.name}")
    print(f"Elo snapshot:   {elo_path.name}")
    print()
    print(f"Fixture:        {HOME} vs {AWAY}")
    print(f"Kickoff:        {KICKOFF.isoformat()}")
    print()
    from scorecast_ml.elo.engine import EloConfig
    hfa = EloConfig().home_field_advantage  # whatever the current default is
    print("--- Features fed into the model ---")
    print(f"  home_elo:               {home_elo:7.1f}")
    print(f"  away_elo:               {away_elo:7.1f}")
    print(f"  elo_diff (+HFA {hfa:.0f}):     {home_elo + hfa - away_elo:+7.1f}")
    print(f"  home_ppg_last5:         {form['home_ppg_last5']:7.2f}    away_ppg_last5: {form['away_ppg_last5']:7.2f}")
    print(f"  home_gf_last5:          {form['home_gf_last5']:7.2f}    away_gf_last5:  {form['away_gf_last5']:7.2f}")
    print(f"  home_ga_last5:          {form['home_ga_last5']:7.2f}    away_ga_last5:  {form['away_ga_last5']:7.2f}")
    print(f"  home_days_rest:         {form['home_days_rest']:7.1f}    away_days_rest: {form['away_days_rest']:7.1f}")
    print()
    print("--- Raw 3-class prediction ---")
    print(f"  P(home win):  {row['p_home']:6.3f}  ({row['p_home']*100:5.1f}%)")
    print(f"  P(draw):      {row['p_draw']:6.3f}  ({row['p_draw']*100:5.1f}%)")
    print(f"  P(away win):  {row['p_away']:6.3f}  ({row['p_away']*100:5.1f}%)")
    print(f"  sum:          {row['p_home'] + row['p_draw'] + row['p_away']:6.3f}")
    print()
    print("--- DB-write values (after draw redistribution + rounding) ---")
    print(f"  homeProbability:  {row['home_out']:.2f}")
    print(f"  awayProbability:  {row['away_out']:.2f}")
    print()
    print("--- ScoreCast scoring preview ---")
    print(f"  Correct home pick pays:  ({1 - row['home_out']:.2f}) * 100 = {round((1 - row['home_out']) * 100):3d} pts")
    print(f"  Correct away pick pays:  ({1 - row['away_out']:.2f}) * 100 = {round((1 - row['away_out']) * 100):3d} pts")
    print(f"  Draw outcome:            both picks settle to 0 pts (no draw pick in winner-only mode)")


if __name__ == "__main__":
    main()
