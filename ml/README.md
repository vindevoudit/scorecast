# ScoreCast ML — training only

The runtime inference path now lives in Node (`lib/ml/`). This Python package is **training-only**: it fits the XGBoost model and emits the native JSON dump that the JS tree walker in [lib/ml/xgboostInference.js](../lib/ml/xgboostInference.js) loads at runtime.

## What survives here

```
ml/
├── README.md                     ← this file
├── requirements.txt              ← trimmed: pandas, numpy, xgboost, sklearn, typer, structlog, pydantic-settings, python-dateutil + pytest, ruff
├── data/raw/PL_*.csv             ← committed Football-Data.co.uk PL corpus (32 seasons)
├── data/models/                  ← train-output JSON (gitignored)
└── scorecast_ml/
    ├── __init__.py, __main__.py, cli.py
    ├── config.py, logging.py
    ├── elo/{__init__,engine}.py        ← Elo math (source of truth for the JS port at lib/ml/eloMath.js)
    ├── ingest/{__init__,football_data_uk}.py  ← CSV parser
    ├── reconcile/{__init__,teams.json}        ← alias dict (consumed via strict lookup in cli.py)
    └── train/{__init__,model}.py              ← XGBoost wrapper + `booster.save_model(...)` JSON export
```

Everything else from the pre-Tier-17 pipeline (inference, db writer, features, calibration, scripts, Dockerfile, ml-job Bicep, CD workflow, Container Apps Job, ACR repo, KV `ml-pipeline-password` secret, `ml_pipeline` DB user) was deleted because the runtime path no longer uses any of it.

## Retraining

```bash
cd ml
python -m venv .venv && . .venv/Scripts/activate    # Windows; use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
python -m scorecast_ml train --league PL
```

This produces `ml/data/models/PL_elo_<YYYY-MM-DD>.json`. Copy that file to `lib/ml/models/PL_elo.json` (without the date suffix — the JS loader looks up by that exact name), commit, and push. The new revision picks up the new model on its next reactive-cascade fire.

```bash
cp ml/data/models/PL_elo_2026-05-22.json ../lib/ml/models/PL_elo.json
git add ../lib/ml/models/PL_elo.json
git commit -m "ml: retrain PL elo-only model (2026-05-22)"
git push
```

### Optional flags

- `--val-season 2324` — early-stopping val fold (default 2023/24).
- `--train-through-season 2223` — inclusive last season in train fold (default 2022/23, leaves 23/24 for val).
- `--hfa 0` — home-field advantage in Elo points (default 0, matches the engine).
- `--output-dir <path>` — override the default `ml/data/models/`.

## Adding a new league

1. Drop the new league's CSVs under `ml/data/raw/<CODE>_*.csv` (Football-Data.co.uk codes mapped through `_load_aliases`).
2. Add a `<CODE>` block to `ml/scorecast_ml/reconcile/teams.json` with the full alias map (CSV name → canonical name as football-data.org sends it).
3. Add the league code to `MODEL_PATHS` in [services/PredictionService.js](../services/PredictionService.js) and re-deploy.
4. `python -m scorecast_ml train --league <CODE>` and commit the resulting JSON to `lib/ml/models/<CODE>_elo.json`.
5. Re-run the JS seeder against prod (`npm run db:seed -- --seed 20260522000001-seed-teams-from-elo-history.js` — currently scoped to PL; extend for the new league).

## Why the trim

Before Tier 17 the pipeline was a 02:30 UTC Container Apps Job that scored every upcoming fixture daily and wrote probabilities via the admin API. Tier 17 inverted that to "react to results as they land" — the runtime cascade in [services/PredictionService.js](../services/PredictionService.js) holds the entire write path now, with the Python side reduced to a once-per-retrain offline fit. Everything that supported the daily-cron model was deadweight after the inversion, so it's gone.
