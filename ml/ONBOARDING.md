# ML Pipeline & League Onboarding

Part 1 is the deep-dive on how `scorecast-ml` works end-to-end. Part 2 is
the playbook for adding a new league (Spain, Germany, Italy, France etc.).
Part 3 covers operating the pipeline once it's running. Part 4 is the
future-self FAQ.

If you just want to ship a new league, jump to **Part 2** — the touchpoints
are five files + one DB row.

---

## Part 1 — How the pipeline works

### 1.1 What it does, and why

ScoreCast scores correct picks with `(1 - p_winning) × 100` where `p_winning`
is the stored `homeProbability` (for home picks) or `awayProbability` (for
away picks). The formula is in [src/utils/scoring.js](../src/utils/scoring.js)
(client) and mirrored in [services/PickService.js](../services/PickService.js)
(authoritative).

When [services/LeagueService.js:upsertFixture](../services/LeagueService.js)
syncs a new fixture from football-data.org, it defaults `homeProbability =
awayProbability = 0.50` because the free-tier API doesn't expose odds. Every
correct pick then pays exactly `(1 - 0.50) × 100 = 50 pts`, and the scoring
formula goes inert — the leaderboard ranks users on how many games they got
right rather than the value of their information.

The ML pipeline fixes this by writing real probabilities, derived from team
strength + recent form. Picking a 20% underdog correctly pays 80 pts;
picking a 75% favorite correctly pays 25 pts. The leaderboard becomes a
genuine probability-weighted skill ranking.

### 1.2 The data flow at a glance

```
                                            ┌─────────────────┐
                                            │ Football-Data   │
                                            │   .co.uk CSVs   │  (30 yrs of
                                            │  (per season,   │   historical
                                            │   per league)   │   results)
                                            └────────┬────────┘
                                                     │
                                                     ▼
┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐
│  Ingest    │──►│ Reconcile  │──►│    Elo     │──►│  Features  │──►│   Train    │
│  (CSV →    │   │ (FDCO →    │   │ (per-team  │   │ (11-column │   │ (XGBoost,  │
│  DataFrame)│   │  canonical)│   │  rating    │   │  matrix    │   │  multi:    │
│            │   │            │   │  walk)     │   │  AS-OF     │   │  softprob) │
└────────────┘   └────────────┘   └────────────┘   └────────────┘   └─────┬──────┘
                                                                          │
                                                                          ▼
                                                                  ┌──────────────┐
                                                                  │  Bundle      │
                                                                  │  {league}_   │
                                                                  │  {date}      │
                                                                  │  .joblib     │
                                                                  └──────┬───────┘
                                                                         │
   ┌──────────────────┐                                                  │
   │ ScoreCast DB     │                                                  │
   │ • leagues row    │ ─── fetch_upcoming ───►                          │
   │ • games rows     │                                                  │
   │ • status=        │                                                  │
   │   'scheduled'    │                                                  │
   └────────┬─────────┘                                                  │
            │                                                            │
            ▼                                                            ▼
    ┌──────────────────────────────────────────────────────────────────────┐
    │  Inference: build features for upcoming games using Elo snapshot +   │
    │  rolling form (computed AS-OF each match date). Predict 3-class      │
    │  (P_h, P_d, P_a). Redistribute draw mass: home_out = P_h / (P_h+P_a),│
    │  away_out = 1 - home_out. Round to DECIMAL(3,2). Nudge off the       │
    │  (0.50, 0.50) sentinel.                                              │
    └────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
                       ┌──────────────────────────┐
                       │ POST /api/login          │
                       │   → sc_csrf cookie       │
                       │ PUT /api/admin/games/:id │
                       │   with X-CSRF-Token      │
                       │   {homeProbability,      │
                       │    awayProbability}      │
                       └──────────┬───────────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │  audit_log row:      │
                       │  action=             │
                       │  'admin.game.update' │
                       │  actor='ml_pipeline' │
                       └──────────────────────┘
```

The pipeline is a standalone Python project; the Node app is untouched
except for being the consumer (writes go through its admin API). Schema
additions to the Node side: zero — `games.homeProbability` and
`games.awayProbability` already existed.

### 1.3 Stage 1 — Ingest

**Module**: [scorecast_ml/ingest/football_data_uk.py](scorecast_ml/ingest/football_data_uk.py),
[scorecast_ml/ingest/seasons.py](scorecast_ml/ingest/seasons.py).

**Source**: Football-Data.co.uk publishes per-season-per-league CSVs at
`https://www.football-data.co.uk/mmz4281/{season_code}/{fdco_code}.csv`
where season is a 4-digit string (`9495` = 1994/95) and fdco_code is their
internal league code (`E0` = English Premier League). The site has been
running since the 1990s; for the big-5 European leagues, history goes back
to 1993/94 or 1995/96.

**Why this and not the live API**: football-data.org's free tier only
returns the current season's fixtures — no `?season=YYYY` parameter, no
multi-year archive. For training we need decades of history. The
free-vs-licensed split is:

| Need                                  | Source                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| Long historical training data         | Football-Data.co.uk CSVs (this stage)                               |
| Current-season fixtures + live scores | football-data.org API (used by the Node app's `lib/footballApi.js`) |
| Current-season completed results      | The ScoreCast DB (synced from the API)                              |

The pipeline merges (1) + (3) at inference time so rolling-form features
are always current.

**Cache**: CSVs land at `ml/data/raw/{league}_{season_code}.csv` keyed by
ScoreCast's own league code (e.g. `PL`, not FDCO's `E0`). This way swapping
historical data sources later is a single-file change rather than a cache
migration. SHA-256 of every downloaded body is logged so corrections are
auditable.

**Parser**: stdlib `csv` module, NOT pandas. Some FDCO seasons (e.g.
2003/04) added odds providers mid-season, producing rows with more columns
than the header. pandas's C and python engines both DROP those rows (~45
matches per affected season) with a "bad line" warning; our parser
truncates each row to the header width and keeps every match. Verified by
the totals: `PL_9394 = 462` (22-team season, 462 matches), `PL_1819 = 380`
(20-team season), grand total 12,324 across 32 seasons.

