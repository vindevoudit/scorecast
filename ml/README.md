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
├── Dockerfile                # 3-stage image (base + train + runtime); Phase 3
├── .dockerignore             # excludes from the docker build context
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
├── data/                     # mostly gitignored
│   ├── raw/                  # cached CSVs — *.csv ARE committed (~3MB,
│   │                         # public-domain) so Docker builds + onboarding
│   │                         # work without re-downloading. Scratch files
│   │                         # under here stay ignored.
│   ├── elo/                  # Parquet snapshots (gitignored)
│   └── models/               # trained model bundles (gitignored — rebuilt
│                             # inside the Docker train stage)
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

## Phase 3 — Deployment (shipped)

Production runs as a scheduled Azure Container Apps Job. Architecture in
one paragraph: GitHub Actions builds the image from `ml/**` changes
([.github/workflows/ml-deploy.yml](../.github/workflows/ml-deploy.yml))
and pushes to ACR repo `scorecast-ml`. A Container Apps Job
(`scorecast-ml-job`, provisioned by
[infra/modules/ml-job.bicep](../infra/modules/ml-job.bicep)) fires the
image every Thursday at 02:30 UTC and runs the baked-in CMD
(`python -m scorecast_ml predict-and-write --league PL --horizon-days 7`).
The Job's system-assigned identity pulls `database-url` and
`ml-pipeline-password` from Key Vault. Same managed identity, same
Container Apps environment, same Log Analytics workspace as the Node app.

