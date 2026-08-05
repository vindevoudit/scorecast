# TODO

Working backlog for ScoreCast / Bantryx. Grouped by urgency, not by tier.

Items marked **[verify]** could not be confirmed from the repo — they depend on live
Azure/prod state. Check first, then tick or action.

_Last swept: 2026-08-04._

---

## 1. Time-critical

- [ ] **Reactivate Premier League for 2026/27 — OVERDUE.** PL was set `active=false`
      during the 2026-05-28 beta→launch reset so the off-season cron couldn't resurrect
      deleted games. The 2026/27 season kicks off **mid-August**, so this is now the
      most time-sensitive item on the list. Three parts:
  1. Admin → League Manager → set PL `active=true`, then **Sync** to pull 2026/27 fixtures.
  2. Retrain the PL model — update `ml/data/raw/PL_*.csv`, run
     `cd ml && python -m scorecast_ml train --league PL`, copy the output to
     [lib/ml/models/PL_elo.json](lib/ml/models/PL_elo.json), commit, push.
  3. Elo carries across seasons, so a full team-table rebuild is **optional**. Only
     delete + re-seed PL `teams` rows if you deliberately want a reset.
     - Watch for: promoted sides enter at `min(elo)` for the league automatically
       (`LeagueService.ensureTeamExists`), so no manual seeding needed for them.

- [ ] **Commit + push the current working tree.** Three uncommitted changes, all verified
      (lint 0 errors, campaign renders, dry-run against local DB matched 52/54):
  - `M eslint.config.js` — browser-globals block for `marketing/commercial/*.js`
  - `?? scripts/broadcast-email.mjs` + `?? scripts/campaigns/` — generalized broadcast mailer
  - `?? marketing/commercial/` — standalone Three.js commercial (not wired into the app;
    CDN import-map, nothing under `src/` imports it, not in the Docker image)

- [ ] **Merge `fix/seed-empty-db-not-null`** (commit `e1d4e42`, fresh-DB seeder NOT-NULL fix).
      Held back until after the World Cup — the tournament ended 2026-07-19, so the hold
      is expired. Inert in prod either way; it only affects seeding an empty database.

---

## 2. Operator actions — verify, then tick

Post-deploy steps documented across recent tiers. Several may already be done.

- [ ] **[verify] Tier 25 A7 — App Insights alerts.** The last outstanding piece of the
      pre-launch capacity ladder. Three portal rules (~15 min):
      5xx rate > 1%, `/readyz` failures, replica count pinned at cap.
      Walkthrough in [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) Step 2.
- [ ] **[verify] Tier 31 — enable matchday graphics automation.** The cron is gated behind
      env and self-registers on next boot once set:
      `az containerapp update --set-env-vars MARKETING_AUTOMATION_ENABLED=1 MARKETING_EMAIL_TO=<inbox>`
- [ ] **[verify] Trophy Cabinet — World Cup `stage` backfill.** Needs one WC league Sync so
      every WC game gets its `stage` token (the update path's `Object.assign` backfills
      existing rows). Confirm `LAST_32` came through as expected for the 48-team bracket —
      `stageLabel` title-cases anything unmapped, so a surprise degrades gracefully rather
      than breaking. Trophy Cabinet **and** Aftermatch both read this.
- [ ] **[verify] `scripts/recompute-streaks.mjs`** — one-off after the win-streak rework
      migration, populates `currentWinStreak` / `longestWinStreak` from pick history.
      Idempotent; safe to re-run if unsure.
- [ ] **[verify] `scripts/backfill-user-scores.mjs`** — Tier 24 materialized leaderboard
      backfill. Almost certainly done at the time (leaderboards have been correct since),
      but idempotent, so re-running is a cheap way to be certain.

---

## 3. Security + operational hardening (parked from Tier 22)

None are code-level; all were deferred at launch and are still open.

- [ ] **Submit `bantryx.com` to the HSTS preload list** at https://hstspreload.org.
      The header has shipped `preload` with a 2-year max-age since 2026-05-28 — well past
      the 30-day stability window. Until submitted, every first visit on a new device is a
      one-shot MITM downgrade window.
- [ ] **Cloudflare WAF + Bot Fight Mode + edge rate limits** on `/api/login`, plus a
      scanner-path blocklist. **Prerequisite**: DNS is currently grey-cloud (DNS-only);
      going orange-cloud requires auditing `trust proxy` first, since `req.ip` feeds every
      per-IP rate limiter.
- [ ] **Postgres restore drill** — never rehearsed. Note `geoRedundantBackup` is still
      `Disabled` and is **create-time-only**; it's folded into Tier 25 C3 (the GP SKU
      migration recreates the server anyway).
- [ ] **Secrets rotation drill** — `jwt-secret`, `football-data-api-key`, `resend-api-key`,
      `vapid-private-key`. Rotating `jwt-secret` invalidates every access token; confirm
      the refresh-token path recovers cleanly before doing it for real.
- [ ] **Publish `security@bantryx.com`** or `.well-known/security.txt` — no disclosure
      channel exists today.
- [ ] **Audit-log weekly digest** — `audit_log` is written and readable in-app but nothing
      surfaces it proactively.

---

## 4. Broadcast email