**Output**: a single DataFrame with columns `[date, home, away, fthg, ftag,
ftr, league, season]` — uppercase `FTR` from the CSV is normalized to
lowercase `ftr` (H/D/A).

### 1.4 Stage 2 — Reconcile

**Module**: [scorecast_ml/reconcile/team_mapping.py](scorecast_ml/reconcile/team_mapping.py).
**Data**: [scorecast_ml/reconcile/teams.json](scorecast_ml/reconcile/teams.json).

**The problem**: Football-Data.co.uk calls them `"Man United"` and
`"Wolves"`; the football-data.org API (and therefore the ScoreCast DB)
calls them `"Manchester United FC"` and `"Wolverhampton Wanderers FC"`. The
two data sources have to agree on team identity for Elo + form features to
be consistent across the training history → inference boundary.

**Solution**: a committed JSON alias table, per-league, that maps FDCO
names → DB canonical names:

```json
{
  "PL": {
    "version": 2,
    "last_reviewed": "2026-05-17",
    "aliases": {
      "Man United": "Manchester United FC",
      "Wolves":     "Wolverhampton Wanderers FC",
      ...
    }
  }
}
```

**Resolution order** (`canonicalize(raw_name, league)`):

1. Exact hit in `aliases` → use it (zero-cost case for known teams).
2. Exact match against the set of canonical names → use it (catches CSVs
   that already use the DB form, rare but free).
3. `rapidfuzz.process.extractOne(raw_name, canonical_names, scorer=WRatio)`:
   - **score ≥ 92** → WARN log, auto-use, append to `_proposed.json` for
     operator review. Used for typo-tolerance ("Manchster United FC" →
     "Manchester United FC", score ~96).
   - **75 ≤ score < 92** → `UnknownTeamError` raised. Run halts. Operator
     must add a manual alias.
   - **score < 75** → `UnknownTeamError` with "likely a newly promoted
     team" hint.

**The loud-error path is the design.** Silently auto-matching at low fuzzy
scores is how naive pipelines drift across preseasons — promoted teams get
matched to vaguely-similar names from the historical record, the model
trains on garbage, and nobody notices. With the loud-error contract,
operator runs `reconcile --dry-run` after each promotion window, adds 3-4
new aliases, commits, done.

**Why JSON over CSV or DB-side table**: this is application logic, not
user data. Version control diffs are clean. The Node side never needs it.

### 1.5 Stage 3 — Elo

**Module**: [scorecast_ml/elo/engine.py](scorecast_ml/elo/engine.py),
[scorecast_ml/elo/snapshot.py](scorecast_ml/elo/snapshot.py).

**Vanilla Elo, two non-vanilla knobs.**

The core math is unchanged from Arpad Elo's 1960 paper:

```python
def expected_score(r_home, r_away, hfa):
    return 1.0 / (1.0 + 10 ** ((r_away - (r_home + hfa)) / 400.0))

def update(rating, expected, actual, k):
    return rating + k * (actual - expected)
```

where `actual` is 1.0 for a win, 0.5 for a draw, 0.0 for a loss. K-factor
is the learning rate — higher = faster movement, more noise.

**Defaults** ([EloConfig](scorecast_ml/elo/engine.py)):

| Knob                     |        Default | Why                                                                                                                                                   |
| ------------------------ | -------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initial_rating`         |           1500 | Standard. Convention.                                                                                                                                 |
| `k_factor`               |             20 | Tight enough that single results don't dominate; loose enough that a strong run shifts the rating in 10 games. FiveThirtyEight uses 20-25 for soccer. |
| `home_field_advantage`   |          **0** | (See §1.12) — the ablation showed it's a structural no-op for XGBoost.                                                                                |
| `promoted_team_strategy` | `"min_rating"` | (See §1.12) — promoted teams should enter at the bottom of the league, not at 1500.                                                                   |

**`batch_compute(matches, config)`** walks matches in chronological order
and returns:

- `augmented` DataFrame: original rows plus `home_elo_pre` + `away_elo_pre`
  columns (the rating BEFORE the match — exactly what a feature engineer
  would have at prediction time).
- `state` dict: `team_name → TeamState(rating, matches_played, last_match_date)`
  reflecting the final rating after every match has been applied.

The pre-match Elo is critical: at inference time the Elo features for an
upcoming match are the team ratings as of right before kickoff, computed
walking forward through every preceding match. There's no future leakage
because the snapshot at row N depends only on rows 0..N-1.

**Snapshot persistence**: `state` is written to
`ml/data/elo/{league}_{date}.parquet` as one row per team. The file is
gitignored — it's a derived artifact, reproducible from the raw CSVs + the
config.

### 1.6 Stage 4 — Features

**Module**: [scorecast_ml/features/build.py](scorecast_ml/features/build.py),
[scorecast_ml/features/form.py](scorecast_ml/features/form.py).

11 columns, MVP-sized:

|   # | Column           | Meaning                                                          |
| --: | ---------------- | ---------------------------------------------------------------- |
|   1 | `elo_diff`       | `home_elo + HFA - away_elo` (the single most predictive feature) |
|   2 | `home_elo`       | Raw rating, lets XGBoost learn non-linearities                   |
|   3 | `away_elo`       | Same                                                             |
|   4 | `home_ppg_last5` | Home team points-per-game over last 5 matches                    |
|   5 | `away_ppg_last5` | Same for away team                                               |
|   6 | `home_gf_last5`  | Goals scored, last 5                                             |
|   7 | `home_ga_last5`  | Goals conceded, last 5                                           |
|   8 | `away_gf_last5`  | Same                                                             |
|   9 | `away_ga_last5`  | Same                                                             |
|  10 | `home_days_rest` | Days since home team's last match (capped at 14)                 |
|  11 | `away_days_rest` | Same for away                                                    |

**Walk-forward correctness lives in [features/form.py](scorecast_ml/features/form.py):**

```python
def compute_form(team_history, as_of, last_n=5):
    prior = team_history[team_history["date"] < as_of]  # < as_of, NOT <=
    if prior.empty:
        return {ppg=NaN, gf=NaN, ga=NaN, days_rest=NaN, ...}
    recent = prior.tail(last_n)
    return {
        "ppg": recent["points"].mean(),
        "gf":  recent["gf"].mean(),
        "ga":  recent["ga"].mean(),
        "days_rest": min((as_of - prior["date"].iloc[-1]).days, 14),
    }
