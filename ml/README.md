# scorecast-ml

Python ML pipeline that computes `(homeProbability, awayProbability)` for
upcoming ScoreCast fixtures and writes them back through the existing admin
HTTP API. Elo + XGBoost 3-class classifier; the draw mass is redistributed
proportionally to the home/away weights before write.

The pipeline activates ScoreCast's scoring formula
`(1 - p_winning) × 100` ([src/utils/scoring.js](../src/utils/scoring.js)),
which collapses to "every correct pick = 50 pts" while every game sits at
the default `(0.50, 0.50)`. With real probabilities, picking a 20% upset
correctly pays 80 pts; picking a 75% favorite correctly pays 25 pts.

- Plan: `C:\Users\vinde\.claude\plans\review-tier-4b-plan-optimized-falcon.md`
- League onboarding playbook + end-to-end pipeline deep-dive: [ONBOARDING.md](ONBOARDING.md)

## Quickstart

```powershell
# From repo root
cd ml
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env: fill SCORECAST_ML_PASSWORD + SCORECAST_DB_URL (DB URL is the
# same one the Node app uses — copy from the root .env's DATABASE_URL).

# End-to-end PL flow (1993/94 -> 2024/25 history)
python -m scorecast_ml ingest      --league PL --seasons 9394-2425
python -m scorecast_ml reconcile   --league PL --dry-run
python -m scorecast_ml elo         --league PL
python -m scorecast_ml train       --league PL --train-from-season 0405 --train-last-season 0809 --val-season 0910
python -m scorecast_ml predict-and-write --league PL --horizon-days 7 --dry-run
python -m scorecast_ml predict-and-write --league PL --horizon-days 7
```

## What's shipped (Phase 1, verified end-to-end against the local app)

- **Ingest** 32 seasons of PL (1993/94 -> 2024/25, 12,324 matches) from
  Football-Data.co.uk CSVs.
- **Reconcile** 51 distinct historical PL team names against the
  football-data.org canonical form ([teams.json](scorecast_ml/reconcile/teams.json)).
- **Elo** with two non-vanilla knobs:
  - **HFA = 0** (default — the ablation in [scripts/compare_hfa.py](scripts/compare_hfa.py)
    showed it's a structural no-op for XGBoost; trees absorb the constant
    `elo_diff` shift, the model learns home advantage from the home_X /
    away_X feature pairs directly).
  - **Promoted teams enter at `min(current ratings)`** once past the first
    season in the data — captures that newly promoted teams underperform
    the bottom of the league they're joining.
- **Features** — 11-column matrix: `elo_diff`, raw home/away Elo,
  last-5 PPG / GF / GA per side, `days_rest` capped at 14.
- **Train** — XGBoost `multi:softprob` with early stopping on val mlogloss.
  Time-based train/val/test (NEVER random). Production split: 15-season
  train (2009/10 -> 2023/24) + 1-season val (2024/25) + held-out 25/26
  season (361 in-progress DB matches via `scripts/backtest_2526.py`).
  Beats marginal baseline by +5.5 pp accuracy and -0.048 mlogloss on
  honest OOS data. Isotonic calibration fit on val pulls high-end
  overconfidence (70-80% bucket) from -7pp to -2pp deviation.
- **Inference + write** — 3-class -> 2-class draw redistribution, round to
  `DECIMAL(3,2)`, re-balance to sum-to-1, nudge off the `(0.50, 0.50)`
  sentinel, PUT through `/api/admin/games/:id`. Auth via cookie + CSRF
  (login once per run, not per game). Audit-logged.
- **Idempotency** — default skips games whose probabilities aren't the
  untouched `(0.50, 0.50)` sentinel. `--overwrite-existing` flips that.

## CLI reference

```
ingest             --league CODE --seasons RANGE  [--force-redownload]
reconcile          --league CODE                  [--dry-run]
elo                --league CODE
train              --league CODE  [--train-from-season ssss]
                                  [--train-last-season ssss]
                                  [--val-season ssss]
                                  [--test-season ssss]
                                  [--hfa N]
                                  [--model-suffix STR]
predict            --league CODE --horizon-days N [--out PATH]
predict-and-write  --league CODE --horizon-days N [--dry-run]
                                                  [--overwrite-existing]
```