- [ ] **Unsubscribe mechanism — needed before the list grows.** `scripts/broadcast-email.mjs`
      is ready to send, but there is no opt-out: `lib/email.js` has no header passthrough
      (so no `List-Unsubscribe`) and `users` has no email-preference column. Gmail/Yahoo
      bulk-sender rules expect one-click unsubscribe above ~5k messages/day. Currently ~54
      recipients, so this is fine right now and blocks nothing. Needs: preference column +
      public unsubscribe route with a signed token + header support in `lib/email.js`.
- [ ] Write the next campaign under `scripts/campaigns/`. Copy
      [knockout-reminder.mjs](scripts/campaigns/knockout-reminder.mjs) — it populates every
      supported field. Always `--preview --out preview.html` and `--test` yourself first,
      then `--all --limit 10` before the full send.

---

## 5. Dependencies — 11 open Dependabot PRs

Oldest is from 2026-05-18. Worth a single triage session.

- [ ] **Low risk, batch them**: `actions/setup-node` 4→6, `actions/cache` 4→5,
      `azure/login` 2→3, and the two grouped npm PRs (#31 dev-deps ×14, #32 prod
      minor/patch ×18).
- [ ] **Majors, each needs its own look**: `express` 4→5 (#9), `node` 20→26-alpine (#4),
      `body-parser` 1→2 (#10), `uuid` 9→14 (#11 — note the `overrides.uuid` pin at ^11.1.1
      exists for a sequelize transitive CVE; don't drop the override without re-auditing
      the tree).
- [ ] **Python/ML**: `numpy` >=2.4.6 (#14), `xgboost` >=3.2.0 (#13). XGBoost majors are the
      risky one — the model JSON format has bitten us before (the 2.x hex-encoded
      `base_score` incident). Retrain + diff predictions before merging.

---

## 6. Repo hygiene

- [ ] **Add `.gitattributes`.** `core.autocrlf=true` with no `.gitattributes` means the
      working tree is CRLF while Prettier expects LF, so `npm run format:check` fails on
      **69 files locally** — including untouched committed ones. CI on Linux passes (git
      normalizes to LF on commit, verified), so this is cosmetic, but it makes the local
      format check useless as a signal. `* text=auto eol=lf` would fix it.
- [ ] **Decide what `ARCHITECTURE 2.md` is.** Not a sync duplicate — it's a genuinely
      different, standalone "Complete Engineering Companion" (June 2026, 277 KB) alongside
      the 715 KB `ARCHITECTURE.md`. Two overlapping source-of-truth docs will drift. Merge,
      rename to something meaningful, or delete.
- [ ] **Fix the stale CLAUDE.md roadmap pointer.** It references
      `C:\Users\vinde\.claude\plans\ROADMAP.md`, which no longer exists — the plans folder
      now holds 9 differently-named files. Either restore a roadmap or repoint CLAUDE.md
      (this file could take over that role).
- [ ] **Decide on `docs/`.** Contains exactly two PNGs
      (`share-card-9x16-preview.png`, `stats-dashboard-screenshot.png`) that **nothing in
      the repo references**. Either link them from a doc or drop the folder.

---

## 7. Product backlog (parked, no date)

- [ ] **Tier 23** — operational hardening (~6 hr). Overlaps heavily with §3 above; largely
      the same work items.
- [ ] **Tier C capacity levers** — all trigger-driven, pull when a metric fires:
      C1 Redis (~$16/mo, mostly obviated by Tier 24 materializing scores at write time),
      C2 Postgres B2s, C3 GP SKU (carries the geo-redundant-backup fix), C5 SSE.
- [ ] **Tier 7** — SSE realtime + email digests + prefs UI. SSE only pays off multi-replica,
      so it wants Redis first.
- [ ] **Tier 9.10 TypeScript / 9.11 Storybook** — parked at the end of the roadmap.
- [ ] **Coin Flip Master revival** — shipped then reverted cleanly (`b74c682` ⇒ `9c278f6`).
      Revival recipe: per-league unique index `(leagueId, coinFlipDayKey)` instead of one
      global daily pick, plus a 7-day look-ahead so future fixtures show the chip.
      Plan: `plans/tierCoinFlipParked.md`.
- [ ] **Multi-kind picks** (spread / over-under / correct score) — deferred from Tier 4b.
      When this lands, add a `draw` counter to the voice-of-the-crowd `GROUP BY`.
- [ ] ~~**WC late-joiner leaderboards**~~ — parked plan for "This Matchday / Since You
      Joined / Accuracy" tabs to give mid-tournament joiners a fair board. **Now moot for
      2026** (tournament ended 2026-07-19, nothing was built). Keep the idea for the next
      tournament; close the memory note.

---

## 8. Known issues — accepted, not scheduled

Carried from CLAUDE.md. Documented rather than fixed; listed so they aren't rediscovered.

- **Match minute is client-estimated.** football-data.org still doesn't expose
  `minute`/`injuryTime` even on the paid TIER_ONE plan (verified 2026-05-23). Wall-clock
  from kickoff plus HT/phase heuristics; soft by ~5 min around halftime. Upgrade path is a
  higher tier or a provider swap via `lib/footballApi.js`.
- **Audit log records `after` only** — no `before` snapshot on updates/deletes. True diffs
  would need per-entity fetch hooks.
- **Failed-auth admin attempts aren't audited** — `authMiddleware` returns 401 before
  `auditMutation` runs. Fixing means moving `auditMutation` earlier and accepting that
  `req.user` won't be populated.
- **Single-process leaderboard + fixture cache.** Fine today; each replica keeps its own
  copy with a 30 s TTL, so cross-replica drift is bounded by that window.