```

The `date < as_of` filter is THE invariant. If you ever change it to `<=`
you're letting the model peek at the result of the match it's about to
predict. If you ever compute form against the whole match list as-of
today (rather than as-of the match date), you're letting it see the entire
rest of the season. Either change tanks training-set log-loss to artificially
good numbers and zero out-of-sample value.

**Missing form** (the first match of a new team): NaN. XGBoost handles
NaN natively — it routes them to whichever child gives the best split.
No imputation needed for Phase 1.

### 1.7 Stage 5 — Train

**Module**: [scorecast_ml/train/](scorecast_ml/train/).

**Algorithm**: XGBoost `multi:softprob` with 3 classes (0=home win, 1=draw,
2=away win). Trees are shallow (`max_depth=4`); features are mostly linear,
deeper trees overfit.

**Default hyperparameters** ([train/model.py](scorecast_ml/train/model.py)):

```python
{
    "objective":        "multi:softprob",
    "num_class":        3,
    "max_depth":        4,
    "learning_rate":    0.05,
    "subsample":        0.8,
    "colsample_bytree": 0.8,
    "reg_lambda":       1.0,
    "min_child_weight": 3,
    "tree_method":      "hist",
    "eval_metric":      "mlogloss",
    "seed":             42,
}
# + num_boost_round=400, early_stopping_rounds=30 on val mlogloss
```

These are deliberately not grid-searched for Phase 1 — the defaults are
already in the right neighborhood for tabular sports data, and you can't
tell whether a 0.5% mlogloss gain is signal or noise until the rest of
the pipeline is stable. Phase 2 will sweep with Optuna.

**Split**: time-based, NEVER random. Configurable via CLI:

```
--train-from-season ssss   # earliest season in train fold (optional)
--train-last-season ssss   # last season in train fold (default 2223)
--val-season ssss          # validation season (default 2324)
--test-season ssss         # test season for label only (everything after val is test)
```

The cutoff for each fold is treated as June 30 — the standard
European football season boundary. Production split:

```
train: 2004/05 → 2008/09  (5 seasons, 1900 matches)  ←──── --train-from-season 0405
                                                         --train-last-season 0809
val:   2009/10            (1 season, 380 matches)    ←──── --val-season 0910
test:  2010/11 → 2024/25  (15 seasons, 5700 matches) ←──── (everything after val)
```

The 15-season test window is unusually long for football ML research
(papers typically use 1-2 seasons). It catches multiple regime shifts —
tiki-taka era, Klopp-Guardiola pressing, post-pandemic crowd dynamics —
and the model holds up across all of them.

**Bundle save**: `{league}_{data_through_date}.joblib` plus a matching
`.meta.json` (the metadata duplicated outside the pickle for inspection
without unpickling). The bundle carries `feature_names`, `trained_at`,
`elo_config`, `params`, `metrics`, and `git_sha` so it's self-describing.

**Loading**: [train/model.py:load_latest_bundle](scorecast_ml/train/model.py)
matches strictly on the canonical `{league}_YYYY-MM-DD.joblib` pattern.
A/B-test artifacts saved with `--model-suffix` (e.g. `PL_..._hfa0.joblib`)
are deliberately ignored — load those explicitly by path via `load_bundle()`.

### 1.8 Stage 6 — Evaluate

**Module**: [scorecast_ml/train/eval.py](scorecast_ml/train/eval.py).

Three metrics, in priority order:

1. **mlogloss** (multi-class log-loss). The thing the model is trained on.
   Captures both calibration AND ranking. ScoreCast's scoring formula
   pays proportional to predicted probabilities, so calibration matters
   directly — a model that says 0.9 when the true rate is 0.7 steals
   payout from correct users.
2. **Brier score** (multi-class). Mean squared error against the one-hot
   target. Secondary calibration check.
3. **Accuracy** (`argmax`). Intuitive but a wrong North Star — a 1%
   accuracy gain at the cost of worse calibration is a regression for us.

**Baseline**: `majority_class_baseline` predicts the marginal class
distribution every time. If our model can't beat this, something's wrong.

**Production metrics**:

| Metric                                    | Model | Baseline |      Δ |
| ----------------------------------------- | ----: | -------: | -----: |
| Test mlogloss (5700 OOS matches)          | 0.992 |    1.065 | -0.073 |
| Test accuracy                             | 51.9% |    44.9% | +7.0pp |
| Test Brier                                | 0.590 |    0.644 | -0.054 |
| 25/26 walk-forward (361 matches) mlogloss | 1.037 |    1.080 | -0.043 |
| 25/26 walk-forward accuracy               | 47.6% |    42.4% | +5.3pp |

The model is genuinely informative but uncalibrated — overconfident above
~70% predicted probability (calibration plot in
[scripts/backtest_2526.py](scripts/backtest_2526.py)). Phase 2 adds
isotonic calibration which is the single biggest remaining quality knob.

### 1.9 Stage 7 — Inference

**Module**: [scorecast_ml/inference/](scorecast_ml/inference/).

For an upcoming fixture:

1. Pull the team's most recent Elo from the snapshot (rebuilt fresh at
   inference time from CSV history + DB current-season completed games —
   so ratings are up-to-date as of the latest finished match).
2. Compute rolling form features against the combined history. The
   `compute_form` filter `date < as_of` guarantees this never leaks
   information from the match being predicted.
3. Build the 11-column feature row.
4. `bundle.predict_proba(X)` → `(P_h, P_d, P_a)`.

Then the 3-class → 2-class projection in
[inference/normalize.py](scorecast_ml/inference/normalize.py):

```
home_out = P_h + (P_h / (P_h + P_a)) · P_d
away_out = P_a + (P_a / (P_h + P_a)) · P_d
```

Algebraically `home_out = P_h / (P_h + P_a)` (proof in the module). The
draw mass is redistributed proportionally to the home/away weights — a
correctly-predicted home pick on a 45/30/25 H/D/A match stores `0.64`,
and `(1 - 0.64) × 100 = 36 pts` on correct.

**Round + rebalance** (also in `normalize.py`): the DB column is
`DECIMAL(3,2)`, so floats round to 2 decimals. The validator requires the
pair sum to 1.0 ± 0.01. Naive rounding can produce `(0.51, 0.51)`
(sum=1.02, rejected) or `(0.50, 0.50)` (sum=1.00 but hits the sentinel).
Strategy: round the LARGER side first, set the smaller side =
`1.00 - larger`. Re-balance always.

**Sentinel-nudge**: `(0.50, 0.50)` is the "untouched by anyone" default
from `LeagueService.upsertFixture`. Even if the model legitimately
produces it, emitting `(0.50, 0.50)` would confuse the next run's
skip-existing logic. We nudge to `(0.51, 0.49)` or `(0.49, 0.51)` based
on whichever side had the higher pre-rounded probability.

### 1.10 Stage 8 — Write

**Module**: [scorecast_ml/db/writer.py](scorecast_ml/db/writer.py).

HTTP path through the existing admin API:

```python
with httpx.Client(base_url=API_BASE_URL) as client:
    login = client.post('/api/login', json={'username': USER, 'password': PW})
    csrf = client.cookies['sc_csrf']
    headers = {'X-CSRF-Token': csrf}
    for game_id, home_p, away_p in rows:
        client.put(
            f'/api/admin/games/{game_id}',
            json={'homeProbability': home_p, 'awayProbability': away_p},
            headers=headers,
        )
