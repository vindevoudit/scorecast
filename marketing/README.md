# Bantryx — Social Media Marketing Kit

Ready-to-post, on-brand graphics for the Bantryx launch campaign. Everything in
[`out/`](out/) is generated from committed SVG templates + the bundled brand fonts, so
you can tweak copy/colours and re-render the whole set in one command.

```bash
npm run assets:marketing       # → marketing/out/*.png
```

- **Edit copy** (headlines, features, stats, steps): the `FEATURES` / `STATS` / `STEPS`
  arrays near the top of [`scripts/generate-marketing-assets.mjs`](../scripts/generate-marketing-assets.mjs).
- **Edit colours / wordmark / icons / type**: [`marketing/lib/brand.mjs`](lib/brand.mjs)
  (`COLOR`, `FONT`, `wordmark`, `brandTag`, `iconBadge`).
- **Full maintainer guide** — how the system is built and how to modify graphics or add new
  ones (fragment API, icon system, layout renderers, the live favicon/PWA/OG pipeline):
  **[GRAPHICS.md](GRAPHICS.md)**.
- **Fonts** ([`fonts/`](fonts/)): Orbitron (BANTRYX wordmark + B mark), Bebas Neue
  (headlines + big numbers), Inter (body) — all **SIL OFL 1.1**, free to embed and
  redistribute. Fed to the rasterizer directly so type renders in the real brand faces
  (not a system fallback). Icons are clean Lucide-style geometry (ISC-licensed) with a
  cyan glow.

---

## Asset index

All squares are **1080×1080** (IG/FB feed, carousels), stories **1080×1920**
(IG/FB/TikTok stories & reels).

| File                                       | Size       | Use it for                                                                            |
| ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------- |
| `launch-square.png`                        | 1080×1080  | Launch-day feed hero (IG/FB)                                                          |
| `launch-story.png`                         | 1080×1920  | Launch-day story/reel                                                                 |
| `launch-x.png`                             | 1600×900   | Launch tweet / X post image                                                           |
| `launch-card.png`                          | 1200×630   | Link-preview / OG card, LinkedIn, Discord, Slack                                      |
| `profile-pic.png`                          | 1080×1080  | Profile / display picture — centred wordmark, safe for a circle crop (IG/X/FB avatar) |
| `feature-scoring-square/-story.png`        | sq + story | Probability scoring (+62 for a 38% upset)                                             |
| `feature-groups-square/-story.png`         | sq + story | Private groups & friends                                                              |
| `feature-leaderboards-square/-story.png`   | sq + story | Live leaderboards                                                                     |
| `feature-badges-square/-story.png`         | sq + story | Badges & milestones                                                                   |
| `howto-square.png` / `howto-story.png`     | sq + story | 3-step "how it works" explainer                                                       |
| `share-to-story-square.png` / `-story.png` | sq + story | UGC prompt: "Share your pick to your story and tag us @bantryx.app"                   |
| `stat-62-square/-story.png`                | sq + story | Teaser: **+62** points for a 38% underdog                                             |
| `stat-groups-square/-story.png`            | sq + story | Teaser: **∞** private groups                                                          |
| `stat-30s-square/-story.png`               | sq + story | Teaser: **30s** to first pick                                                         |
| `stat-free-square/-story.png`              | sq + story | Teaser: **$0** free to play, no betting                                               |
| `flyer-a4.png`                             | 2480×3508  | Printable A4 poster (300 dpi) with scannable QR → bantryx.com                         |
| `product-gamecard-upcoming.png`            | 1080×1080  | Real GameCard — upcoming game: odds + pick buttons                                    |
| `product-gamecard-live.png`                | 1080×1080  | Real GameCard — live score + your points on the line                                  |
| `product-gamecard-final.png`               | 1080×1080  | Real GameCard — final result, winning pick + points                                   |
| `product-game-lifecycle.png`               | 1080×1920  | One fixture, all 3 states stacked (pick → live → result)                              |
| `product-leaderboard.png`                  | 1080×1080  | Leaderboard snapshot — rank medals + points (5 rows)                                  |
| `product-leaderboard-story.png`            | 1080×1920  | Leaderboard snapshot — full 8-row table                                               |
| `product-stats.png`                        | 1080×1080  | Stats page — profile header + 5 stat tiles + recent activity                          |
| `product-stats-story.png`                  | 1080×1920  | Stats page — full profile with 3 recent-activity rows                                 |
| `product-stats-charts.png`                 | 1080×1080  | Stats dashboard — points-over-time line chart + summary tiles                         |
| `product-stats-charts-story.png`           | 1080×1920  | Stats dashboard — line chart + per-league bars + heatmap                              |
| `thankyou-square.png` / `-story.png`       | sq + story | **Live** — "Thank you · {N}+ players and counting" (real user count, rounded down)    |
| `picks-vs-model-<home>-vs-<away>-*.png`    | sq + story | **Live** — one per upcoming game: crowd pick split vs the model's probabilities       |
| `kickoff-countdown-*.png`                  | sq + story | **Live** — "get your picks in" urgency card for the next fixture + a big countdown    |
| `halftime-*.png`                           | sq + story | **Live** — halftime scoreboard for an in-progress match (big Orbitron score)          |
| `fulltime-*.png`                           | sq + story | **Live** — full-time result: final score + points a correct pick earned               |