## Project layout

```
ml/
├── requirements.txt          # pip deps
├── .env.example              # runtime config template
├── .python-version           # pyenv pin (3.14)
├── README.md                 # this file
├── ONBOARDING.md             # ML deep-dive + per-league onboarding playbook
├── scorecast_ml/             # importable package
│   ├── cli.py                # Typer entrypoint
│   ├── config.py             # pydantic-settings
│   ├── logging.py            # structlog config
│   ├── ingest/               # Football-Data.co.uk CSV ingest
│   ├── reconcile/            # team-name alias table + rapidfuzz fallback
│   ├── elo/                  # Elo engine + Parquet snapshot
│   ├── features/             # feature engineering (computed as-of match date)
│   ├── train/                # XGBoost training + eval
│   ├── inference/            # predict + 3-class → 2-class projection
│   └── db/                   # psycopg reader + HTTP writer
├── scripts/                  # one-off explorations (runnable end-to-end)
│   ├── demo_predict_one.py   # single-fixture prediction with diagnostics
│   ├── compare_hfa.py        # HFA=65 vs HFA=0 ablation comparison
│   └── backtest_2526.py      # walk-forward 25/26 season backtest from DB
├── data/                     # gitignored
│   ├── raw/                  # cached CSVs
│   ├── elo/                  # Parquet snapshots
│   └── models/               # trained model bundles
└── tests/                    # pytest smoke tests
```

## Key invariants (the things that bite if you forget)

- **`DECIMAL(3,2)` rounding** breaks naive writes — round larger probability
  first, set smaller = `1.00 - larger`. The validator on `updateGameSchema`
  rejects pairs that don't sum to 1.0 ± 0.01.
- **`(0.50, 0.50)` is the "untouched by anyone" sentinel** from
  [services/LeagueService.js:upsertFixture](../services/LeagueService.js).
  Never write that pair — nudge to `(0.51, 0.49)` based on Elo edge.
- **Time-based train/val/test split** only. Random k-fold gives flattering
  log-loss that's pure leakage (the model implicitly sees its own season's
  future).
- **Form features computed AS-OF the match date**, never as-of today.
  `compute_form(team_history, as_of, last_n)` enforces this with a
  `prior = team_history[date < as_of]` filter; trust the signature.
- **Login once per run**, not per game — `/api/login` is rate-limited
  ([middleware/rateLimit.js](../middleware/rateLimit.js)).
- **`load_latest_bundle`** matches strictly on `{league}_YYYY-MM-DD.joblib`
  — suffixed variants like `_hfa0.joblib` produced by `--model-suffix` are
  ignored. Load A/B artifacts explicitly by path via `load_bundle()`.

## Provisioning the service-account user

1. Sign in to ScoreCast as an existing admin.
2. AdminPanel → UserManager → Add user. **Username `ml_pipeline`** (the
   regex at [validation/schemas.js:11](../validation/schemas.js#L11) only
   allows `[A-Za-z0-9_]+` — **no hyphens**), any email, strong password.
   Promote to admin via the role flip.
3. Stash the password in `ml/.env` as `SCORECAST_ML_PASSWORD`.
4. Stash the password in Azure Key Vault as `ml-pipeline-password` (Phase 3).

## Verified by

The smoke-test trail lives in the audit log: search
`audit_log` for `actorUserId` = the `ml_pipeline` user id and
`action = 'admin.game.update'`. Phase 1 sign-off run wrote probabilities
for the 18 remaining 2025/26 PL fixtures (visible in the audit log with
`after = {"homeProbability": …, "awayProbability": …}`).

## Future phases

- **Phase 2** — Isotonic calibration ✅ (shipped). MOV multiplier,
  multi-league expansion (see [ONBOARDING.md](ONBOARDING.md) for the
  per-league playbook), real CI, pytest suite expansion still to come.
- **Phase 3** — Azure Container Apps Job + scheduled GitHub Actions cron.
- **Phase 4** — Optuna HPO, head-to-head features, model-performance admin
  tab, the draw-partial-credit scoring change (separate tier — needs
  changes in [services/PickService.js](../services/PickService.js)).