```

The pattern mirrors [tests/e2e/helpers/api.js:apiLogin](../tests/e2e/helpers/api.js)
(the same flow the test suite uses against the running app).

**Why HTTP over direct DB SQL**:

- **Audit log for free** — every write becomes an `audit_log` row with
  `action='admin.game.update'`, `actor=ml_pipeline`, `after={...}`. The
  trail is searchable from the existing AdminPanel → Audit Log tab.
- **Validation reuse** — the `updateGameSchema` constraint
  (`sum-to-1 ± 0.01`) is enforced server-side. Schema changes won't
  silently break the writer.
- **Same auth as the test suite** — proven pattern.

**Login once per run**, not per game. `/api/login` is rate-limited by
[middleware/rateLimit.js](../middleware/rateLimit.js). Per-game `PUT` is
NOT rate-limited (admin endpoint).

**Idempotency**: the writer's default skips games whose existing
probabilities are NOT exactly `(0.50, 0.50)`. So a re-run after a
successful write is a no-op. `--overwrite-existing` flips that.

### 1.11 Walk-forward correctness — the contract

The whole pipeline is structured so that features for any match are
built from data dated strictly BEFORE that match. Three load-bearing
mechanisms:

1. **Elo's `home_elo_pre` / `away_elo_pre`**: computed in
   `batch_compute` as a snapshot at the moment of the match, BEFORE
   applying the match's outcome to either team. So the rating at row N
   reflects only rows 0..N-1.
2. **`compute_form` filter `date < as_of`**: rolling form for each team
   is filtered to matches dated STRICTLY before the `as_of` date passed
   in. No `<=`. No "compute against the whole history as-of-today".
3. **`split_by_season_boundary`**: the train/val/test split is by date,
   never by random shuffle. Random k-fold gives flattering log-loss
   that's pure leakage — the model implicitly sees the future of any
   season it partially trained on.

The [scripts/backtest_2526.py](scripts/backtest_2526.py) script puts these
to work end-to-end on the live 25/26 season: it combines all 32 seasons of
CSV history with the DB's 25/26 completed matches, runs `batch_compute`
across the chronological set, then slices out only the 25/26 rows for
prediction. Every prediction in that backtest used only data dated before
the kickoff of the match it predicted.

### 1.12 Key design decisions, with rationale

**HFA = 0 (not 65)**. The conventional Elo home-field advantage for
soccer is +65. We default to 0. The ablation in
[scripts/compare_hfa.py](scripts/compare_hfa.py) shows the two models are
statistically indistinguishable on the 5700-match test set
(mlogloss 0.992 vs 0.993, accuracy 51.9% vs 51.8%). XGBoost trees absorb
the constant shift in `elo_diff` by adjusting split thresholds; the
home/away feature pair structure carries the actual home-advantage
signal. Pass `--hfa 65` to reproduce the legacy training; the model
files for both are preserved under `ml/data/models/` (gitignored).

**Promoted teams enter at `min(current ratings)`, not initial_rating**.
After the first season in the training data, any team appearing for the
first time enters at the rating of the current weakest team in the
league, not the default 1500. Captures the empirical reality that
promoted sides underperform the bottom of the league they're joining.
The `len(seasons_seen) > 1` threshold means the first season's teams
still all start at 1500 (there's no "current league" to peg against yet).

**`(0.50, 0.50)` is treated as a sentinel**. The Node app's
`LeagueService.upsertFixture` defaults new synced rows to that pair,
because the free-tier API has no odds. Our writer treats it as "untouched
by anyone" and skips writing if the values are still at that pair (modulo
0.001 tolerance for floating-point noise). The reverse: we never EMIT
`(0.50, 0.50)` from the model, because then the next run can't tell
whether we wrote it or it's still the default. Sentinel-nudge to
`(0.51, 0.49)` based on Elo edge.

**Single-league models, not a global pool**. La Liga's "Elo 1700" is
not directly comparable to Premier League's "Elo 1700" — they're
calibrated against different opponent pools. A unified-pool Elo would
need a meaningful cross-league signal (Champions League / international
results), which is a Phase 4 question. For now: one model per league,
no shared state.

**Draw partial-credit scoring is OUT of scope**. The math is documented
in [inference/normalize.py](scorecast_ml/inference/normalize.py)'s
docstring for future reference. Implementing it requires Node-side
changes to `services/PickService.scorePick`, `services/GameService.setResult`,
and both copies of the scoring formula. The ML pipeline produces probabilities
that would support such a scoring change; the change itself is a separate tier.

---

## Part 2 — Onboarding a new league

### 2.1 Touchpoints — what changes, what's shared

**Shared across leagues** (zero changes needed):

- Elo engine ([scorecast_ml/elo/engine.py](scorecast_ml/elo/engine.py))
- Feature builder ([scorecast_ml/features/](scorecast_ml/features/))
- Training pipeline ([scorecast_ml/train/](scorecast_ml/train/))
- Inference + normalization ([scorecast_ml/inference/](scorecast_ml/inference/))
- HTTP writer ([scorecast_ml/db/writer.py](scorecast_ml/db/writer.py))
- CLI ([scorecast_ml/cli.py](scorecast_ml/cli.py))

**Per-league** (5 touchpoints):

1. **DB row** in the `leagues` table — `sourceLeagueId` matches the
   football-data.org code (PD, BL1, SA, FL1, etc.). Provisioned via
   AdminPanel → League Manager UI, OR via SQL if you're scripting.
2. **`LEAGUE_CODE_MAP` entry** in
   [scorecast_ml/ingest/football_data_uk.py](scorecast_ml/ingest/football_data_uk.py)
   mapping our code → FDCO code. Already populated for the top-5
   European leagues:

   ```python
   LEAGUE_CODE_MAP = {
       "PL":  "E0",    # Premier League         (England)
       "PD":  "SP1",   # La Liga                (Spain)
       "BL1": "D1",    # Bundesliga             (Germany)
       "SA":  "I1",    # Serie A                (Italy)
       "FL1": "F1",    # Ligue 1                (France)
   }
   ```

   Add a new line for any other FDCO-covered league (Eredivisie = N1,
   Primeira Liga = P1, etc.).

3. **`teams.json` entries** — every team that's played in the league
   during your training window needs an alias from its FDCO name to its
   football-data.org canonical name. Typical count is 30-50 teams over
   25+ seasons (rough rule of thumb: 1.5× the number of teams in the
   league per season).
4. **Train command** with the same shape but the new code:
   `python -m scorecast_ml train --league PD --train-from-season 0405 ...`
5. **`predict-and-write`** with the new code:
   `python -m scorecast_ml predict-and-write --league PD --horizon-days 7`

That's it. Everything else is league-agnostic.

### 2.2 Pre-flight checklist

Before starting, confirm:

- [ ] The league exists in Football-Data.co.uk's archive. Test by
      fetching one season's CSV: `curl -I https://www.football-data.co.uk/mmz4281/2425/SP1.csv`
      should return `200 OK`. (Most major European leagues have data from
      1995/96 onwards.)
