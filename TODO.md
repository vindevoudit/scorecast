# TODO

Working backlog for ScoreCast / Bantryx. Ordered by urgency, not by tier number.

- **[verify]** = could not be confirmed from the repo (depends on live Azure/prod state).
  Check first, then tick or action.
- Every written plan — tier files and named plans, ScoreCast and otherwise — is accounted
  for in the [Plan file index](#appendix--plan-file-index), so nothing is lost.

## Where the plans live

Planning docs sit in **three** places. The tier files are **not** in `.claude\plans\` — that
is the single most likely thing to send someone hunting.

| #   | Location                                                          | Holds                                                                                                                                                                                                                                                                           | Authority                |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | `C:\Users\vinde\OneDrive\Desktop\ScoreCast Claude Archive\plans\` | **All tier files** — `tier33.md` (master), `ROADMAP.md`, `tier-archive.md`, `supertier30.md`, `tier7/10/12/14/15/16/23/26/32`, `tierCoinFlipParked.md`, `tierStreakRework.md`                                                                                                   | **LIVE** — use this      |
| 2   | `C:\Users\vinde\.claude\plans\`                                   | The 9 newest **named** plans. Shared across all of the user's projects — only 4 are ScoreCast                                                                                                                                                                                   | **LIVE** for named plans |
| 3   | Repo root                                                         | [CLAUDE.md](CLAUDE.md) (working reference), [SHIPPED.md](SHIPPED.md) (shipped narrative, 22 entries), [ARCHITECTURE.md](ARCHITECTURE.md), [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md), [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md), [ACCESSIBILITY.md](ACCESSIBILITY.md), this file | **LIVE**                 |

**Stale sibling folders inside `ScoreCast Claude Archive\` — do not execute from these:**
`Plans as of 2805\` · `Updated Files\` · `old\` · `more plans\` · `Live Plans as of 2205\` ·
`Archived as of 17052026\`. All six hold overlapping older copies of the same tier files
(`old\tier10.md` and `plans\tier10.md` are different vintages of one document). Consolidating
them is a hygiene item in §7.

**Two reading rules:**

1. **`tier33.md` supersedes `ROADMAP.md`.** Tier 33 is dated 2026-06-01; ROADMAP 2026-05-31.
   Keep ROADMAP only for its shipped record.
2. **A tier file states intent at drafting time — verify against the repo before executing.**
   Tier 32 reads as fully unshipped; half of it is already live in `LeaderboardService`.

## Contents

0. [Where the plans live](#where-the-plans-live)
1. [Time-critical](#1--time-critical)
2. [Planned but not built](#2--planned-but-not-built)
3. [Tier 33 — the long-range plan](#3--tier-33--the-long-range-plan)
4. [Operator actions — verify then tick](#4--operator-actions--verify-then-tick)
5. [Broadcast email](#5--broadcast-email)
6. [Dependencies](#6--dependencies--11-open-dependabot-prs)
7. [Repo hygiene](#7--repo-hygiene)
8. [Recurring obligations](#8--recurring-obligations-tier-33-track-d)
9. [Backlog registers](#9--backlog-registers-tier-33-tracks-a-b-c)
10. [Known issues](#10--known-issues--accepted-not-scheduled)

_Last swept: 2026-08-04._

---

## 1 — Time-critical

- [ ] **Deploy Tier 34 + import the CPL fixtures — the tournament starts 2026-08-07.**
      Cricket is built and merged locally but not pushed. After deploying:
  1. Migrations run automatically via the CD migrate job (three additive migrations).
  2. `node scripts/import-cricket-fixtures.mjs data/cpl-2026-fixtures.json` against the
     **production** `DATABASE_URL`. Idempotent — `--dry-run` first. This creates the
     league (active), the 2026 season, and all 39 fixtures.
  3. Spot-check a few kickoff times in the admin panel. Jamaica venues are UTC-5, every
     other Caribbean venue is UTC-4 — that is the one thing worth eyeballing.
  4. Results are entered by hand per match: admin → Games → **Enter result**.
  5. Rename the four playoff placeholder slots ("TBD (3rd place)", "Winner of Qualifier 1"
     …) through the admin game editor once the league table settles, around 13 Sep.
- [ ] **Reactivate Premier League for 2026/27 — OVERDUE.** PL was set `active=false`
      during the 2026-05-28 beta→launch reset so the off-season cron couldn't resurrect
      deleted games. The 2026/27 season kicks off **mid-August**, so this is the most
      time-sensitive item on the list. (Tier 33 Track D-1 + D-5.) Three parts:
  1. Admin → League Manager → set PL `active=true`, then **Sync** to pull 2026/27 fixtures.
  2. Retrain the PL model — update `ml/data/raw/PL_*.csv`, run
     `cd ml && python -m scorecast_ml train --league PL`, copy the output to
     [lib/ml/models/PL_elo.json](lib/ml/models/PL_elo.json), commit, push.
  3. Elo carries across seasons, so a full team-table rebuild is **optional**. Only
     delete + re-seed PL `teams` rows if you deliberately want a reset.
     - Promoted sides enter at `min(elo)` automatically (`LeagueService.ensureTeamExists`).

- [ ] **Push the 3 local commits.** `main` is **3 ahead of `origin/main`**; pushing triggers
      CD (build → migrate → roll out → `/healthz` smoke). No migrations in this batch.
  - `ad53bc2` feat(marketing): Three.js commercial + eslint wiring + NUL-byte fix
  - `101a8c1` feat(scripts): campaign broadcast mailer
  - `6cff095` docs: this file

- [ ] **Merge `fix/seed-empty-db-not-null`** (local branch, commit `e1d4e42`). Held until
      after the World Cup, which ended 2026-07-19, so the hold is expired. Inert in prod —
      it only affects seeding an empty database.

---

## 2 — Planned but not built

Written plans with nothing shipped against them.

### 2a. Native iOS + Android apps via Capacitor — **not started**

Plan: `make-a-plan-to-imperative-adleman.md` (2026-07-20). Verified nothing exists — no
`capacitor.config.ts`, no `ios/`, no `android/`, no `src/lib/apiBase.js`, no Capacitor or
`firebase-admin` dependency.

**This plan post-dates tier33 by ~7 weeks, so the roadmap below does not account for it.**
It's the newest stated direction and the largest unbuilt piece of work — sequence it against
Tier 33 deliberately rather than assuming either takes precedence.

**Three constraints that drive the whole design** — re-read before starting:

1. The frontend is **hardcoded to same-origin `/api`**. Every call is a relative
   `fetch('/api/...', { credentials: 'include' })`. Bundled assets on a local scheme would
   send those to themselves, so a configurable API base URL is a prerequisite.
2. Auth cookies are `HttpOnly` + `SameSite=Lax` + host-only, so they're **never sent
   cross-origin from `capacitor://`**. Capacitor's native HTTP layer sidesteps this via the
   OS cookie jar — no backend cookie-flag changes needed. One wrinkle: CSRF reads `sc_csrf`
   from `document.cookie`, which won't exist natively.
3. **Web Push cannot work in a native WebView** — no `PushManager`, no service worker. Native
   push must be built from scratch; the existing Web Push path stays for PWA users.

- [ ] **Phase 0 — accounts + tooling** (parallel with code work). Apple Developer $99/yr,
      Google Play $25 once, Firebase project (free tier), APNs `.p8` key uploaded to Firebase
      so FCM relays to both platforms under one token model. Reserve `com.bantryx.app`.
      **No Mac needed** — iOS builds run on a GitHub Actions `macos-latest` runner.
- [ ] **Phase 1 — scaffolding.** Deps, `capacitor.config.ts` (`webDir: 'dist'`,
      `CapacitorHttp` enabled, no `server.url` — bundled, not remote), `cap add ios/android`,
      `build:app` script, icons/splash from [public/logo.svg](public/logo.svg).
- [ ] **Phase 2 — configurable API base + native HTTP auth.** New `src/lib/apiBase.js`
      threaded through the four request entry points; platform-aware `getCsrfToken()`.
      **Defaults to empty so the PWA is byte-for-byte unchanged** — that regression check is
      the gate on this phase.
- [ ] **Phase 3 — native push (FCM + APNs).** `native_push_tokens` table + model,
      `POST/DELETE /api/push/register-native`, `firebase-admin` with the graceful-no-op
      pattern. Extend `PushService.sendToUser` to fan out after the web-push pass.
      **No call-site changes** — every existing notification reaches native for free.
- [ ] **Phase 4 — native UX polish.** Status bar + splash, Android back button,
      `@capacitor/share`, external links to system browser, universal links.
- [ ] **Phase 5 — build, sign, submit.** Android keystore → AAB → Play internal testing.
      iOS via Actions macOS runner + fastlane → TestFlight → review. Bundled content plus
      native push is what satisfies Apple Guideline 4.2.

### 2b. Three.js commercial — follow-ups

Commercial shipped (`ad53bc2`); the plan flagged two optional extras.

- [ ] **Fully-offline variant** — vendor `three.module.js` + self-host fonts. Today the CDN
      import-map needs a connection on first view.
- [ ] **Capture a screen recording of the loop** — the plan named this the actually shareable
      deliverable (an `.mp4` travels where a localhost URL doesn't).

---

## 3 — Tier 33 — the long-range plan

`tier33.md` (drafted 2026-06-01, 931 lines) consolidates **everything planned-but-unshipped**
across Tier 7 / 10 / 12 / 14 / 15 / 16 / 9.10 / 9.11 / 23 / 25 levers / 26 / 30 / 31 / 32,
plus new ideas. **It supersedes `ROADMAP.md`** (2026-05-31) — use tier33 as the master.

Status column reflects what's actually in the repo as of this sweep.

| #   | Phase                                 | Size    | Cost       | Status                     |
| --- | ------------------------------------- | ------- | ---------- | -------------------------- |
| 0   | Pre-launch operational hardening      | ~3 hr   | $0         | **Open** — detail below    |
| 1   | Bug squash & UI polish wave           | ~2–3 d  | $0         | **Open** — detail below    |
| 2   | Win-streak on leaderboards (Tier 32)  | ~3 hr   | $0         | **Partial** — detail below |
| 3   | Engagement C2–C4 (Tier 30 Phase 3)    | ~3–4 d  | $0         | **Open**                   |
| 4   | Social depth core (Tier 30 Phase 4)   | ~1–2 wk | $0         | **Open**                   |
| 5   | Polish + final shape (Tier 30 5.2)    | ~2–3 d  | $0         | **Open**                   |
| 6   | Marketing graphics kit (Tier 31)      | ~1 d    | $0         | ✅ **Shipped** 2026-06-11  |
| 7   | Direct messages (Tier 30 Phase 6)     | ~1 wk   | $0         | **Open**                   |
| 8   | Email channel + notification prefs UI | ~3–4 d  | $0         | **Open**                   |
| 9   | Observability + Redis                 | ~1–2 wk | +$16–32/mo | **Open** — gates Phase 10  |
| 10  | SSE realtime + dedup + live reactions | ~1–2 wk | $0         | **Open** — needs Phase 9   |
| 11  | Monetization (Pro + ads, Tier 12)     | ~3–4 wk | revenue    | **Open**                   |
| 12  | Growth (SEO + marketing, Tier 14+15)  | ~5–7 wk | $0         | **Open**                   |
| 13  | Inclusion (i18n + high-contrast)      | ~2–3 wk | ~$300–500  | **Open** — parallelizable  |
| 14  | TypeScript + Storybook (9.10 + 9.11)  | ~5–8 wk | $0         | **Open** — long-deferred   |

Not in the table because they post-date tier33 and shipped anyway: **Trophy Cabinet**
(2026-07-06) and **Aftermatch / WC Wrapped** (2026-07-21). Note Track B-5 proposes a
_different_ "trophy cabinet" (best picks / biggest upsets / longest streaks) from the
per-stage WC one that shipped — still open if you want it.

### Phase 0 — pre-launch operational hardening (~3 hr, $0)

The old "security hardening" section of this file was the same work; merged here. All
dashboard/drill/runbook except 0.4. Verified none of it is done: no `OPS_RUNBOOK.md`, no
`public/.well-known/`, `public/app.js` still present.

- [ ] **0.1 Postgres restore drill** (~1 hr). Portal → point-in-time restore ~1h back into a
      throwaway RG → add laptop IP to firewall → `psql` → sanity quartet (`\dt`,
      `COUNT(*) FROM users`, `MAX("createdAt") FROM picks`, `SequelizeMeta` top 5). Populated
      data = mechanism proven. **Document RTO in a new `OPS_RUNBOOK.md`** (~35 min expected),
      then **delete the throwaway RG**. Calendar +90 days.
- [ ] **0.2 `security.txt` + `security@bantryx.com`** (~30 min). Cloudflare Email Routing
      forwarder, then `public/.well-known/security.txt` per RFC 9116 (`Contact:`, `Expires:`
      2027-05-28, `Preferred-Languages`, `Canonical`). Calendar yearly for renewal.
- [ ] **0.3 HSTS preload submission** (~5 min). Submit `bantryx.com` at hstspreload.org.
      The D+30 window opened **2026-06-27** — that has long passed, so this is submittable
      now. One-way door; document the removal procedure.
- [ ] **0.4 Delete the dead legacy vanilla-JS app** (~10 min). `public/app.js`,
      `public/styles.css`, `public/index.html`, `public/help/` — the pre-React predecessor.
      Vite copies `public/*` into `dist/`, so it's served as inert static today. Not
      exploitable (nothing loads it) but it carries DOM-XSS `innerHTML` patterns and bloats
      the image. **Confirmed still present.** Verify `dist/` no longer has them + SPA loads.
- [ ] **0.5 Sentry alert routing** (~30 min). Verify `SENTRY_DSN` in Key Vault, trigger a
      deliberate 500, then three rules: `/api/auth/*` 5xx, `/api/login` 401 > 50 in 5 min,
      `tags[client_error]:true` > 30 in 5 min. Send one test notification per rule.
- [ ] **0.6 Secrets rotation runbook** (~1 hr). Extend `OPS_RUNBOOK.md` with a section per
      secret — `JWT_SECRET`, `RESEND_API_KEY`, `FOOTBALL_DATA_API_KEY`, `VAPID_PRIVATE_KEY`
      (+ public-key Bicep lockstep), `pgAdminPassword`. Practice on the lowest-impact one
      (`FOOTBALL_DATA_API_KEY`) and record actual elapsed time.
- [ ] **0.7 App Insights alerts** (~15 min; Tier 25 A7). Three portal rules: 5xx > 1% over
      5 min, `/readyz` failures > 0 in 5 min, replica count pinned at `maxReplicas` 10+ min.

### Phase 1 — bug squash & UI polish wave (~2–3 d, $0)

Tier 26 P1 remainder plus the small items from the 2026-05-18 pre-ship review. Each is 1–3
files. Four P1 items already shipped in Tier 30 Phase 5 Chunk 5.1 and are excluded.

- [ ] **1.1** Lock-payout copy — extend "Payout locks in at kickoff" into `LockedPickChip`
      so it reads `Locked at kickoff · +N pts` (P1-1).
- [ ] **1.2** Anonymous draft persistence — `sessionStorage` for comment + group-form drafts
      keyed `(scope, scopeId)`, restored after the sign-in gate (P1-2).
- [ ] **1.3** Comment author snapshot — migration `comments.authorDisplay VARCHAR NULL`,
      written at create, served when the author is deleted instead of literal "Unknown".
      No backfill (P1-3).
- [ ] **1.4** OnboardingTour fail-open — hide locally even if the POST fails (P1-6).
- [ ] **1.5** Reaction optimistic rollback — restore the captured pre-mutation row in `catch`
      instead of a full refetch; keep `load()` for 5xx only (P1-7).
- [ ] **1.6** JoinGroupPasswordDialog eventual consistency — on error refresh discover +
      groups; if now a member, show success and close (P1-8).
- [ ] **1.7** "Reconnecting…" pill when any request exceeds 1.5 s (P1-10). **Check first
      whether `minReplicas=1` already removed the need** (Track B-47).
- [ ] **1.8** ProfileDrawer `finally` ordering — move `setProfileLoading(false)` outermost
      (P1-11).
- [ ] **1.9** Mobile chip overflow at 360 px — `truncate` + `min-w-0` on team-name cells,
      plus a mobile-viewport screenshot spec (P1-12).
- [ ] **1.10** GamesCalendar date clamp — clamp `?date=` to ±90 days, fall back to today with
      a one-time status message (P1-13).
- [ ] **1.11** Mass-mark-read 429 fallback — nudge "Mark all read" past 10 unread; on 429
      queue `markAll` (P1-15).
- [ ] **1.12** Rewrite the L6 bidi/zero-width/control char class in
      [validation/schemas.js](validation/schemas.js) as explicit `\u` escapes. Functionally
      identical; removes an invisible-character footgun. _(Same class of bug as the NUL byte
      just fixed in `fetch-data.mjs`.)_
- [ ] **1.13** Forgot-password background logger — use module-level `logger`, not `req.log`,
      inside the `setImmediate` block (the request context is over after `res.end()`).
- [ ] **1.14** Sentry `beforeSend` — handle string-shaped `request.headers` in `scrub()`.
- [ ] **1.15** `GroupService.invite` returns 400 on unknown user; should be 404. Update the
      API test that asserts the current behaviour.

### Phase 2 — win-streak on leaderboards (~3 hr) — **partially shipped**

Verified: `currentWinStreak` **is** in the `LeaderboardService` projections and row shape,
and `LeaderboardCard` renders a streak chip. So 2.1 + 2.2 landed. The rest did not.

- [ ] **2.3 + 2.4** Sort-by-streak — no `sortBy` handling in `LeaderboardService` or
      `routes/leaderboard.js`, and no sort-toggle component. Both still open.
- [ ] **2.5** Per-filter streak (Option B) — streak recomputed on the fly for a
      league/season-filtered board rather than showing the global streak.

### Phases 3–5 — engagement, social depth, polish

- [ ] **Phase 3 (~3–4 d)** — C2 ML model agreement chip (`🤖 Model favours Home (62%)`, then
      a post-settle verdict row); C3 watchlist/follow teams (`user_team_follows` + new
      `FollowService` + `routes/follows.js` + kickoff reminders for followed teams); C4 match
      preview cards (`games.previewSnapshotJson` precomputed at `upsertFixture`, form + H2H +
      Elo gap). **Verified none exist.**
- [ ] **Phase 4 (~1–2 wk)** — B1 head-to-head challenges (`head_to_head` table + `H2HService` + auto-resolve cron + `h2h-result` push); B2 group polls; B3 pick rationale notes
      (`picks.rationale`, **must** carry the `noProfanity` refine); B6 pinned group messages
      (`comments.isPinned` + partial unique index).
- [ ] **Phase 5 (~2–3 d)** — D1 accent colour theming (`users.themeAccent`, 6 palettes over
      the single `--accent` token); D2 onboarding tour V2 covering streaks + badges; D3
      bespoke illustrated empty states.

### Phases 7–14 — later

- [ ] **Phase 7 — Direct messages (~1 wk).** 1:1 chat reusing `comments` with a `'dm'` scope + `dm_threads`, friend-to-friend only, `noProfanity`, `dm-received` push, read receipts.
      **Riskiest migration in the tier**: dropping and recreating `comments_one_scope_chk` for
      three scopes.
- [ ] **Phase 8 — Email channel + notification prefs UI (~3–4 d).** `notification_prefs`
      table (type × channel), transactional email templates, weekly digest cron, and a
      **signed-JWT unsubscribe route** — which is exactly the gap §5 below flags for
      broadcasts. Email defaults **off**; opt-in only.
- [ ] **Phase 9 — Observability + Redis (~1–2 wk, +$16–32/mo).** Sentry server-side
      completeness, Prometheus `/metrics`, **managed Redis** (Tier 10.4 = Tier 25 C1), App
      Insights via OpenTelemetry, multi-replica readiness doc. **Redis is the structural
      unblocker** — it gates Phase 10 SSE, live reactions, and globally-correct rate limits.
- [ ] **Phase 10 — SSE realtime + dedup + live reactions (~1–2 wk).** Needs Phase 9.
- [ ] **Phase 11 — Monetization (~3–4 wk).** Stripe ~$5/mo Pro; perks = multi-kind picks,
      ad-free, advanced stats. `users.proSince` + `subscriptions` table + webhook verification.
- [ ] **Phase 12 — Growth (~5–7 wk).** Tier 14 SEO + landing variants + Core Web Vitals;
      Tier 15 PostHog + email capture + referral attribution.
- [ ] **Phase 13 — Inclusion (~2–3 wk, ~$300–500).** `react-i18next` + paid Spanish pass
      (LatAm football market) + high-contrast theme targeting WCAG AAA.
- [ ] **Phase 14 — TypeScript + Storybook (~5–8 wk).** Incremental TS starting `lib/` +
      `services/`; Storybook after.

---

## 4 — Operator actions — verify, then tick

Post-deploy steps from recent tiers. Several may already be done. All idempotent.

- [ ] **[verify] Tier 31 — enable matchday graphics automation.** Cron is env-gated and
      self-registers on next boot:
      `az containerapp update --set-env-vars MARKETING_AUTOMATION_ENABLED=1 MARKETING_EMAIL_TO=<inbox>`
- [ ] **[verify] Trophy Cabinet — World Cup `stage` backfill.** Needs one WC league Sync so
      every WC game gets its `stage` token (the update path's `Object.assign` backfills
      existing rows). Confirm `LAST_32` came through for the 48-team bracket — `stageLabel`
      title-cases anything unmapped, so a surprise degrades gracefully. Trophy Cabinet **and**
      Aftermatch both read this.
- [ ] **[verify] `scripts/recompute-streaks.mjs`** — one-off after the win-streak rework
      migration; populates `currentWinStreak` / `longestWinStreak` from pick history.
- [ ] **[verify] `scripts/backfill-user-scores.mjs`** — Tier 24 materialized leaderboard
      backfill. Almost certainly done at the time, but cheap to confirm.

_(Tier 25 A7 App Insights alerts moved into Tier 33 Phase 0.7 above.)_

---

## 5 — Broadcast email

- [ ] **Unsubscribe mechanism — needed before the list grows.**
      [scripts/broadcast-email.mjs](scripts/broadcast-email.mjs) is ready to send, but there's
      no opt-out: `lib/email.js` has no header passthrough (so no `List-Unsubscribe`) and
      `users` has no email-preference column. Gmail/Yahoo bulk-sender rules expect one-click
      unsubscribe above ~5k messages/day. Currently ~54 recipients, so this blocks nothing
      today. **Tier 33 Phase 8 builds exactly this** (`notification_prefs` + signed-JWT
      unsubscribe route) — do it there rather than twice.
- [ ] Write the next campaign under `scripts/campaigns/`. Copy
      [knockout-reminder.mjs](scripts/campaigns/knockout-reminder.mjs) — it populates every
      supported field. Always `--preview --out preview.html` and `--test` yourself first, then
      `--all --limit 10` before the full send.

---

## 6 — Dependencies — 11 open Dependabot PRs

Oldest is 2026-05-18. Worth a single triage session (Track B-44 makes this recurring).

- [ ] **Low risk, batch them**: `actions/setup-node` 4→6, `actions/cache` 4→5, `azure/login`
      2→3, and the two grouped npm PRs (#31 dev-deps ×14, #32 prod minor/patch ×18).
- [ ] **Majors, each needs its own look**: `express` 4→5 (#9), `node` 20→26-alpine (#4),
      `body-parser` 1→2 (#10), `uuid` 9→14 (#11 — the `overrides.uuid` pin at ^11.1.1 exists
      for a sequelize transitive CVE; don't drop it without re-auditing the tree).
- [ ] **Python/ML**: `numpy` >=2.4.6 (#14), `xgboost` >=3.2.0 (#13). XGBoost majors are the
      risky one — the model JSON format has bitten us before (the 2.x hex-encoded
      `base_score` incident). Retrain + diff predictions before merging.
- [ ] **`vite@8` major** (Track B-45) — esbuild dev-only CVE. Do it when Dependabot stages it.

---

## 7 — Repo hygiene

- [ ] **Delete merged remote branches.** Confirmed squash-merged: `feat/trophy-cabinet` (#29),
      `sec/launch-hardening` (#19), `fix/ci-baseline` (#18). `fix/e2e-ui-flakes` has no merged
      PR of its own but its single commit shares a subject with one inside #18 —
      **[verify] it landed** before deleting.
- [ ] **Add `.gitattributes`.** `core.autocrlf=true` with no `.gitattributes` means the working
      tree is CRLF while Prettier expects LF, so `npm run format:check` fails on **69 files
      locally**, including untouched committed ones. CI on Linux passes (git normalizes to LF
      on commit — verified), so it's cosmetic, but it makes the local format check useless as
      a signal. `* text=auto eol=lf` fixes it.
- [ ] **Decide what `ARCHITECTURE 2.md` is.** Not a sync duplicate — a genuinely different
      standalone "Complete Engineering Companion" (June 2026, 277 KB) beside the 715 KB
      `ARCHITECTURE.md`. Two overlapping source-of-truth docs will drift.
- [ ] **Fix CLAUDE.md's plan pointers.** It cites `C:\Users\vinde\.claude\plans\ROADMAP.md`
      and `plans/tierCoinFlipParked.md`; **neither is there** — the tier files live in the
      Desktop archive (path at the top of this file). Repoint CLAUDE.md at the archive, or at
      this file, and note that `tier33.md` supersedes `ROADMAP.md`.
- [ ] **Consolidate the plan archive.** `ScoreCast Claude Archive/` has **7 folders** with
      overlapping copies (`plans/`, `Plans as of 2805/`, `Updated Files/`, `old/`,
      `more plans/`, `Live Plans as of 2205/`, `Archived as of 17052026/`). `plans/` is the
      live one. Keep it plus one dated archive; the rest are noise that will cause someone to
      read a stale tier file.
- [ ] **Decide on `docs/`.** Two PNGs that **nothing references**. Link them from a doc or
      drop the folder.

---

## 8 — Recurring obligations (Tier 33 Track D)

| #   | Obligation                                                             | Cadence             | Status                                       |
| --- | ---------------------------------------------------------------------- | ------------------- | -------------------------------------------- |
| D-1 | PL reactivation for the new season                                     | per season          | **OVERDUE** → §1                             |
| D-5 | ML retrain on new season                                               | per season          | **OVERDUE** → §1 (same job)                  |
| D-4 | HSTS preload submission                                                | one-time, from D+30 | **Window open since 2026-06-27** → Phase 0.3 |
| D-2 | Re-run Postgres restore drill                                          | quarterly           | never run → Phase 0.1                        |
| D-3 | `security.txt` `Expires:` renewal                                      | yearly              | file doesn't exist → Phase 0.2               |
| D-6 | VAPID key rotation (public + private in lockstep; needs Bicep reapply) | on leak / 12 mo     | runbook not written → Phase 0.6              |
| D-7 | `pgAdminPassword` rotation                                             | on leak / 12 mo     | runbook not written → Phase 0.6              |

---

## 9 — Backlog registers (Tier 33 Tracks A, B, C)

Not scheduled. Recorded so they're findable; pull items in as the surrounding code is touched.

### Track A — Tier 26 P2 backlog (15 items, opportunistic)

P2-1 login/register field-level error highlighting · P2-2 CommentThread loading skeleton ·
P2-3 bell row click closes popover before navigating · P2-4 friend-search "Private profile"
sub-line · P2-5 friend-deletion 30 s leaderboard cache staleness · P2-6 push auto-purge user
surface · P2-7 admin bulk skipped-reason enrichment · P2-8 GameFiltersBar URL race on rapid
back/forward · P2-9 drawer + modal Escape stacking unit test · P2-10 per-route body-parser
limit override · P2-11 league-sync UI progress / partial-failure breakdown · P2-12 ML model
cache hot-reload docs · P2-13 `audit_log` before-snapshots via pre-hook · P2-14 push allowlist
doc cross-reference · P2-15 group-near-capacity UX at 1800/2000.

### Track B — new capability ideas (47)

**UI / quality of life (small–medium):** B-1 pull-to-refresh · B-2 SearchBar history ·
B-3 cross-tab session sync via BroadcastChannel · B-4 avatar emoji decoration · **B-5 trophy
cabinet on profile — best picks / biggest upsets / longest streaks** (distinct from the
shipped per-stage WC cabinet) · B-6 compare-with-friend overlay · B-7 pick distribution
sparkline · B-8 theme auto-switch at sunset · B-9 group description + accent colour ·
B-10 "Add to Calendar" `.ics` per fixture · B-11 reorderable sidebar tabs · B-12 inline link
previews in comments (needs SSRF guard) · B-13 achievements changelog tab · B-14 "send test
notification" button · B-15 "what would you have scored" overlay · B-16 per-group custom
emoji · B-17 bulk import friends from contacts · B-18 GDPR account data download ·
B-19 account soft-delete grace period · B-20 "Change my pick" microcopy.

**B-48 — sign in with email as well as username.** Users who registered months ago remember
their email and not their handle; today `POST /api/login` only resolves a username, so they
are pushed into password reset for what is a lookup problem. Groundwork is already in place:

- `users_email_lower_unique` is a **partial unique index on `lower(email)` WHERE email IS NOT
  NULL**, so case-insensitive email lookup is already collision-free at the DB level. No
  migration needed.
- `users_username_key` is unique, and usernames are profanity-filtered and cannot contain `@`
  — so "does this identifier contain an `@`" is a safe way to branch the lookup, with no
  ambiguity between the two namespaces.

Three things that must not be broken:

1. **`users.email` is nullable and 3 of 57 current users have none** — including the `vo123`
   demo admin. Email login has to be an additional path, never a replacement.
2. **The no-enumeration contract.** `routes/auth.js` deliberately runs `bcrypt.compare`
   against `LOGIN_DUMMY_HASH` when the user is missing, so response time is constant and
   wrong-password / unknown-user / locked all return an identical 401. An email lookup must
   go through the same constant-time path, or it becomes an oracle for "is this address
   registered" — worse than the username oracle, because addresses are guessable.
3. **Lockout counts against the account, not the identifier.** Five failed attempts must lock
   the user whether they were typed as a username or an email, otherwise the limit doubles.

Scope is roughly: rename the field to "Username or email" in `LoginForm`, relax
`loginSchema`, and swap `getUserByUsername` for a resolver that branches on `@`. Worth pairing
with `POST /api/auth/forgot-password`, which already takes an email and could stop being the
de-facto recovery route for a forgotten handle.

**Capability expansion (needs its own planning):** B-21 NFL/MLB/NBA/NHL/Rugby (XL) ·
B-22 nested comment threading · B-23 group seasons with weekly reset · B-24 embeddable group
leaderboard widget · B-25 player watchlist · B-26 verified accounts · B-27 public read-only
API · B-28 Discord bot · B-29 Slack integration · B-30 virtual gift currency ·
B-31 bet-tracking import (conflicts with the no-betting stance — revisit) · B-32 WebRTC watch
parties · B-33 multi-kind picks · B-34 tournaments/brackets · B-35 manager mode ·
B-36 banker pick.

**Security / hardening:** B-37 OpenAPI completeness (~33 of 68 endpoints unregistered) ·
B-38 CSP `report-uri` → Sentry · B-39 helmet COEP/COOP/CORP investigation · B-40 audit-log
before-snapshots + failed-auth audits · B-41 Cloudflare WAF + Bot Fight Mode (needs the
orange-cloud `trust proxy` audit first) · B-42 scanner-path blocklist · B-43 audit-log weekly
digest · B-44 ongoing Dependabot vetting · B-45 `vite@8` · B-46 full DPO + sub-processor list
if EU traffic spikes · B-47 verify `minReplicas=1` removed the P1-10 need.

### Track C — parked (revive on trigger)

| #   | Item                                                                                                                                                                                                                                                          | Trigger                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| P1  | Live reactions stream (Tier 27 B4)                                                                                                                                                                                                                            | folds into Phase 10 once Redis lands |
| P2  | Phase E stretch — tournaments / manager mode / multi-kind / banker                                                                                                                                                                                            | user direction                       |
| P3  | **Coin Flip Master** — shipped then cleanly reverted (`b74c682` ⇒ `9c278f6`). Two fixes needed: per-league unique index `(leagueId, coinFlipDayKey)` so one league doesn't monopolise the daily pick, and a 7-day look-ahead so future fixtures show the chip | design issues resolved               |
| P4  | One-click group invite token link                                                                                                                                                                                                                             | user direction                       |
| P5  | Tier 26 P2 backlog (Track A above)                                                                                                                                                                                                                            | as surrounding code is touched       |
| P6  | Cloudflare orange-cloud (Tier 25 A3)                                                                                                                                                                                                                          | bot / DDoS signal                    |
| P7  | `LOG_LEVEL=warn` (Tier 25 A6)                                                                                                                                                                                                                                 | Log Analytics quota alert fires      |

---

## 10 — Known issues — accepted, not scheduled

**Deferred from Tier 34** — all three are real, were found while tracing the cricket work,
and were left alone because fixing any of them changes live football behaviour. Each wants
its own change with its own verification.

- [ ] **`LeaderboardService` silently truncates points under a multi-row filter.** All three
      read sites collapse with `new Map(rows.map((r) => [r.userId, r.points]))`, but
      `user_scores` has one row per `(userId, leagueId, seasonId)` — so last-row-wins. This
      already loses points today for any league with two seasons, and `getForGroup` has it
      three times over so `winRate` breaks too. Verified live: one user holds two rows
      summing to 310. Fix is `SUM ... GROUP BY "userId"`, exactly as
      `SportLeaderboardService.sumScoresForSport` already does. Worth pairing with a test
      that filters a two-season league.
- [ ] **`pickStatus` has no void branch, so postponed/cancelled football games read "Live"
      forever inside the Completed list.** `useGames` buckets `cancelled` into completed
      while `pickStatus` falls through to the wall-clock branch. Tier 34 added a
      cricket-scoped `'void'` branch; generalising it to football is a one-line change plus
      a badge, but it alters what existing users see on old postponed fixtures.
- [ ] **Result notifications re-fan-out on every correction.** `GameService.setResult` fires
      `pick-scored` for every pick whenever `result` is truthy, with no did-it-change check.
      Rare for football (an admin re-clicking the same button) but routine for cricket, where
      a scorecard typo fix re-notifies every picker. Fix is to capture
      `appliedResult`/`appliedPoints` before the transaction and only notify on a real
      change, ideally with distinct copy for a points revision.

Documented rather than fixed; listed so they aren't rediscovered.

- **Match minute is client-estimated.** football-data.org doesn't expose `minute`/`injuryTime`
  even on the paid TIER_ONE plan (verified 2026-05-23). Wall-clock from kickoff plus HT/phase
  heuristics; soft by ~5 min around halftime. Upgrade path is a higher tier or a provider swap.
- **Audit log records `after` only** — no `before` snapshot (Track B-40 / P2-13).
- **Failed-auth admin attempts aren't audited** — `authMiddleware` returns 401 before
  `auditMutation` runs (Track B-40).
- **Single-process leaderboard + fixture cache.** Each replica keeps its own copy at a 30 s
  TTL, so cross-replica drift is bounded by that window. Redis (Phase 9) dedupes it.
- **Trophy Cabinet / Aftermatch are unmaterialized.** Both scan every user's WC picks on a
  cold path, 5-min cached. Bounded and sub-second at current volume by design. If either goes
  hot, materialize separately — **do not** wire them into the Tier 24 dual-writer
  (`user_scores` has no stage axis).
- **Accepted-risk items from Tier 22**: Postgres firewall `AllowAllAzureServices`
  (revisit with VNet at Phase 9); no CAPTCHA on register (`registerLimiter` 3/hr/IP + Resend
  quotas are the backstop); no file-upload surface — **if avatar upload is ever added, redo
  that audit**.

---

## Appendix — Plan file index

### Tier files — `…\ScoreCast Claude Archive\plans\`

The live set. `tier33.md` is the master; `ROADMAP.md` there is superseded but useful for the
shipped record.

| File                                     | Status                                                        |
| ---------------------------------------- | ------------------------------------------------------------- |
| `tier33.md` — roadmap consolidation      | **Authoritative** → §3                                        |
| `ROADMAP.md`                             | Superseded by tier33; keep for the shipped history            |
| `tier23.md` — pre-launch ops hardening   | Open → §3 Phase 0                                             |
| `tier26.md` — bug & frustration triage   | P1 partly shipped → §3 Phase 1; P2 → Track A                  |
| `tier32.md` — win-streak on leaderboards | **Partially shipped** → §3 Phase 2                            |
| `tier7.md`                               | PWA/push shipped; SSE + email → Phases 8 + 10                 |
| `tier10.md`                              | `/readyz` + SIGTERM shipped; rest → Phase 9                   |
| `tier12.md` / `tier14.md` / `tier15.md`  | → Phases 11 + 12                                              |
| `tier16.md`                              | → Phase 13                                                    |
| `tier9.10.md` / `tier9.11.md`            | → Phase 14                                                    |
| `tier25.md`                              | Phase 1+2 shipped; A7 → Phase 0.7; C levers → Phase 9         |
| `supertier30.md`                         | Phases 0–3 + 5.1 shipped; C2–C4 + 4 + 5.2 + 6 → Phases 3–5, 7 |
| `tier27.md` / `tier28.md` / `tier29.md`  | Absorbed into supertier30 / shipped                           |
| `tier31.md` — marketing graphics kit     | ✅ Shipped 2026-06-11                                         |
| `tierStreakRework.md`                    | ✅ Shipped (per-result win streak)                            |
| `tierCoinFlipParked.md`                  | Parked → Track C P3                                           |
| `tier-archive.md`                        | Authoritative shipped record                                  |
| `tier18–22`, `tier24`                    | ✅ Shipped                                                    |

### Named plans — `C:\Users\vinde\.claude\plans\` (ScoreCast)

| File                                         | What it is                          | Status                            |
| -------------------------------------------- | ----------------------------------- | --------------------------------- |
| `make-a-plan-to-imperative-adleman.md`       | Capacitor native iOS/Android        | **Not started** → §2a             |
| `using-threejs-make-a-frolicking-corbato.md` | Three.js "Rating Engine" commercial | Shipped `ad53bc2`; 2 extras → §2b |
| `make-a-plan-for-peppy-orbit.md`             | WC Wrapped → "Aftermatch"           | Shipped `41953a3`                 |
| `i-want-to-add-silly-hare.md`                | Trophy Cabinet per-stage placements | Shipped `6fdb46b` (#29)           |

### Named plans — other projects (not ScoreCast)

| File                                               | Project               | What it is                           |
| -------------------------------------------------- | --------------------- | ------------------------------------ |
| `plan-being-able-to-memoized-milner.md`            | AP invoice agent demo | Hand-written / scrappy invoices      |
| `brainstorm-ideas-for-an-glimmering-giraffe.md`    | AP invoice agent demo | Open completed runs + LLM summaries  |
| `using-three-js-can-you-vivid-thompson.md`         | AP invoice agent demo | Agent-process presentation animation |
| `using-three-js-can-you-vivid-thompson-agent-*.md` | AP invoice agent demo | Exploration notes for the above      |
| `look-at-the-one-floofy-sparkle.md`                | Football Chess        | Tactical 11v11 manager game; no code |