> **Live-data assets** (`thankyou-*`, `picks-vs-model-*`, `kickoff-countdown-*`, `halftime-*`,
> `fulltime-*`) are pulled from production rather than baked-in copy — see
> **[Live-data assets](#live-data-assets)** below.

> **Product mockups** are faithful re-creations of the live app UI (real dark-theme
> tokens, real component layout) populated with past Premier League fixtures + fake users.
> They're the most credible "here's what you actually get" assets — lead with them.

> **Flyer printing**: `flyer-a4.png` is 300 dpi A4. Print "actual size / 100%" (not
> "fit to page") so the QR stays crisp. The QR encodes `https://bantryx.com` and includes
> a white quiet-zone border — don't crop into the white frame.

---

## Suggested captions

Keep the voice **playful, confident, no-gambling**. Always close with the link.

**Launch**

> ⚽ Bantryx is live. Predict football, outpick your group chat, and climb the live
> leaderboard — no betting, just bragging rights. Free to play. → bantryx.com

**Feature — scoring**

> Pick smart, not safe. On Bantryx a 38% underdog upset is worth **+62 points** — favourites
> far less. The braver the call, the bigger the climb. → bantryx.com

**Feature — groups**

> Your group chat has opinions. Settle it. Spin up a private Bantryx league and race your
> mates on your own leaderboard. → bantryx.com

**Feature — leaderboards**

> Full-time whistle = instant standings. Bantryx leaderboards update the second a result
> lands. No waiting until Monday. → bantryx.com

**Feature — badges**

> Streaks. Upsets. Perfect weekends. 100-point picks. Collect the badges, collect the
> bragging rights. → bantryx.com

**How-to**

> New here? Three steps: 1) sign up free 2) pick your winners 3) climb the rankings.
> That's it. No catch, no paywall. → bantryx.com

**Share to story** (pair with `share-to-story-*`)

> Made your picks? Show them off. Screenshot your pick, drop it on your story, and tag
> **@bantryx.app** — we reshare the best calls. → bantryx.com

**Product — game lifecycle** (pair with `product-game-lifecycle` or the 3 `product-gamecard-*`)

> This is the whole game: back Aston Villa at 34% → +66 points when they pull off the upset.
> Pick before kickoff, watch it live, climb the table at full-time. → bantryx.com

**Product — leaderboard** (pair with `product-leaderboard*`)

> Climb your group's table on correct picks × probability — the riskier the call, the faster
> you rise. → bantryx.com

**Product — stats page** (pair with `product-stats*`)

> Your whole season at a glance: total points, win rate, best streak, and every pick you've
> made. Track it all on Bantryx. → bantryx.com

**Product — stats charts** (pair with `product-stats-charts*`)

> Real analytics, not just a number. Points over time, win-rate trends, per-league
> breakdowns, and your pick-time heatmap. → bantryx.com

**Stat teasers** (short, punchy — pair with the matching `stat-*` graphic)

> +62 points for backing a 38% underdog. Reward the brave call. → bantryx.com
> ∞ private groups. Build a league for every group chat. → bantryx.com
> 30 seconds from sign-up to your first pick. → bantryx.com
> $0. Free to play. No betting. Just football. → bantryx.com

---

## Hashtags

Mix a few from each row; don't dump all of them.

- **Core**: `#Bantryx` `#NoBettingJustBantryx` `#FootballPredictions` `#PredictionGame`
- **Football**: `#Football` `#Soccer` `#PremierLeague` `#MatchDay` `#FootballFans`
- **Community**: `#GroupChat` `#Leaderboard` `#BraggingRights` `#FantasyFootball`

---

## Sample 2-week launch cadence