- [ ] The league is exposed by football-data.org's free tier (so the
      ScoreCast DB can sync current fixtures). Premier League, La Liga,
      Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, Brasileirão,
      Champions League, Euros, World Cup all are.
- [ ] `FOOTBALL_DATA_API_KEY` is set on whichever ScoreCast environment
      you'll write to (local app .env or Azure Key Vault).
- [ ] An `ml_pipeline` admin user is provisioned on that environment
      (username regex requires underscore, NOT hyphen).

### 2.3 Step-by-step: La Liga (Spain) onboarding

The fully-worked example. Other leagues follow the same pattern.

**Step 1 — Create the league row in the DB.**

Sign in to ScoreCast as an existing admin. AdminPanel → League Manager
→ Add league:

- Name: `La Liga`
- Source provider: `football-data.org`
- Source league id: `PD` (the football-data.org code)
- Country: `Spain`
- Active: `true`

The League Manager UI also exposes a "Sync" button which calls
`POST /api/admin/leagues/{id}/sync` — clicking that pulls the current
season's fixtures via [lib/footballApi.js:getFixtures](../lib/footballApi.js).
After the sync, the ScoreCast DB has the upcoming La Liga games at the
`(0.50, 0.50)` default — exactly the targets the ML writer will overwrite.

**Step 2 — Confirm the LEAGUE_CODE_MAP entry.**

Already done for La Liga (`PD: SP1` in
[scorecast_ml/ingest/football_data_uk.py](scorecast_ml/ingest/football_data_uk.py)).
If you're onboarding a league NOT in that map, add a line.

**Step 3 — Ingest the historical CSVs.**

```powershell
cd ml
python -m scorecast_ml ingest --league PD --seasons 9596-2425
```

La Liga's earliest FDCO season is `9596` (1995/96). 30 seasons × ~380 matches
≈ 11,400 historical matches.

**Step 4 — Bootstrap `teams.json` for La Liga.**

The first reconcile run will fail loudly with a list of unknown team
names. Get the list:

```powershell
# From ml/
python -c "
from pathlib import Path
from scorecast_ml.ingest.football_data_uk import parse_csv
names = set()
for p in sorted(Path('data/raw').glob('PD_*.csv')):
    df = parse_csv(p, league='PD', season_code=p.stem.split('_',1)[1])
    names.update(df['home'].astype(str).unique())
    names.update(df['away'].astype(str).unique())
for n in sorted(names):
    print(n)
"
```

For each name on the list, find its football-data.org canonical form
(you can look it up via the API or the existing PL aliases for similar
teams as a style guide). Then add to
[scorecast_ml/reconcile/teams.json](scorecast_ml/reconcile/teams.json):