> **Looking for "when does X update?"** → see
> [ONBOARDING.md → Part 3.1: How the system updates itself](ONBOARDING.md#31-how-the-system-updates-itself-phase-3-production)
> for the runtime mental model (three independent cadences: Elo per
> predict run, probabilities every Thursday, model bundle on every
> `ml/**` push) and the end-to-end weekly timeline.

### Container image

The image is built fully reproducibly from git via three Dockerfile stages
(see [Dockerfile](Dockerfile)):

1. **base** — `python:3.14-slim` + `libgomp1` (xgboost OpenMP runtime) +
   `tini` + pip install of `requirements.txt`.
2. **train** — runs `python -m scorecast_ml train --train-from-season 0910
--train-last-season 2324 --val-season 2425` against the committed CSV
   corpus under [data/raw/](data/raw/). Writes the bundle to
   `/app/data/models/PL_<date>.joblib`. Deterministic via the
   `seed=42` baked into [train/model.py](scorecast_ml/train/model.py).
3. **runtime** — non-root (uid 1001), copies code + CSVs + the stage-2
   model bundle. ENTRYPOINT is `tini`; CMD is `predict-and-write`.

The CSV corpus lives in git (`ml/data/raw/PL_*.csv`, ~3 MB) so the build
needs no external network beyond pip. Football-Data.co.uk data is public
domain — the negation rule at [.gitignore:120-124](../.gitignore#L120-L124)
allows CSVs while blocking scratch files.

### Cron schedule

`30 2 * * 4` (Thursdays 02:30 UTC, standard 5-field cron, UTC). PL fixtures
cluster Friday–Sunday, so Thursday pre-dawn is the natural pre-gameweek
slot. The Node app's daily fixture sync runs at 03:00 UTC; ML deliberately
fires 30 min earlier off yesterday's sync so the two jobs never overlap.

Override the schedule via the `cronExpression` param on
[infra/modules/ml-job.bicep](../infra/modules/ml-job.bicep). Manual ad-hoc
runs work on a Schedule-triggered job too:

```bash
az containerapp job start \
  --name scorecast-ml-job \
  --resource-group scorecast-prod
```

That fires the job with its deployed default args
(`predict-and-write --league PL --horizon-days 7` — sentinel-skip on; no
overwrite). For anything else, see the next section.

### Ad-hoc runs with custom args (`--overwrite-existing`, different league, etc.)

The vanilla `az containerapp job start --args ...` flag **cannot** pass
arguments that start with `--` (e.g. `--league`, `--overwrite-existing`)
— the CLI parser greedily eats them as new `az` parameters and errors
with "unrecognized arguments". Working around this requires hitting the
REST API directly with `az rest`, sending a JSON body that overrides
the container template for this one execution.

Per-execution overrides **replace** the container fully — they do not
merge with the deployed template. So the body must include `name`,
`image`, `command`, `args`, `resources`, AND `env` (otherwise the
container starts without `SCORECAST_DB_URL` / `SCORECAST_ML_PASSWORD`
secret refs and dies immediately). The recipe below captures the
current template values so the override only changes `args`.

The whole flow as one PowerShell block — fill in the league / horizon
/ flags you need in the `args` array:

```powershell
# 0. Subscription context
$sub = az account show --query id -o tsv

# 1. Capture the deployed container template (need name/image/resources/env)
$existing = az containerapp job show `
  --name scorecast-ml-job `
  --resource-group scorecast-prod `
  --query "properties.template.containers[0]" -o json | ConvertFrom-Json

# Sanity-print — all four MUST be non-empty before continuing
"name:   $($existing.name)"
"image:  $($existing.image)"
"cpu:    $($existing.resources.cpu)"
"memory: $($existing.resources.memory)"

# 2. Rebuild env as clean hashtables (PSCustomObject round-trip
#    drops/mangles secretRef fields — the API rejects the result)
$envRaw = az containerapp job show `
  --name scorecast-ml-job `
  --resource-group scorecast-prod `
  --query "properties.template.containers[0].env" -o json | ConvertFrom-Json

$envClean = @()
foreach ($e in $envRaw) {
    $entry = [ordered]@{ name = $e.name }
    if ($e.value)     { $entry.value     = $e.value }
    if ($e.secretRef) { $entry.secretRef = $e.secretRef }
    $envClean += $entry
}

# 3. Build the override body. Edit the `args` array for what you need.
$body = @{
  containers = @(
    @{
      name      = "$($existing.name)"
      image     = "$($existing.image)"
      command   = @("python")
      args      = @(
        "-m","scorecast_ml","predict-and-write",
        "--league","PL",
        "--horizon-days","14",
        "--overwrite-existing"
      )
      resources = @{
        cpu    = [double]$existing.resources.cpu
        memory = "$($existing.resources.memory)"
      }
      env       = $envClean
    }
  )
} | ConvertTo-Json -Depth 10 -Compress

# 4. Write to a file — passing $body via --body directly gets the inner
#    quotes stripped by PowerShell's arg parser
[System.IO.File]::WriteAllText("$PWD\body.json", $body)

# 5. Sanity-check before posting — verify real values for name/image/cpu,
#    clean env entries with secretRef intact
Get-Content body.json | python -m json.tool | Select-Object -First 30

# 6. Fire — Content-Type header is required, az rest doesn't add it
az rest --method post `
  --uri "https://management.azure.com/subscriptions/$sub/resourceGroups/scorecast-prod/providers/Microsoft.App/jobs/scorecast-ml-job/start?api-version=2024-03-01" `
  --headers "Content-Type=application/json" `
  --body "@body.json"

# 7. Cleanup
Remove-Item body.json
```

Watch the execution land:

```powershell
az containerapp job execution list `
  --name scorecast-ml-job `
  --resource-group scorecast-prod `
  --query "[0].{name:name,status:properties.status,startTime:properties.startTime}" -o table
```

Status flips `Running` → `Succeeded` over ~30-60s. Then check the writer
summary via Log Analytics:

```powershell
$workspace = az monitor log-analytics workspace list `
  --resource-group scorecast-prod `
  --query "[0].customerId" -o tsv

az monitor log-analytics query `
  --workspace $workspace `
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'scorecast-ml-job' | where TimeGenerated > ago(15m) | where Log_s contains 'writer_summary' | project TimeGenerated, Log_s | order by TimeGenerated desc" `
  -o table
```

Should read `written=N  skipped=0  failed=0` (or `skipped=N` if you ran
without `--overwrite-existing` against already-written rows).

**Gotchas that took us multiple round-trips to find** — keep these in
mind when editing the recipe:

1. `--args` greedy parsing — that's the whole reason for `az rest` over
   `az containerapp job start --args ...`.
2. PowerShell strips quotes inside `--body $jsonString` — always write
   to a file and pass `--body "@filename"`.
3. `az rest` doesn't set `Content-Type` by default — header is required.
4. Body shape: `containers` is **top-level**, not nested under
   `template`. (StartJobExecutionTemplate ≠ JobTemplate.)
5. Override is a full replace, not a merge — `image`, `resources`, AND
   `env` must all be carried over from the existing template.
6. `ConvertFrom-Json` PSCustomObject env entries do **not** round-trip
   cleanly through `ConvertTo-Json` — secretRef fields drop or change
   case. Always rebuild env as fresh hashtables.
7. The empty-string `ephemeralStorage: ""` field that comes back from
   `az ... show` gets rejected if included — only pass `cpu` + `memory`.
8. Sanity-print captured values before constructing the body. If
   `$existing.name` / `.image` / `.resources.cpu` print as empty, the
   `az` context lost the subscription — re-run `az account set
--subscription <sub>`.
9. Env var names in prod may differ from your local `ml/.env` (e.g.
   prod uses `SCORECAST_DB_URL`, local uses `DATABASE_URL`). The
   per-execution override uses whatever's already in the deployed
   template — don't try to "fix" it from local.

### Initial deploy (one-time)

The `ml_pipeline` admin user must already exist **in the running app**
(provisioned via AdminPanel → UserManager → Add user against the live
URL, not a local dev instance — see
[Provisioning the service-account user](#provisioning-the-service-account-user)
above). The password you set on that user must exactly match the
`mlPipelinePassword` you pass to Bicep below.

Then apply the infra:

```powershell
# 1. Discover the current Container App certificate id (Tier 9-followup
#    requires this on every reapply to keep the bantryx.com binding).
$CERT_ID = az containerapp env certificate list `
  --name scorecast-env-p3aaelev7xp52 `
  --resource-group scorecast-prod `
  --query "[?properties.subjectName=='bantryx.com'].id" -o tsv

# 2. Discover the live Node app image tag (avoids Bicep flipping the app
#    back to the helloworld placeholder during reapply).
$APP_IMG = az containerapp revision list `
  --name scorecast-app --resource-group scorecast-prod `
  --query "[?properties.active==``true``].properties.template.containers[0].image | [0]" -o tsv
$IMAGE_TAG = ($APP_IMG -split ':')[-1]

# 3. Discover the live ml-job image tag (same reason, for the ml-job).
$ML_IMG = az containerapp job show `
  --name scorecast-ml-job --resource-group scorecast-prod `
  --query "properties.template.containers[0].image" -o tsv
$ML_IMAGE_TAG = ($ML_IMG -split ':')[-1]

# 4. Apply — 6 params, all required for the reapply to stay idempotent.
az deployment group create `
  -g scorecast-prod `
  -f infra/main.bicep `
  -p imageTag=$IMAGE_TAG `
  -p mlImageTag=$ML_IMAGE_TAG `
  -p pgAdminPassword='<live postgres admin pw>' `
  -p mlPipelinePassword='<ml_pipeline service-account pw>' `
  -p customDomain=bantryx.com `
  -p customDomainCertId=$CERT_ID
```

That creates the `scorecast-ml-job` Container Apps Job + writes
`ml-pipeline-password` to Key Vault + grants the Job's managed identity
`AcrPull` + `Key Vault Secrets User`. On the very first deploy
(`mlImageTag=placeholder`, the default), the Job runs the helloworld
bootstrap image; the first push to `main` touching `ml/**` triggers
[.github/workflows/ml-deploy.yml](../.github/workflows/ml-deploy.yml)
which builds + pushes the real image and points the Job at it.

### Rotating the ml_pipeline password

1. Sign in to ScoreCast → AdminPanel → UserManager → reset password.
2. Update `ml/.env` locally so manual runs keep working.
3. Reapply Bicep (same command as above) with the new
   `mlPipelinePassword`. Key Vault gets the new value; the next Job
   execution picks it up automatically.

### Retraining

The model is baked into the image at build time, so retraining = rebuild.
Two paths:

- **Casual retrain on latest CSV / DB data** — push a no-op commit
  touching `ml/**` (e.g. bump a comment in `ml/scorecast_ml/__init__.py`).
  CD rebuilds with current code + current CSV corpus + current data;
  Job picks up the new image on its next fire.
- **Train locally + smoke-test, then push** — run
  `python -m scorecast_ml train --league PL` locally to verify metrics
  look sane before pushing the change that triggers a rebuild.

Both paths produce a deterministic model (`seed=42`). If you want a
genuinely _new_ dataset (e.g. one more season of CSVs), drop the new
CSV into `data/raw/` and `git add` it — CD picks it up automatically.

### Cost

$0/mo of new spend. Container Apps Jobs in the Consumption profile bill
only for actual run time (typical Job run: ~60 s × 0.5 vCPU × 1 GiB →
sub-cent per week). ACR storage for ML images sits inside the existing
ACR's free tier headroom.

## Future phases

- **Phase 4** — MOV multiplier, head-to-head features, Optuna HPO,
  model-performance admin tab, the draw-partial-credit scoring change
  (separate tier — needs changes in
  [services/PickService.js](../services/PickService.js)), multi-league
  expansion via [ONBOARDING.md](ONBOARDING.md).