| Day | Post                       | Asset                                                |
| --- | -------------------------- | ---------------------------------------------------- |
| 1   | Launch announcement        | `launch-square` + `launch-story` (+ `launch-x` on X) |
| 2   | How it works               | `howto-square` / `howto-story`                       |
| 4   | Hook: scoring              | `stat-62-square` + `stat-62-story`                   |
| 6   | Feature: scoring deep-dive | `feature-scoring-square/-story`                      |
| 8   | Hook: groups               | `stat-groups-*`                                      |
| 9   | Feature: groups            | `feature-groups-*`                                   |
| 11  | Feature: live leaderboards | `feature-leaderboards-*`                             |
| 12  | Hook: 30s to first pick    | `stat-30s-*`                                         |
| 13  | Feature: badges            | `feature-badges-*`                                   |
| 14  | Re-CTA / "$0 to play"      | `stat-free-*` + repost `launch-card` in bio link     |

Use `launch-card.png` wherever a link unfurls (X, Discord, Slack, LinkedIn, WhatsApp) — it
matches the site's OG image. Pin the flyer in real-world spots (clubhouses, campus boards,
group-chat screenshots).

---

## Live-data assets

`thankyou-*`, `picks-vs-model-*`, `kickoff-countdown-*`, `halftime-*`, and `fulltime-*` are
generated from **real production data** when a
`DATABASE_URL` is present in the environment; otherwise the generator falls back to
baked-in sample numbers so the full kit still renders offline (the rest of the kit is
unaffected either way). Read-only — the generator never writes to the DB.

### Generate with live data (full walkthrough — PowerShell / Windows)

```powershell
cd "C:\Users\vinde\OneDrive\Desktop\ScoreCast"

# 1. Auth to Azure (skip if already logged in — opens a browser)
az login

# 2. Pull the prod DB URL from Key Vault into the env var
#    (the stored value already includes ?sslmode=require)
$env:DATABASE_URL = az keyvault secret show --vault-name scorecast-kv-p3aaelev7xp --name database-url --query value -o tsv

# 3. Clear last run's per-game cards so you only get the current slate
Remove-Item marketing/out/picks-vs-model-* -ErrorAction SilentlyContinue

# 4. Generate the kit — watch for: "live data: <N> users, <M> upcoming game(s)"
npm run assets:marketing

# 5. Clear the prod URL from your shell when done
Remove-Item Env:\DATABASE_URL

# 6. Review the output
explorer marketing\out
```

bash equivalent for steps 2 + 4:

```bash
export DATABASE_URL="$(az keyvault secret show --vault-name scorecast-kv-p3aaelev7xp --name database-url --query value -o tsv)"
npm run assets:marketing
unset DATABASE_URL
```

**Offline test** (sample data, no DB — just to confirm the pipeline): `npm run assets:marketing`.
You'll see `DATABASE_URL not set — using sample data for live assets`.

> **If step 4 hangs / times out** the prod Postgres firewall isn't allowing your current
> IP. Add a rule for it, re-run step 4, then optionally remove it:
>
> ```powershell
> $ip = (Invoke-RestMethod https://api.ipify.org)
> az postgres flexible-server firewall-rule create --resource-group scorecast-prod --name scorecast-pg-p3aaelev7xp52 --rule-name local-marketing --start-ip-address $ip --end-ip-address $ip
> # ...generate, then:
> az postgres flexible-server firewall-rule delete --resource-group scorecast-prod --name scorecast-pg-p3aaelev7xp52 --rule-name local-marketing --yes
> ```

What they pull:

- **`thankyou-*`** — `SELECT COUNT(*) FROM users`, displayed rounded **down** to a clean
  milestone (e.g. 247 → `200+`; under 50 shows the exact number).
- **`picks-vs-model-<home>-vs-<away>-*`** — one card per **upcoming** (scheduled) game:
  the crowd's pick split (Home vs Away — picks are winner-only) over the model's 3-way
  probabilities (Home / Draw / Away). Placeholder fixtures (`TBD`, `Winner of …`) and
  games still at the model's neutral sentinel are skipped. Games with zero picks render a
  "No picks yet — be the first" state.
- **`kickoff-countdown-*`** — a "get your picks in" urgency card for the **soonest**
  upcoming fixture (`ORDER BY date ASC` → first row), with a big Orbitron countdown
  ("KICKS OFF IN / 3 / HOURS") computed live from its kickoff time. Offline it falls back
  to the Mexico vs South Africa / 3-hour sample (`SAMPLE_COUNTDOWN`).
- **`halftime-*`** — a halftime scoreboard for an **in-progress** match (`status =
'in-progress'` with a score on the board, preferring a game that has reached the break),
  with the score in big Orbitron. Run it during the interval — the "HALF TIME" label is
  fixed, so the operator is responsible for the timing. Offline it falls back to the
  Brazil 1-0 France sample (`SAMPLE_HALFTIME`).