```json
{
  "PL": { ... existing ... },
  "PD": {
    "version": 1,
    "last_reviewed": "2026-MM-DD",
    "aliases": {
      "Barcelona":    "FC Barcelona",
      "Real Madrid":  "Real Madrid CF",
      "Ath Madrid":   "Club Atlético de Madrid",
      "Ath Bilbao":   "Athletic Club",
      "Sevilla":      "Sevilla FC",
      "Valencia":     "Valencia CF",
      "Villarreal":   "Villarreal CF",
      "Real Sociedad":"Real Sociedad de Fútbol",
      "Betis":        "Real Betis Balompié",
      "Celta":        "RC Celta de Vigo",
      "Espanol":      "RCD Espanyol de Barcelona",
      "Mallorca":     "RCD Mallorca",
      "Osasuna":      "CA Osasuna",
      "Getafe":       "Getafe CF",
      "Alaves":       "Deportivo Alavés",
      "Las Palmas":   "UD Las Palmas",
      "Girona":       "Girona FC",
      "Leganes":      "CD Leganés",
      "Vallecano":    "Rayo Vallecano de Madrid",
      "Cadiz":        "Cádiz CF",
      "Granada":      "Granada CF",
      "Almeria":      "UD Almería",
      "Elche":        "Elche CF",
      "Levante":      "Levante UD",
      "Eibar":        "SD Eibar",
      "Huesca":       "SD Huesca",
      "Valladolid":   "Real Valladolid CF",
      "La Coruna":    "Deportivo de La Coruña",
      "Sp Gijon":     "Real Sporting de Gijón",
      "Malaga":       "Málaga CF",
      "Real Oviedo":  "Real Oviedo",
      "Zaragoza":     "Real Zaragoza",
      "Tenerife":     "CD Tenerife",
      "Numancia":     "CD Numancia de Soria",
      "Salamanca":    "UD Salamanca",
      "Albacete":     "Albacete BP",
      "Recreativo":   "Real Club Recreativo de Huelva",
      "Hercules":     "Hércules CF",
      "Xerez":        "Xerez CD",
      "Murcia":       "Real Murcia",
      "Gimnastic":    "Gimnàstic de Tarragona",
      "Cordoba":      "Córdoba CF"
    }
  }
}
```

(The list above is illustrative — verify each canonical name against the
ScoreCast DB before committing. Run `SELECT DISTINCT "homeTeam" FROM games
WHERE "leagueId" = (SELECT id FROM leagues WHERE "sourceLeagueId" = 'PD')`
once the API has synced.)

**Step 5 — Reconcile dry-run.**

```powershell
python -m scorecast_ml reconcile --league PD --dry-run
```

If any names are unmapped, the command will exit with `Exit code 2` and
print "ERRORS:" followed by the unknowns. Add aliases for each, repeat
until clean.

**Step 6 — Build the Elo snapshot.**

```powershell
python -m scorecast_ml elo --league PD
```

Spot-check the top 5 teams in the printed output: Real Madrid + Barcelona
should dominate (1700+ each), with Atlético, Sevilla, Valencia rounding
out the top 5.

**Step 7 — Train.**

The Phase 1 standard window:

```powershell
python -m scorecast_ml train --league PD `
  --train-from-season 0405 `
  --train-last-season 0809 `
  --val-season 0910 `
  --test-season 2425
```

This trains on 2004/05-2008/09 and evaluates on 2010/11-2024/25 (15
seasons OOS). For La Liga specifically you can use a longer training
window if you want (it's a more stable competitive landscape than the PL),
but the 5-season window is the shipped reference and lets you compare
metrics directly.

Expected metrics range (for a well-onboarded league):

- Test mlogloss: 0.95-1.05 (vs baseline ~1.07)
- Test accuracy: 50-55% (vs baseline ~45%)
- Brier: 0.55-0.65

If you're outside those ranges, the most likely cause is bad team
reconciliation — same physical team mapping to different canonical names
across seasons, splitting its Elo history. Re-run reconcile and inspect
the `_proposed.json` file.

**Step 8 — Predict-and-write dry run.**

```powershell
python -m scorecast_ml predict-and-write --league PD --horizon-days 14 --dry-run
```

Sanity-check the output:

- All probability pairs sum to 1.0.
- No `(0.50, 0.50)` pairs emitted.
- The known-strong teams (Real Madrid, Barcelona) have favorable home
  numbers (0.70+ home prob when at home, ~0.35-0.45 home prob when away).

**Step 9 — Real write.**

```powershell
python -m scorecast_ml predict-and-write --league PD --horizon-days 14
```

The summary line will read `written=N skipped=0 failed=0` if everything's
right. Spot-check in AdminPanel → Games (filter to La Liga). Spot-check
the AdminPanel → Audit Log tab — N rows with `action=admin.game.update`,
actor `ml_pipeline`.

**Step 10 — Commit.**

```powershell
git add ml/scorecast_ml/reconcile/teams.json
git commit -m "ml: onboard La Liga (PD)"
```

Total time: ~1-2 hours for a new league, mostly spent on the teams.json
mapping. Re-onboarding the same league (e.g. adding 2025/26 alias for a
newly-promoted team) is ~10 minutes.

### 2.4 Bundesliga (Germany) — `BL1` → FDCO `D1`

Same pattern as La Liga. Notes:

- Bundesliga is **18 teams** (not 20), so seasons run **306 matches** not 380. Recent seasons in `ml/data/raw/BL1_*.csv` will be ~306 rows.
- The relegation playoff (16th place vs 2. Bundesliga 3rd place) is a
  Bundesliga-only quirk — FDCO sometimes includes those matches in the
  CSV, sometimes not. Doesn't affect Elo correctness (matches are matches)
  but explains why some season CSVs have 308-309 rows.
- Bayern Munich will dominate the Elo top: ~1750+ across the training
  window. Borussia Dortmund, Leverkusen, RB Leipzig follow.
- Suggested seasons range: `9596-2425` (FDCO has Bundesliga back to 1993/94
  in `D1`, but the early-90s CSVs have some schema quirks not worth fighting).

### 2.5 Serie A (Italy) — `SA` → FDCO `I1`

- **Italian football was 18 teams** until 2003/04, then 20 teams from
  2004/05 onwards. Match counts per season shift accordingly (306 → 380).
  The Elo + features pipeline doesn't care, but it's worth knowing for
  data-quality spot-checks.
- Top-3 historically: Juventus, AC Milan, Inter Milan (their Elo
  trajectories swap across the 2000s-2010s as each had different runs).
- Calciopoli (2006) — Juventus was relegated to Serie B for one season
  (2006/07). Their FDCO data simply skips that year, which is exactly
  what the Elo engine wants — Juve re-enters in 2007/08 at the rating
  they last had, BUT under our `promoted_team_strategy='min_rating'` rule
  they re-enter at `min(current ratings)` instead. This is wrong for
  this specific edge case (Juve was a top side before AND after, just
  punished off-field). Two options: (a) accept it — one team for one
  season — and let Elo recover within 5-10 matches; (b) manually
  intervene by overriding Juve's 2007/08 entry rating. Phase 1 ships (a).
- Suggested seasons range: `9596-2425`.

### 2.6 Ligue 1 (France) — `FL1` → FDCO `F1`

- **Reduced from 20 to 18 teams starting 2023/24** (one-off restructuring
  to harmonize with UEFA quotas). So `FL1_2324.csv` and onward have ~306
  matches/season; older seasons have 380.
- PSG's modern dominance starts ~2011/12 (Qatari ownership). Their Elo
  shoots up across that period — useful sanity-check that your training
  is picking up regime shifts.
- Suggested seasons range: `9596-2425`. (FDCO has French data back to
  1993/94 in `F1`, similar early-90s caveat as Bundesliga.)

### 2.7 Quick reference table

| League         | Country     | ScoreCast code | FDCO code |            Teams | FDCO depth | Quirks                                           |
| -------------- | ----------- | -------------- | --------- | ---------------: | ---------- | ------------------------------------------------ |
| Premier League | England     | `PL`           | `E0`      | 20 (22 pre-1995) | 1993/94+   | Already shipped                                  |
| La Liga        | Spain       | `PD`           | `SP1`     |               20 | 1995/96+   | Real M / Barça dominance shapes Elo distribution |
| Bundesliga     | Germany     | `BL1`          | `D1`      |               18 | 1993/94+   | 306 matches/season; Bayern run from 2012/13+     |
| Serie A        | Italy       | `SA`           | `I1`      | 20 (18 pre-2004) | 1993/94+   | Calciopoli 2006/07 (Juve relegated 1 year)       |
| Ligue 1        | France      | `FL1`          | `F1`      | 18 (20 pre-2023) | 1993/94+   | Dropped 20→18 in 2023/24; PSG era from 2011/12   |
| Eredivisie     | Netherlands | `DED`          | `N1`      |               18 | 1993/94+   | Ajax / PSV / Feyenoord dominance                 |
| Primeira Liga  | Portugal    | `PPL`          | `P1`      |               18 | 1994/95+   | Big 3 (Benfica, Sporting CP, Porto)              |

### 2.8 Verification checklist (post-onboard)

For each new league, confirm:

- [ ] `python -m scorecast_ml reconcile --league {CODE}` exits 0 with
      "no unknown" and a reasonable team count (~30-50).
- [ ] `python -m scorecast_ml elo --league {CODE}` prints sensible top-5
      (the dominant historical clubs).
- [ ] `python -m scorecast_ml train --league {CODE} --train-from-season 0405 --train-last-season 0809 --val-season 0910` finishes in under a minute and reports test mlogloss < baseline by at least -0.04.
- [ ] `python -m scorecast_ml predict-and-write --league {CODE} --horizon-days 14 --dry-run` shows no `(0.50, 0.50)` pairs and sane H/A balance.
- [ ] After a real write: AdminPanel → Audit Log shows N entries with
      actor `ml_pipeline` action `admin.game.update`.
- [ ] Pick on an upcoming fixture in the new league via the user UI;
      verify the pick view shows the new probability (not 50/50).

---

## Part 3 — Operating the pipeline

### 3.1 Daily / weekly workflow (Phase 1 — manual)

```powershell
# Once per week, before the gameweek opens:
cd ml
.\.venv\Scripts\Activate.ps1

# Loop over leagues you've onboarded:
foreach ($code in @('PL', 'PD', 'BL1', 'SA', 'FL1')) {
  python -m scorecast_ml predict-and-write --league $code --horizon-days 10 --dry-run
}
# Spot-check the dry-run output, then re-run without --dry-run
```

Re-training cadence: monthly is plenty. Re-train only when:

- A new season starts (new teams just promoted; old teams may have
  shifted significantly with summer transfers).
- You've extended `teams.json` for a newly-promoted team and want their
  Elo built into the snapshot.
- You're testing a hyperparameter change.

Re-ingest cadence: only when adding a NEW season or when FDCO publishes a
correction to a past season (rare). The Football-Data.co.uk CSVs for
closed seasons rarely change, so `--force-redownload` is the only case
to worry about.

### 3.2 When to retrain (and when NOT to)

**Retrain** when:

- You've finished a new season (e.g. 2025/26 just ended → re-train with
  it in the training window).
- You've onboarded a new league.
- You've changed Elo config (HFA, K-factor, promoted-team strategy).
- You're testing a Phase 2+ improvement (calibration, MOV, new features).

**Don't retrain** for:

- Live-score updates within a current season — those reflow through the
  Elo + form features at inference time automatically. The model itself
  doesn't change.
- Onboarding a team mid-season (just extend `teams.json`; the next
  inference call will pick it up).

### 3.3 Scripts in `ml/scripts/`

Three useful examples:

- **[demo_predict_one.py](scripts/demo_predict_one.py)** — predict a
  single synthetic fixture with full feature trace. Edit the `HOME` /
  `AWAY` / `KICKOFF` constants at the top. Useful for "what does the
  model think about Match X" debugging.
- **[compare_hfa.py](scripts/compare_hfa.py)** — load two model bundles
  (default: HFA=65 and HFA=0) and run a head-to-head metrics + single-
  fixture comparison. Template for any future ablation (just swap the
  bundle paths).
- **[backtest_2526.py](scripts/backtest_2526.py)** — walk-forward
  backtest on the live 25/26 PL season pulled from the DB. Reuses the
  Node app's `DATABASE_URL` from the root `.env`. Template for evaluating
  a model against any in-progress season.