- **`fulltime-*`** — a full-time result card for the most recent **finished** decisive
  game: final score (winner bright, loser dimmed) + the points a correct pick earned,
  computed as `(1 − winning_probability) × 100` (mirrors `lib/scoring.js` — an underdog
  win shows a bigger number). Draws show "Both sides earn partial points" instead of a
  figure. Offline it falls back to the Brazil 2-1 France / +62 sample (`SAMPLE_FULLTIME`).

> ⚠️ **Pre-kickoff crowd**: in the app the crowd split is hidden until kickoff (anti-bias).
> These marketing cards read the DB directly, so they **do** reveal pre-kickoff sentiment —
> that's intentional for promo use, but don't screenshot one back into a product context.

> The DB is read once at the start, then closed. A missing/unreachable DB degrades to the
> sample data rather than aborting the run — watch the console for `live data:` vs
> `using sample data`.

> **Housekeeping**: per-game files are named by team slug, so a new matchday slate adds new
> files rather than overwriting last week's. Sweep stale ones with
> `rm marketing/out/picks-vs-model-*` before a fresh `npm run assets:marketing` if you want
> only the current slate.

---

## Matchday automation (auto-generate + email)

Instead of running the CLI by hand each matchday, the app can generate the four live-fixture
graphics for **every worthwhile match** automatically, at the right moment, and **email** them
to you so you just download + post (there's no IG/TikTok story API to auto-post through). It's an
in-container cron job — [lib/jobs/postMatchdayGraphics.js](../lib/jobs/postMatchdayGraphics.js),
every 5 min — that shares the exact same renderers as the CLI ([marketing/lib/render.mjs](lib/render.mjs)),
so the emailed PNGs are byte-identical to `npm run assets:marketing`.

**Triggers** (one email per type per tick, batched across all due matches in active leagues):

| Type             | Fires when                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `countdown`      | scheduled game, kickoff in **1h55m–2h** away ("get your picks in")                                                            |
| `picks-vs-model` | scheduled game, kickoff in **5–10 min** (crowd formed) — skipped if no one picked, or on placeholder / sentinel-prob fixtures |
| `halftime`       | in-progress game at the break (`halfTimeReached`, elapsed **45–65 min**)                                                      |
| `fulltime`       | finished game with a result + scores, kickoff within the **last 5h** (cold-start guard)                                       |

Each due match is sent at **square (1080²) + story (1080×1920)**, attachments named e.g.
`fulltime-brazil-vs-france-square.png`. Idempotency is a `marketing_posts (gameId, type)` ledger —
each match fires **once per type**, stamped only after a successful send (a transient email
failure retries next tick).

**Enable it** (set on the Container App, or locally in `.env`):

```bash
MARKETING_AUTOMATION_ENABLED=1          # gate — unset/0 = disabled (default)
MARKETING_EMAIL_TO=you@example.com      # recipient inbox
# Reuses the existing Resend transport: RESEND_API_KEY + EMAIL_FROM.
# Optional: MARKETING_GRAPHICS_CRON (default '*/5 * * * *' — don't slow below 5 min
# or countdown graphics, whose window is exactly one tick wide, get missed).
```

In prod, set `marketingAutomationEnabled` + `marketingEmailTo` on the Bicep `app` module
([infra/main.bicep](../infra/main.bicep) → [app.bicep](../infra/modules/app.bicep)), or flip them
directly with `az containerapp update --set-env-vars`. Without a `RESEND_API_KEY` the job still
renders + logs (dev log-mode) but sends nothing.

> The rasterizer (`@resvg/resvg-js`) is a **prod dependency** and `marketing/lib` + `marketing/fonts`
> are COPY'd into the runtime image ([Dockerfile](../Dockerfile)) so the container can render. The
> CLI's `out/` dir is **not** shipped — the job renders to in-memory buffers and emails them.

**Test a real send immediately** (renders the current real slate + emails it now, instead of
waiting for a tick):

```bash
MARKETING_AUTOMATION_ENABLED=1 MARKETING_EMAIL_TO=you@example.com \
  node -e "require('./lib/jobs/postMatchdayGraphics').run().then(r=>console.log(r))"
```

> Same anti-bias caveat as the CLI cards: `picks-vs-model` reveals pre-kickoff crowd sentiment.
> These emails go only to the operator, so that's fine — just don't screenshot one back into a
> product context.

---

## Regenerating

The 29 core assets are deterministic — re-running produces identical PNGs (the two
live-data asset types above reflect the DB at run time). To change anything:

1. Edit copy in `scripts/generate-marketing-assets.mjs` (content arrays) or brand tokens
   in `marketing/lib/brand.mjs`.
2. `npm run assets:marketing`
3. The 29 PNGs in `out/` are overwritten in place.

To add a new format, add an entry to `SIZE` and a `renderX` layout function, then an
`emit(...)` call in `main()`.