All three are runnable via `python scripts/{name}.py` from `ml/`.

### 3.4 Troubleshooting

| Symptom                                                         | Most likely cause                                                                      | Fix                                                                                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reconcile --dry-run` fails on a team name                      | New team in CSV; no alias yet                                                          | Look up canonical name in DB or football-data.org; add to `teams.json`                                                                             |
| `train` reports very low mlogloss (~0.5 or below)               | Random split / leakage / `compute_form` using `<=` instead of `<`                      | Verify split is time-based; verify form filter                                                                                                     |
| `predict-and-write` returns 401 on login                        | Wrong password in `.env`, or user not admin                                            | Check DB: `SELECT role FROM users WHERE username='ml_pipeline'`                                                                                    |
| `predict-and-write` returns 400 from `PUT /api/admin/games/:id` | Probability pair doesn't sum to 1.0 ± 0.01                                             | Verify `to_two_way` round-and-rebalance is running; check the test in `tests/test_normalize.py::test_to_two_way_end_to_end_sum_invariant` is green |
| `written=0 skipped=N` when you expected writes                  | All games at non-sentinel already                                                      | Add `--overwrite-existing` if intentional, else verify the games' current probabilities                                                            |
| Model predicts implausible home probs (e.g. always 0.5)         | Elo snapshot is stale OR teams.json maps multiple physical teams to one canonical name | Re-run `elo`; audit `_proposed.json` for accidental auto-merges                                                                                    |
| `Path(__file__).parent / "data"` errors when running a script   | The script was moved without updating the path                                         | Use `get_settings().raw_dir()` instead (handles relocation automatically)                                                                          |

---

## Part 4 — Future-self FAQ

**Q: Should I train one model per league or a single multi-league model?**
A: Per league (current shipped approach). A unified model needs a
meaningful cross-league signal (Champions League / international fixtures)
to calibrate Elo across leagues. Without that, mixing leagues introduces
noise. The pipeline supports both — `train --league CODE` already filters
to a single league — but the unified-pool variant is Phase 4+ work.

**Q: Can I use a different historical data source than Football-Data.co.uk?**
A: Yes, swap the ingest module. The contract is: produce a DataFrame
with columns `[date, home, away, fthg, ftag, ftr, league, season]`.
Everything downstream consumes that. Other free options: Statsbomb open
data (richer, includes xG), clubelo.com (already-computed Elo), various
GitHub scrapes. **Don't** scrape ESPN / PL / FIFA sites — same ToS /
engineering reasons that ruled them out for live data are still in play.

**Q: How do I add a feature?**
A: Three places. (1) Add the column to `FEATURE_NAMES` in
[features/build.py](scorecast_ml/features/build.py). (2) Compute it in
`build_training_features` AND `build_inference_features` — both must
use the same as-of-date filter. (3) Retrain. The model bundle's
`feature_names` field captures the schema so loading old bundles after a
feature change errors loudly. Common candidates: head-to-head historical
PPG, fixture congestion proxies, season-to-date GF/GA, league-position
indicator.

**Q: How do I add bookmaker odds as a feature?**
A: Football-Data.co.uk CSVs already include `B365H` / `B365D` / `B365A`
(Bet365 home/draw/away odds). Parse them in the ingest stage, then add
to the feature matrix. **Warning**: training on bookmaker odds is
circular for ScoreCast's use case — our model would just regress to
Bet365. More useful as a calibration BASELINE in eval (does our model
beat market log-loss? probably not, but it should come close). Phase 4.

**Q: When will Phase 2 (calibration) ship?**
A: When uncalibrated overconfidence becomes a user-visible problem. The
25/26 backtest shows mild overconfidence above 70% predicted probability
(hit rate ~67% when model says ~74%). At ScoreCast's user volume this
costs a measurable amount of payout to confident-correct users. Phase 2
wraps the existing classifier with `CalibratedClassifierCV(method='isotonic',
cv='prefit')` fit on the val set. One-evening change.

**Q: How do I revert if the model writes garbage probabilities?**
A: Run `UPDATE games SET "homeProbability" = 0.5, "awayProbability" = 0.5
WHERE id IN (...)` for the affected games (back to sentinel). The
audit_log has every change with `entityId` so you can scope precisely.
Note: this affects PICKS made between the bad write and the revert —
their `pointsAwarded` will reflect the bad probability. Recompute by
calling `services/PickService.scorePick` for each affected pick.

**Q: Why isn't there a `pip install -e .` setup?**
A: Phase 1 deferred Poetry / installable-package machinery to keep the
bootstrap zero-install. `python -m scorecast_ml ...` works because the
package directory `scorecast_ml/` sits where Python finds it (CWD when
invoked from `ml/`, or via the `sys.path.insert` shim at the top of each
`scripts/*.py`). Phase 2 will move to Poetry which auto-handles this.

**Q: How big are the artifacts (models, snapshots)?**
A: Per league, per training run:

- `{league}_{date}.joblib`: ~280-300 KB
- `{league}_{date}.parquet` (Elo snapshot): ~5-10 KB per league
- `{league}_{season}.csv` (cached source): ~50-500 KB per season-league

A full five-league deployment with 30 seasons of history each: ~75 MB of
cache, ~2 MB of trained models. All gitignored.

**Q: How does the audit-log volume scale with N leagues?**
A: One audit_log row per (game, write). 18 fixtures per weekend × N
leagues × 52 weeks = ~1000 rows/league/year. Five leagues = ~5000
rows/year. Audit_log is JSONB; each row is < 200 bytes. ~1 MB/year of
audit traffic — negligible.

**Q: What's the minimum viable training data for a new league?**
A: Empirically: 5 seasons (~1900 matches for a 20-team league). Below
that, the early-stopping rounds-30 patience kicks in too aggressively
because the model can't learn enough patterns. The 5-season reference
window (2004/05-2008/09) is conservative — it gives a clear 15-season
test window for evaluation. If you only have 3 seasons of FDCO data,
use 2 for train + 1 for val + (live API current season) for inference.
