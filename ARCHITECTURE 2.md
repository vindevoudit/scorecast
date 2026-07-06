# ScoreCast / Bantryx — The Complete Engineering Companion (ARCHITECTURE 2)

> **What this is.** The single, standalone, exhaustive reference for the ScoreCast / Bantryx codebase. If you can read JavaScript, SQL, and Python and you have this file, you have everything you need to run the app, understand every subsystem and _why_ it is shaped that way, deploy a change to production on Azure, retrain the ML model, and avoid the ~80 load-bearing invariants that are invisible in the source. This document does **not** assume you have read any other file — it folds in the full depth (code snippets, complete column tables, behavior matrices, worked examples, incident postmortems, and the complete invariant catalogue).
>
> **Currency.** Reflects the codebase as of **June 2026** (post Tier 30 Phase 3 C1 + Phase 5 Chunk 5.1). Verified directly against the working tree: 16 route files, 15 services, 22 models, 41 migrations, 6 cron jobs, 2 CI/CD workflows. Where older docs still mention a `scorecast-ml-job` Container Apps Job, an `ml-deploy.yml` workflow, an `ml-job.bicep` module, a `scorecast-ml` ACR repo, or an `ml_pipeline` DB user — **those were all deleted in Tier 17.** This document reflects the current in-process-inference reality.
>
> **Other docs (optional).** `CLAUDE.md` (terse invariant list), `README.md` (marketing intro), `MIGRATION_GUIDE.md` / `MIGRATIONS_PRIMER.md` (schema how-to), `DATABASE_SETUP.md` (local Postgres install walkthrough), `LAUNCH_CHECKLIST.md` (capacity runbook), `ACCESSIBILITY.md`, `ml/README.md` (retraining). The original `ARCHITECTURE.md` remains as historical/tier-by-tier narrative; _this_ file supersedes it as the working reference. **Where `README.md`, `.env.example`, or `CLAUDE.md` disagree with this file on a _current_ fact, trust this file** — at the time of writing the README still states the old 60-s/5-min live-score cadence (now 30-s/3-min), the football-data free tier (now TIER_ONE 20 req/min), `scale 0→3` (now `minReplicas 1 / maxReplicas 10`), Tier 10/`/readyz`/SIGTERM as "pending" (shipped), and "scoring lives in `server.js`" (now `lib/scoring.js`); `.env.example` still says the dev CORS fallback is `origin: true` (now localhost-only since Tier 22 M2).

## Table of Contents

1. [The Product](#1-the-product)
2. [System Architecture at a Glance](#2-system-architecture-at-a-glance)
3. [Technology Stack & Rationale](#3-technology-stack--rationale)
4. [Repository Layout](#4-repository-layout)
5. [Backend Architecture](#5-backend-architecture)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Database Architecture](#7-database-architecture)
8. [Domain Subsystems](#8-domain-subsystems)
9. [The Machine-Learning Pipeline](#9-the-machine-learning-pipeline)
10. [End-to-End Data Flows](#10-end-to-end-data-flows)
11. [Cross-Cutting Concerns](#11-cross-cutting-concerns)
12. [Cloud, CI/CD & Operations](#12-cloud-cicd--operations)
13. [Load-Bearing Invariants](#13-load-bearing-invariants)
14. [Known Limitations & Technical Debt](#14-known-limitations--technical-debt)
15. [Roadmap Status](#15-roadmap-status)
16. [Glossary](#16-glossary)
17. [First-Day Checklist](#17-first-day-checklist)

---

## 1. The Product

ScoreCast — live in production as **Bantryx** at https://bantryx.com — is a social football-prediction web app. There is **no real money**; it is a free-to-play prediction game whose entire skill curve comes from a probability-weighted scoring formula.

### 1.1 The core loop

1. **Fixtures land.** Games are created either manually by an admin (the in-app Admin panel) or, for tracked leagues, automatically by a daily cron sync against [football-data.org v4](https://www.football-data.org/). Every game carries three implied-odds probabilities — `homeProbability`, `drawProbability`, `awayProbability` — that sum to 1.0. These are written by an in-process ML pipeline (Elo + XGBoost). A brand-new fixture that nothing has predicted yet carries the sentinel `(0.50, 0.00, 0.50)`.
2. **Users pick a winner.** A pick is `'home'` or `'away'` only — **winner-only**, there is no "pick the draw" option. A user can change or undo a pick any time before kickoff.
3. **Results resolve.** When a game finishes — an admin sets the result, or the 30-second live-score cron observes `FINISHED` upstream — correct picks score points.
4. **The underdog pays more.** The scoring formula is:

   ```
   points = round((1 − probability_of_the_team_you_picked) × 100)   // only if your pick won
   ```

   Pick a 25%-chance underdog who wins → **75 points**. Pick the 75% favourite who wins → **25 points**. A losing pick scores **0**. _This asymmetry is the whole game._ Skill is finding value, not picking favourites.

5. **A draw pays partial credit.** If `result === 'draw'`, a winner-only pick still earns:

   ```
   points = round(drawProbability × opposite_team_probability / (homeProbability + awayProbability) × 100)
   ```

   where `opposite_team_probability` is `awayProbability` if you picked home (and vice-versa). This rewards a pick that was "structurally close" to the actual outcome, weighted by the modeled draw probability. **A draw never counts as a win** for win-rate purposes — `winRate` only counts literal `choice === result`.

6. **Compete & socialise.** Overall leaderboard + per-group leaderboards (sortable by points / win-rate / username, paginated, filterable by league + season); public/private/secret groups with running comment threads; friend requests + head-to-head; comments + a fixed 5-emoji reaction palette on games and inside groups; 23 badges; win streaks; referral codes; a personal stats dashboard; voice-of-the-crowd indicators; share-as-image.

### 1.2 Worked scoring example

Game: Liverpool (home) vs Brighton (away), `homeProbability=0.72, drawProbability=0.20, awayProbability=0.08`.

- You pick **away** (Brighton). If Brighton win → `round((1 − 0.08) × 100) = 92` points.
- You pick **home** (Liverpool). If Liverpool win → `round((1 − 0.72) × 100) = 28` points.
- The match ends a **draw**. You picked home → `round(0.20 × 0.08 / (0.72 + 0.08) × 100) = round(0.20 × 0.10 × 100) = round(2.0) = 2` points. You picked away → `round(0.20 × 0.72 / 0.80 × 100) = round(0.18 × 100) = 18` points. (Picking the side closer to the favourite gets _less_ draw credit, because the draw was "more of an upset" against the favourite.)

### 1.3 Who uses it

- **Players** — register with email + password (email-verification flow), pick games, climb leaderboards, socialise.
- **Anonymous visitors** — browse games / leaderboards / public groups / public profiles / comments **without an account**; any _action_ (pick, react, comment, friend-request, group-join) prompts sign-in via a gate.
- **Admins** — manage games, users, leagues, and read an audit log from an in-app Admin panel (`user.role === 'admin'`).

### 1.4 Shape and philosophy

Mid-sized full-stack app: roughly even JavaScript split between a Node/Express server and a React 18 SPA, plus a small **training-only** Python project for the ML model. **One server process, one Postgres database, no message queue, no separate worker, no managed Redis (yet).** The same Express process serves the JSON API at `/api/*` and the static React bundle for everything else. Build-once-deploy-anywhere: configuration and secrets resolve at boot from environment variables (themselves backed by Azure Key Vault references), never baked into the build.

---

## 2. System Architecture at a Glance

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                              Browser (React 18 SPA)                              │
│  fetch('/api/...') through useRequest()  — credentials: 'include' always         │
│  Cookies (HttpOnly, never localStorage):                                         │
│      sc_access   15-min access JWT (HS256), Path=/                               │
│      sc_refresh  30-day opaque rotating token, Path=/api/auth (SHA-256 in DB)    │
│      sc_csrf     JS-readable 30-day token, echoed as X-CSRF-Token on mutations   │
│  Installable PWA: service worker (precache + runtime cache + push), Web Push     │
│  State: 4 React Contexts (Notification / Auth / AuthGate / Data) + selector hooks│
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ HTTPS — Cloudflare DNS (grey-cloud) → Azure Container Apps ingress
                                       │ /api/* JSON  +  static dist/ assets
                                       ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                        Express server (server.js, ~357 LOC)                      │
│                                                                                  │
│  GLOBAL MIDDLEWARE (in order):                                                   │
│   require('./lib/instrument') [line 1 — Sentry/OTel]                             │
│   requestId → pino-http → compression → helmet(CSP+HSTS+PermissionsPolicy)       │
│   → cors(env allowlist) → bodyParser.json(32kb) → cookieParser                   │
│   → csrf(double-submit) → trust proxy:1 → Cache-Control → express.static(dist/)  │
│                                                                                  │
│  PER-ROUTE: rateLimit → authMiddleware|optionalAuth → requireAdmin               │
│             → validate(zod) → auditMutation → asyncHandler(handler)              │
│                                                                                  │
│  routes/*.js   (16 routers; thin: parse + auth + call service + respond)         │
│       └─► services/*.js   (15 services: domain logic; throw AppError; own        │
│               cache-invalidation + notify + badge + cascade side-effects)        │
│               └─► models/*.js   (22 Sequelize models)                            │
│                                                                                  │
│  lib/  cross-cutting infra: scoring · auth(cookies/tokens) · errors · logger ·   │
│        leaderboardCache(30s Map) · cache(TTL Map) · email(Resend) · footballApi ·│
│        fixtureStatus · scheduler(node-cron + advisory locks) · ml/(JS inference) │
│                                                                                  │
│  SCHEDULER — 6 cron jobs (fixture sync, live scores, reconcile, pick-prob lock,  │
│              kickoff reminders, weekly recap), advisory-locked, no-op in test    │
│                                                                                  │
│  Graceful SIGTERM: server.close → 25s drain → scheduler.stop → sequelize.close   │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ Sequelize 6 (TCP, pool max 20, transactional)
                                       ▼
            ┌──────────────────────────────────────────────────────────┐
            │  PostgreSQL 16 — Azure DB for PostgreSQL Flexible (B1ms)   │
            │  users · games · picks · groups · group_members ·          │
            │  group_invites · group_join_requests · badges ·            │
            │  friendships · comments · comment_reactions ·              │
            │  notifications · email_verification_tokens ·               │
            │  password_reset_tokens · refresh_tokens · push_subscriptions│
            │  leagues · seasons · teams · audit_log ·                    │
            │  user_scores · user_scores_overall · SequelizeMeta         │
            └──────────────────────────────────────────────────────────┘
```

**One process, one database, no queue, no worker, no CDN, no managed Redis.** A restart loses only in-memory state: rate-limit counters, account-lockout counters, the 30-second leaderboard cache, the football-API response cache, the per-replica ML model cache, and any in-flight cron tick. Everything durable lives in Postgres — crucially, **sessions survive a restart** because refresh tokens are DB rows. Cron ticks are idempotent and self-recover on the next tick.

**The cardinal side-effect rule:** notifications, badges, the ML re-prediction cascade, and (mostly) materialized-score updates fire _after commit_ / _outside the originating transaction_, fire-and-forget with `.catch()`. A rollback never produces ghost rows; a side-effect outage never breaks the user-facing response. (The two writes that _do_ run inside the transaction — the Elo update and the materialized-score delta — are part of the atomic write, not side-effects; their _downstream_ effects are still post-commit.)

---

## 3. Technology Stack & Rationale

| Layer                  | Choice                                                                                                                                                                                               | Why                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Frontend framework** | React 18 (hooks-only; the only class component is `ErrorBoundary`, which React requires)                                                                                                             | Familiar, easy hiring, no SSR need                                                                                                                                       |
| **Build tool**         | Vite 5 (esbuild + Rollup)                                                                                                                                                                            | Fast DX; dev proxy `/api → :3000` avoids CORS in dev; relative URLs work in dev + prod                                                                                   |
| **Styling**            | Tailwind CSS 3 over CSS-variable design tokens                                                                                                                                                       | Utility-first; tokens drive a binary light/dark theme switch with no FOUC                                                                                                |
| **UI primitives**      | Radix UI (`dialog`, `dropdown-menu`, `popover`, `select`, `tabs`, `toast`, `tooltip`) wrapped under `src/components/ui/`                                                                             | Focus trap / ARIA / keyboard interaction live in the primitive; ScoreCast components never use raw `<button>` for interactive surfaces                                   |
| **Motion**             | `motion` (Framer Motion's successor) via `<LazyMotion features={domAnimation} strict>`                                                                                                               | ~30 KB in its own chunk; only `<m.*>` allowed (strict mode rejects `<motion.*>` so accidental full-namespace imports throw); every consumer honours `useReducedMotion()` |
| **Charts**             | `recharts` (lazy, isolated `charts` chunk ~119 KB gzip)                                                                                                                                              | Only loaded when the Stats sub-tab opens                                                                                                                                 |
| **State**              | React Context + custom hooks (no Redux, no Zustand, no React Router)                                                                                                                                 | 4 providers + selector hooks suffice at this scale                                                                                                                       |
| **HTTP client**        | `fetch` wrapped in `useRequest()`                                                                                                                                                                    | Handles CSRF header + single-flight 401-refresh-retry                                                                                                                    |
| **Backend**            | Node 18+ / Express 4                                                                                                                                                                                 | Tiny surface, easy to read                                                                                                                                               |
| **ORM**                | Sequelize 6                                                                                                                                                                                          | Predictable; raw-SQL escape hatch for migrations                                                                                                                         |
| **Migrations**         | `sequelize-cli` (CLI + CD) + `umzug` (dev-boot)                                                                                                                                                      | Versioned files in `migrations/`; shared `SequelizeMeta` table; either entry point applies each migration exactly once                                                   |
| **DB**                 | PostgreSQL 16                                                                                                                                                                                        | Needs ENUMs, partial unique indexes, functional indexes (`LEAST/GREATEST`), `INSERT ... ON CONFLICT DO UPDATE`, advisory locks                                           |
| **Auth**               | HttpOnly cookie auth: 15-min access JWT (HS256) + 30-day rotating refresh token (SHA-256-hashed in DB). **No bearer header, no token in any response body**                                          | XSS can't lift the session                                                                                                                                               |
| **2FA**                | TOTP via `speakeasy` + `qrcode` — **PARKED** (route handlers + frontend deleted; DB columns + migrations + deps + `lib/auth.js CHALLENGE_*` constants kept; revival is `git revert`)                 | De-risked the marketing launch                                                                                                                                           |
| **Passwords**          | `bcryptjs` cost 10 (model hooks auto-hash)                                                                                                                                                           | Pure-JS, no native build on Windows                                                                                                                                      |
| **CSRF**               | Double-submit cookie (`sc_csrf` ↔ `X-CSRF-Token`, `crypto.timingSafeEqual`)                                                                                                                          | Belt-and-braces over `SameSite=Lax`                                                                                                                                      |
| **Security headers**   | `helmet` — CSP (incl. a hashed inline JSON-LD block), HSTS (2 yr, `preload`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`, extended `Permissions-Policy`                      |                                                                                                                                                                          |
| **CORS**               | env allowlist `CORS_ORIGINS`; throws on boot in prod if unset; localhost-only fallback in dev                                                                                                        |                                                                                                                                                                          |
| **Validation**         | `zod` on every POST/PUT body; `noProfanity` + bidi/zero-width/control-char refines                                                                                                                   |                                                                                                                                                                          |
| **Profanity**          | `obscenity` (l33t / repeated-char / zero-width aware; Scunthorpe-whitelisted) shared `noProfanity` refine on 6 surfaces                                                                              |                                                                                                                                                                          |
| **Rate limiting**      | `express-rate-limit`, in-memory, per-IP (10 limiters) + per-user account lockout                                                                                                                     |                                                                                                                                                                          |
| **Logging**            | `pino` + `pino-http`, request-id correlation; JSON in prod, `pino-pretty` in dev                                                                                                                     |                                                                                                                                                                          |
| **Error reporting**    | React `ErrorBoundary` + window listeners → `POST /api/client-errors` → structured log; Sentry opt-in (`SENTRY_DSN` / `VITE_SENTRY_DSN`)                                                              |                                                                                                                                                                          |
| **Email**              | Pluggable (`lib/email.js`): Resend when `RESEND_API_KEY` set, log-only fallback. **Never throws.**                                                                                                   |                                                                                                                                                                          |
| **HTTP**               | gzip via `compression` (~75% on the JS bundle)                                                                                                                                                       |                                                                                                                                                                          |
| **Leaderboard**        | Materialized `user_scores` + `user_scores_overall` tables (incremental dual-writer) behind a 30-s in-process Map cache                                                                               | Sub-ms reads regardless of user count                                                                                                                                    |
| **External data**      | football-data.org v4 TIER_ONE (20 req/min, €19/mo) behind a provider-agnostic surface (`lib/footballApi.js`)                                                                                         |                                                                                                                                                                          |
| **Background jobs**    | `node-cron` (`lib/scheduler.js`) + `pg_try_advisory_lock(crc32(jobName))` for multi-replica safety                                                                                                   |                                                                                                                                                                          |
| **ML**                 | In-process JS inference (Elo + zero-dep XGBoost native-JSON tree walker) in `lib/ml/` + `PredictionService`; Python is training-only                                                                 | Reactive cascade on every captured result; no cron, no API round-trip, no separate image                                                                                 |
| **PWA**                | `vite-plugin-pwa` (`injectManifest`, source SW at `src/sw.js`) + Web Push (`web-push`, VAPID)                                                                                                        | Home-screen installable, native OS push                                                                                                                                  |
| **Tests**              | Playwright (~270 tests, 22 specs: UI/flow + per-endpoint API boundary suite) + `node --test` unit tests                                                                                              |                                                                                                                                                                          |
| **Container**          | Multi-stage Dockerfile (`node:20-alpine`, non-root uid 1001, `tini`, `HEALTHCHECK /healthz`)                                                                                                         |                                                                                                                                                                          |
| **CI/CD**              | GitHub Actions: `ci.yml` (lint+format+audit+build+migrations-smoke+Playwright) + `deploy.yml` (build→migrate→roll-out, OIDC-authed)                                                                  |                                                                                                                                                                          |
| **Cloud**              | Azure: Container Apps (Consumption) + Container Apps Job (migrate) + Postgres Flexible (B1ms) + ACR + Key Vault (RBAC) + Log Analytics + App Insights. Bicep IaC. Cloudflare DNS + Azure managed TLS |                                                                                                                                                                          |

**Notable non-choices:** no TypeScript yet (parked, Tier 9.10); no Storybook (9.11); no Redux/Zustand; no React Router (fake routing via a `view` context slot); no WebSocket/SSE (Tier 7); **no managed Redis** (so in-memory caches are single-instance-coherent — materialized scores in Postgres removed the only cross-replica coherence problem that mattered); **no ML cron job / no separate ML image** (Tier 17 deleted them).

---

## 4. Repository Layout

This is the **current** tree, verified against the working copy.

```
ScoreCast/
├── server.js                 # Express composition shell (~357 LOC): boot, middleware, CSP directives,
│                             #   route mounts (16 routers), scheduler.register (6 jobs), graceful SIGTERM.
│                             #   require('./lib/instrument') MUST be line 1.
├── package.json              # deps + scripts: dev, build, start, preview, lint, format[:check],
│                             #   db:migrate[:undo[:all]][:status], db:seed[:undo], test:unit, test:e2e[:ui],
│                             #   test:screenshots, generate-pwa-assets, assets:marketing
├── .sequelizerc              # points sequelize-cli at config/database.js + migrations/ + seeders/
├── config/database.js        # dev/test/production blocks; pool {max:20,min:2,idle:10000,acquire:30000};
│                             #   dialectOptions.ssl when DATABASE_URL contains sslmode=require
├── data.json                 # demo seed: 3 users (incl. admin vo123), 3 games, 2 groups, 3 picks.
│                             #   Loaded by seedDatabase() ONLY when the users table is empty (see §7.2).
├── vite.config.js            # dev proxy /api→:3000 + PWA plugin + manualChunks
│                             #   (vendor, sentry, radix, motion, charts, html-to-image)
├── tailwind.config.js        # token → rgb(var(--c-*) / <alpha-value>) mapping + keyframes + boxShadow tokens
├── postcss.config.js  .prettierrc.json  .prettierignore  eslint.config.js
├── .husky/{pre-commit,pre-push}   # pre-commit: lint-staged; pre-push: npm run build
├── Dockerfile  .dockerignore  docker-compose.yml
├── index.html                # SPA shell + OG/Twitter/canonical meta + inline JSON-LD (CSP-hashed)
│
├── migrations/               # 41 versioned files (sequelize-cli + umzug) — see §7.3
├── seeders/
│   ├── 20260513000001-seed-password-backfill.js
│   ├── 20260522000001-seed-teams-from-elo-history.js        # PL Elo bootstrap (walks committed CSVs)
│   ├── 20260528000003-seed-teams-from-intl-elo-history.js   # INT (WC) Elo bootstrap
│   └── reconcileMap.json     # CSV-name → canonical-name alias map for the JS seeders
│
├── lib/                      # process-local helpers + cross-cutting infra
│   ├── logger.js             # pino (pretty dev / JSON prod, LOG_LEVEL)
│   ├── instrument.js         # Sentry.init — first require() in server.js (OpenTelemetry needs pre-Express)
│   ├── sentry.js             # captureException + setupExpressErrorHandler (no-op without SENTRY_DSN)
│   ├── email.js              # send({to,subject,html,text}) — Resend or log-only. NEVER throws.
│   ├── emailHelpers.js       # sendVerificationEmail (wraps lib/email; stamps users.lastVerificationSentAt)
│   ├── emailTemplates.js     # branded HTML for verify + password-reset
│   ├── auth.js               # createAccessToken, setAuthCookies({transaction}), clearAuthCookies,
│   │                         #   hashToken, generateRawToken, revokeAllUserRefreshTokens,
│   │                         #   CHALLENGE_COOKIE/CHALLENGE_TTL_MS (dormant 2FA)
│   ├── scoring.js            # scorePick (3-branch) + sortLeaderboard — AUTHORITATIVE
│   ├── users.js              # getUserById/ByUsername; buildUserSummary (legacy — TIER24_LEGACY rollback)
│   ├── groups.js             # getGroupsForUser/ById, getPendingInvites, buildGroupLeaderboard (legacy)
│   ├── groupLabel.js         # formatGroupLabel(group) → "Name #ABCDEF"
│   ├── friends.js            # getFriendshipBetween, friendStatusFrom, getViewerFriendIdSet (masking input)
│   ├── response.js           # attachResponseHelpers → res.ok / res.created / res.noContent
│   ├── errors.js             # AppError + factories (notFound/forbidden/badRequest/conflict/...)
│   ├── errorMiddleware.js    # global error handler → JSON {error,[issues]}
│   ├── openapi.js            # zod → OpenAPI 3.0 (dev-only /api/docs)
│   ├── cache.js              # generic TTL Map cache (footballApi + crowd + stats)
│   ├── footballApi.js        # football-data.org v4 client; 10s AbortController; sliding rate window
│   ├── fixtureStatus.js      # STATUS_MAP + mapUpstreamStatus + deriveResultFromFixture (single source)
│   ├── leaderboardCache.js   # getOrBuild/invalidate/invalidatePrefix/stats — 30s TTL Map
│   ├── scheduler.js          # node-cron wrapper + pg_try_advisory_lock(crc32(name)); no-op in test
│   ├── jobs/
│   │   ├── syncFixtures.js                # daily 03:00 UTC
│   │   ├── syncLiveScores.js              # every 30s (cost-gated)
│   │   ├── reconcileInProgressGames.js    # every 3min (defensive ?ids= sweep)
│   │   ├── lockPickProbabilities.js       # every 1min (kickoff-time lock)
│   │   ├── sendKickoffReminders.js        # every 15min
│   │   └── sendWeeklyRecap.js             # Mon 02:00 UTC
│   └── ml/
│       ├── eloMath.js          # K=20, INITIAL=1500, HFA=0; eloDelta(h,a,r,{kMultiplier,neutral})
│       ├── xgboostInference.js # zero-dep native-JSON tree walker + softmax; parseBaseScore hex fix
│       ├── normalize.js        # toThreeWay → DECIMAL(3,2) trio
│       └── models/PL_elo.json  INT_elo.json   # committed booster dumps
│
├── middleware/
│   ├── requestId.js  auth.js  optionalAuth.js  csrf.js  rateLimit.js  auditLog.js  asyncHandler.js
│
├── routes/                   # 16 routers mounted at /api
│   ├── auth.js  client-errors.js  me.js  games.js  picks.js  groups.js  leaderboard.js
│   ├── friends.js  users.js  comments.js  notifications.js  leagues.js  push.js  admin.js
│   ├── health.js  docs.js (dev-only)
│
├── services/                 # 15 services (pure domain logic; no req/res; throw AppError)
│   ├── NotificationService  BadgeService  LeaderboardService  CommentService  PickService
│   ├── GameService  GroupService  UserService  LeagueService  PredictionService
│   ├── AuditLogService  PushService  UserScoreService  StreakService  StatsService
│
├── models/                   # 22 models + index.js (init + associations + umzug shim + seedDatabase)
│   ├── User  Game  Group  GroupMember  GroupInvite  GroupJoinRequest  Pick  Badge
│   ├── Friendship  Comment  CommentReaction  Notification
│   ├── EmailVerificationToken  PasswordResetToken  RefreshToken  PushSubscription
│   ├── League  Season  Team  AuditLog  UserScore  UserScoreOverall
│
├── badges/catalog.js         # 23 badge slugs/names/emojis (source of truth)
├── validation/
│   ├── schemas.js            # all zod schemas + CURRENT_TERMS_VERSION + PUSH_NOTIFICATION_TYPES +
│   │                         #   ALLOWED_EMOJIS + noProfanity + pushSubscribeSchema endpoint allowlist
│   └── middleware.js         # validate(schema) → 400 with first issue
│
├── src/                      # React frontend
│   ├── main.jsx              # createRoot; applyTheme (sync); Orbitron 500..900; LazyMotion → Notification
│   │                         #   → Auth → AuthGate → Data → App; ErrorBoundary; clientErrorReporter; initSentry
│   ├── App.jsx               # ~136 LOC: legal short-circuit + skip link + status banner + 3-way switch +
│   │                         #   TermsAcceptanceModal + OnboardingTour
│   ├── views/                # SkeletonView AuthView DashboardView SettingsView FriendsView
│   │                         #   GroupsView LeaderboardView
│   ├── contexts/             # NotificationContext AuthContext AuthGateContext DataContext
│   ├── hooks/                # useAuth/useData/useNotifications/useAuthGate (re-exports) + useRequest +
│   │                         #   useGames usePicks useGroups useLeaderboard useFriends useFriendsPicks
│   ├── lib/                  # clientErrorReporter sentry apiClient cookies theme motion motionVariants
│   │                         #   a11y terms share
│   ├── utils/                # scoring.js (MIRROR of lib/scoring.js) time.js teamNames.js
│   ├── index.css             # @tailwind + tokens (:root dark, :root[data-theme=light]) + utilities
│   ├── sw.js                 # service worker (injectManifest): precache + runtime cache + push + notificationclick
│   └── components/           # ~60 components incl. ui/ (Radix wrappers), admin/, legal/
│
├── ml/                       # training-only Python (Tier 17 trim: no Docker/Bicep/cron/inference/db/scripts)
│   ├── README.md  requirements.txt
│   ├── data/raw/PL_*.csv     # 32 PL seasons, committed (gitignore negation !ml/data/raw/*.csv)
│   ├── scorecast_ml/         # cli.py (single `train`) · train/model.py · elo/engine.py ·
│   │                         #   ingest/{football_data_uk,international}.py · reconcile/teams.json
│   └── tests/                # pytest: Elo, ingest, training, intl parity
│
├── international_match_archive/   # martj42 dataset: results.csv (~49k) + former_names.csv + goalscorers.csv
│
├── scripts/                  # operator tools (.mjs, ASCII-safe for az containerapp exec)
│   ├── backfill-user-scores  exercise-user-scores  recompute-streaks
│   ├── query-teams  find-game  repair-test-game-elo  backfill-probabilities
│   ├── run-int-seed  inspect-wc-state  fixup-wc-state  list-wc-team-elo  activate-wc-league
│   ├── grant-beta-badge  notify-beta-badge
│   └── generate-pwa-assets  generate-marketing-assets
│
├── tests/                    # node:test unit tests (eloMath/normalize/xgboostInference/streakService/
│   │                         #   statsService/userScore) + e2e/ Playwright
│   └── e2e/                  # UI/flow specs + api/ per-endpoint suite + helpers/ + fixtures/
│
├── infra/                    # Bicep IaC
│   ├── main.bicep
│   └── modules/              # logs registry secrets db app migrate-job dns   (NO ml-job — deleted Tier 17)
│
├── .github/workflows/        # ci.yml + deploy.yml   (NO ml-deploy.yml — deleted Tier 17)
│   └── dependabot.yml
└── dist/                     # vite build output, served static by server.js
```

---

## 5. Backend Architecture

### 5.1 Process model

A single Node process listens on `PORT` (default `3000`). It does three jobs simultaneously:

- **Static serving** of the built SPA (`dist/`) via `express.static`, with a catch-all `app.get('*')` returning `dist/index.html` for client-side routing.
- **JSON API** at `/api/*`.
- **In-process cron scheduler** (`lib/scheduler.js`) running 6 jobs.

There is **no separate worker process and no PM2 wrapper.** A restart loses in-memory rate-limit counters, lockout counters, the leaderboard cache, the fixture cache, the per-replica ML model cache, and any in-flight cron tick (the next tick recovers — fixture sync is idempotent; live-score self-heals via the reconcile pass). Durable state lives in Postgres, so sessions survive a restart (refresh tokens are rows).

**`app.set('trust proxy', 1)`** — set to `1` (single hop), deliberately **not** `true`. So `req.ip` resolves to the real client IP through the Cloudflare → Azure Container Apps ingress chain (one trusted hop). With `true`, a client could spoof `X-Forwarded-For` and bypass every per-IP rate limiter; with `1`, only the one trusted proxy hop is honoured.

### 5.2 Boot sequence (server.js)

```
1.  require('./lib/instrument')   // LINE 1 — Sentry.init via OpenTelemetry; must precede express/sequelize
2.  build express app; app.set('trust proxy', 1)
3.  wire global middleware chain (§5.3)
4.  mount 16 routers at /api  (auth, client-errors, me, games, picks, groups, leaderboard,
       friends, users, comments, notifications, leagues, push, admin) + health (root) + docs (dev-only)
5.  app.use('/api', 404 JSON sentinel)        // unknown /api/* → JSON 404, not SPA HTML
6.  app.get('*') → sendFile(dist/index.html)  // SPA fallback (Cache-Control: no-cache)
7.  sentry.setupExpressErrorHandler(app)      // after all routes
8.  initDatabase()  (§7.2): authenticate → sync({alter:false}) → runMigrations → seedDatabase
9.  server = app.listen(PORT)                 // listener up BEFORE background jobs so probes pass
10. scheduler.start()                         // register + start 6 cron jobs (no-op in test)
11. wire SIGTERM/SIGINT graceful shutdown (§5.8)
```

The 6 registered jobs (cron expressions all env-overridable):

| Job                        | Default                     | Env override                   | Purpose                                              |
| -------------------------- | --------------------------- | ------------------------------ | ---------------------------------------------------- |
| `syncFixtures`             | `0 3 * * *`                 | `FIXTURE_SYNC_CRON`            | Daily fixture sync over active leagues               |
| `syncLiveScores`           | `*/30 * * * * *` (30 s)     | `LIVE_SCORE_SYNC_CRON`         | LIVE poll + `?ids=` reconcile; COUNT cost-gate       |
| `reconcileInProgressGames` | `*/3 * * * *`               | `IN_PROGRESS_RECONCILE_CRON`   | Defensive `?ids=` sweep vs upstream filter staleness |
| `lockPickProbabilities`    | `* * * * *` (1 min)         | `LOCK_PICK_PROBABILITIES_CRON` | Kickoff-time pick-probability lock                   |
| `sendKickoffReminders`     | `*/15 * * * *`              | `KICKOFF_REMINDER_CRON`        | Push 15–30 min before kickoff                        |
| `sendWeeklyRecap`          | `0 2 * * 1` (Mon 02:00 UTC) | `WEEKLY_RECAP_CRON`            | Weekly recap push                                    |

### 5.3 Request lifecycle & global middleware

Every request passes top-to-bottom:

```
1.  requestId          assigns req.id (inbound X-Request-Id ≤200 chars, else crypto.randomUUID());
                       req.log = logger.child({reqId}); echoes X-Request-Id response header
2.  pino-http          one structured access log per request; customLogLevel maps ≥500→error, ≥400→warn
3.  compression()      gzip when Accept-Encoding allows and body > ~1 KB
4.  helmet({...})      CSP (§5.3a), HSTS (maxAge 63072000, includeSubDomains, preload),
                       frameguard DENY, nosniff, Referrer-Policy no-referrer; COEP/COOP/CORP disabled
5.  Permissions-Policy camera=() microphone=() geolocation=() payment=() usb=() fullscreen=()
                       accelerometer=() gyroscope=() magnetometer=() interest-cohort=()
6.  cors(allowlist)    origin: CORS_ORIGINS split/trimmed; throws on boot in prod if empty;
                       localhost-only fallback in dev/test; credentials: true always
7.  bodyParser.json({limit:'32kb'})
8.  cookieParser()
9.  csrfMiddleware     sets sc_csrf if missing; enforces X-CSRF-Token == sc_csrf (timingSafeEqual)
                       on POST/PUT/PATCH/DELETE unless path ∈ EXEMPT_PATHS
10. Cache-Control      /assets/<hashed>.* → public, max-age=31536000, immutable;
                       everything else (index.html, sw.js, manifest, icons) → no-cache
11. express.static(dist/)
12. (per-route) rateLimit | authMiddleware|optionalAuth | requireAdmin | validate | auditMutation
13. asyncHandler(handler)  → thrown AppError → errorMiddleware → JSON {error,[issues]}
14. app.use('/api', 404)   → JSON 404 for unknown /api/*
15. app.get('*')           → dist/index.html (SPA)
16. sentry error handler   → captures next(err)-propagated errors (no-op without SENTRY_DSN)
```

**5.3a — Content-Security-Policy directives** (in `server.js cspDirectives`):

```
defaultSrc 'self'
scriptSrc  'self' 'sha256-GhzleH2mfEY14NZF8AZ+UWxx4YN/y6+t46pWTLHVEUo='   // the inline JSON-LD block
styleSrc   'self' 'unsafe-inline'                  // Tailwind injects inline <style>
imgSrc     'self' data:                            // Avatar generates data: SVG/HSL; OG images
connectSrc 'self' https://*.sentry.io https://*.ingest.sentry.io
           (+ ws://localhost:5173, http://localhost:5173 in dev for Vite HMR)
fontSrc    'self' data:
workerSrc  'self'      manifestSrc 'self'          // PWA
frameAncestors 'none'  objectSrc 'none'
upgradeInsecureRequests (prod only)
```

> **JSON-LD hash gotcha:** `index.html` carries a single-line inline `<script type="application/ld+json">` block for Google's rich result. Its SHA-256 hash is whitelisted literally in `scriptSrc`. **Any whitespace or content change to that block requires recomputing the hash** via the one-liner documented at the top of `cspDirectives`. Reformat-on-save will silently break the SERP rich result.

### 5.4 Middleware reference

**`requestId`** ([middleware/requestId.js](middleware/requestId.js)) — first in the chain. Reads a sane inbound `X-Request-Id` or generates a UUID v4; sets `req.id`, echoes the header, attaches `req.log = logger.child({reqId})`. Every handler error line is auto-tagged, so a 500 returned to a user (whose response carries `X-Request-Id`) is traceable to the exact handler invocation.

**`authMiddleware`** ([middleware/auth.js](middleware/auth.js)) — reads `req.cookies.sc_access` only (**bearer-header auth was removed in Tier 6.8**). Verifies with `jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })` — algorithm pinned (jsonwebtoken@9 already rejects `alg:none`, but pinning is belt-and-braces). On success attaches `{id, username, role}` to `req.user`; else 401.

`JWT_SECRET` resolution: `process.env.JWT_SECRET`; absent in prod → server throws on boot; absent in dev → warns and uses a literal dev-only secret (tokens not portable / not prod-safe).

**`requireAdmin`** — `if (req.user?.role !== 'admin') return 403`. Always after `authMiddleware`. Guards `/api/admin/*` and the legacy `POST /api/games/:gameId/result`.

**`optionalAuth`** ([middleware/optionalAuth.js](middleware/optionalAuth.js)) — same decode but **NEVER 401s**: on missing/invalid/expired token sets `req.user = null` and calls `next()`. Used on every public-read GET (`/games`, `/games/:id/comments`, `/leaderboard`, `/groups/discover`, `/groups/:id`, `/groups/:id/comments`, `/search`, `/users/:username/profile`, `/leagues`), paired with `publicReadLimiter`. Service code branches on `req.user === null` to gate writes and apply per-viewer masking.

**`validate(schema)`** ([validation/middleware.js](validation/middleware.js)) — `schema.safeParse(req.body)`; on failure 400 `{error: <first issue message>, issues: [{path, message}]}`; on success **replaces `req.body` with the parsed (trimmed/coerced/defaulted) value** so handlers can trust it. **It only handles `req.body`** — query params are validated _inline_ (e.g. `leaderboardQuerySchema.safeParse(req.query)` in the leaderboard route). Schemas live in [validation/schemas.js](validation/schemas.js).

**Rate limiters** ([middleware/rateLimit.js](middleware/rateLimit.js), all `standardHeaders: true, legacyHeaders: false`, all skipped when `NODE_ENV=test`):

| Limiter                   | Budget          | Applied to                                                                                        |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `loginLimiter`            | 5 / 15 min / IP | `POST /api/login`                                                                                 |
| `registerLimiter`         | 3 / hour / IP   | `POST /api/register`                                                                              |
| `clientErrorLimiter`      | 30 / 5 min / IP | `POST /api/client-errors`                                                                         |
| `commentLimiter`          | 10 / min / IP   | game + group comment POST                                                                         |
| `friendRequestLimiter`    | 10 / 5 min / IP | `POST /api/friends/request`                                                                       |
| `pickLimiter`             | 30 / min / IP   | `POST /api/picks`, `DELETE /api/picks/:id`                                                        |
| `forgotPasswordLimiter`   | 3 / hour / IP   | `POST /api/auth/forgot-password`                                                                  |
| `publicReadLimiter`       | 240 / min / IP  | every `optionalAuth` GET                                                                          |
| `sensitiveAccountLimiter` | 10 / hour / IP  | `/me/password`, `/me/email`, `/me/resend-verification`                                            |
| `lightWriteLimiter`       | 60 / min / IP   | `/me/{push-preferences,onboarding-completed,accept-terms}`, `PUT /me`, notification read/read-all |
| `inviteLimiter`           | 5 / min / IP    | `POST /api/groups/:id/invite`                                                                     |

In-memory (per-process) store — a restart wipes counters; at multi-replica the per-IP budget leaks up to N× (the documented reason for the parked C1 Redis lever). **Account lockout** is layered on top of `loginLimiter`: 5 failed password attempts against one user → `users.lockedUntil = NOW+15min`; identical generic `401 {error:'Invalid credentials'}` for wrong-pw / unknown-user / locked (no enumeration); cleared on success or password reset.

**`csrfMiddleware`** ([middleware/csrf.js](middleware/csrf.js)) — double-submit. If `sc_csrf` is absent, generate 32 hex bytes and set a non-HttpOnly cookie (`Secure` in prod, `SameSite=Lax`, `Path=/`). On POST/PUT/PATCH/DELETE, require `X-CSRF-Token === sc_csrf` via `crypto.timingSafeEqual`; mismatch → 403. `EXEMPT_PATHS` = `/api/login`, `/api/register`, `/api/auth/refresh`, `/api/auth/verify-email`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/client-errors` — **pre-auth/anonymous mutations only; never add a post-auth endpoint.** The cookie is intentionally JS-readable (the pattern relies on same-origin preventing cross-origin reads); `SameSite=Lax` is the first wall, double-submit the belt.

**`auditMutation(action, entityType)`** ([middleware/auditLog.js](middleware/auditLog.js)) — wraps every mutating `/api/admin/*` route, **placed BEFORE `validate`** so it captures the raw inbound payload (not the zod-coerced version). Subscribes to `res.on('finish')` so the real `res.statusCode` is recorded (200/400/409/500). Calls `AuditLogService.record(...)` which truncates payloads >4 KB to `{_truncated, _bytes, preview}`. **Never throws back into the request lifecycle** — an audit-log outage can't block a real admin action. Auth-failures (401/403 thrown before this runs) are _not_ audited by design. Action strings follow `admin.<entity>.<verb>`.

**`asyncHandler`** ([middleware/asyncHandler.js](middleware/asyncHandler.js)) — wraps async handlers so a thrown `AppError` flows to `errorMiddleware`.

**CORS** (in server.js):

```js
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && corsOrigins.length === 0)
  throw new Error('CORS_ORIGINS env var is required in production');
const fallback = ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];
app.use(cors({ origin: corsOrigins.length ? corsOrigins : fallback, credentials: true }));
```

### 5.5 Authentication cookies & tokens

Issued by `setAuthCookies(res, user, {userAgent, transaction?})` (login, register, refresh, password-change):

| Cookie       | Type               | Path        | HttpOnly | TTL     | Contents                                           |
| ------------ | ------------------ | ----------- | -------- | ------- | -------------------------------------------------- |
| `sc_access`  | JWT HS256          | `/`         | yes      | 15 min  | `{id, username, role}`                             |
| `sc_refresh` | opaque 32-byte hex | `/api/auth` | yes      | 30 days | raw value; SHA-256 hash stored in `refresh_tokens` |
| `sc_csrf`    | random 32-byte hex | `/`         | **no**   | 30 days | rotates only on explicit clear                     |

`Secure: true` in production only. `createAccessToken(user) = jwt.sign({id,username,role}, JWT_SECRET, {expiresIn: 900})`. **Refresh rotation:** every `POST /api/auth/refresh` opens a transaction, `SELECT ... FOR UPDATE` on the inbound row, revokes it (`revokedAt = NOW()`), and issues a fresh pair — so two parallel tabs sharing one cookie serialize (the first rotates, the second sees `revokedAt != null` → 401). `setAuthCookies` accepts `{transaction}` so revoke+create stays atomic under the lock. Login on a new device does **not** revoke others (each device has its own chain; `refresh_tokens.userAgent` is captured for a future "sessions" UI). `revokeAllUserRefreshTokens(userId)` (password reset + in-session password change) is the force-logout-everywhere primitive.

**Token storage pattern:** high-entropy tokens (verify-email, password-reset, refresh) are 32 random hex bytes; the **raw value lives only in transit** (email link or cookie), and `SHA-256(raw)` is stored in `tokenHash` (unique-indexed, O(1) lookup, no bcrypt — 256 bits is brute-infeasible). Low-entropy recovery codes (dormant 2FA) are the exception — `bcrypt.hash(code, 8)`, looped on verify.

### 5.6 Route catalogue (every endpoint)

Routers mount at `/api` in this order; **`/api/groups/discover` registers before `/api/groups/:groupId`** so Express doesn't treat `discover` as a path param (same rule for any future `/api/groups/<literal>`).

**Auth** ([routes/auth.js](routes/auth.js)):

- `POST /register` — body `{username, password, email, acceptedTerms: literal(true), acceptedTermsVersion: literal(CURRENT_TERMS_VERSION), confirmedAge: literal(true), referralCode?}`. Stamps `termsAcceptedAt/Version`, generates `referralCode` (5× retry on unique-violation), stamps `referredByUserId` if a valid code is supplied (unknown codes silently ignored), fires `sendVerificationEmail` fire-and-forget. Response `{user}` (cookies set; no token in body).
- `POST /login` — `{username, password}`. **Constant-time** (always `bcrypt.compare` against the real hash OR `LOGIN_DUMMY_HASH` generated once at module load). Lockout. _(2FA is parked, so login always returns `{user}` — the `challenge:true` branch was removed.)_
- `POST /auth/verify-email` — `{token}` → set `emailVerifiedAt`, consume token.
- `POST /auth/forgot-password` — `{email}`. **Always 204.** Token INSERT + email dispatch moved to `setImmediate(...)` so the 204 latency is dominated only by the user lookup that runs in all branches (closes the timing channel).
- `POST /auth/reset-password` — `{token, password}`. Atomically: re-hash (model hook), clear lockout, `revokeAllUserRefreshTokens`.
- `POST /auth/refresh` — reads `sc_refresh`, `FOR UPDATE` + rotate; 204 on success, 401 + cleared cookies on failure.
- `POST /auth/logout` — revoke the inbound refresh row, clear cookies; 204.

**Client errors** ([routes/client-errors.js](routes/client-errors.js)): `POST /client-errors` — CSRF-exempt, soft-auth (logs `userId` if a valid token is present, else anonymous), structured-logs the payload at `error`/`warn`, always 204.

**Me** ([routes/me.js](routes/me.js)):

- `GET /me` — `{id, username, role, displayName, bio, email, emailVerifiedAt, lastVerificationSentAt, twoFactorEnabled (no-op false), profileVisibility, onboardingCompletedAt, termsAcceptedAt, termsAcceptedVersion, pushPreferences, referralCode, streak:{current,longest}, joinedGroups, pendingInvites}`.
- `PUT /me` — `{displayName?, bio?, profileVisibility?}` (validated by `editProfileSchema`: trim, length caps, reject bidi-override/zero-width/control codepoints — ZWJ U+200D allowed for emoji, profanity refine). Invalidates the `'all'` leaderboard cache when `displayName` OR `profileVisibility` actually changes.
- `POST /me/onboarding-completed` — idempotent stamp.
- `POST /me/accept-terms` — `{version}`; 400 if `version !== CURRENT_TERMS_VERSION` (stale-tab guard); stamps both columns.
- `POST /me/resend-verification` — `sensitiveAccountLimiter`; already-verified → 200 `{sent:false, alreadyVerified:true}` (non-enumerating).
- `PUT /me/push-preferences` — JSONB merge (partial update doesn't clobber).
- `PATCH /me/email` — `{email, currentPassword}`; bcrypt-compare; notifies the OLD address before overwriting; clears `emailVerifiedAt`; sends fresh verification.
- `POST /me/password` — `{currentPassword, newPassword}`; bcrypt-compare; save (hook re-hashes); `revokeAllUserRefreshTokens`; `setAuthCookies` again (caller stays signed in, every other device kicked out).
- `GET /me/stats?window=30d|90d|season` — personal dashboard payload (§8.35).

**Games** ([routes/games.js](routes/games.js)): `GET /games` (`optionalAuth`+`publicReadLimiter`, `?leagueId=&seasonId=` UUID-guarded; crowd gate); `POST /games/:gameId/result` (admin; `{result:'home'|'away'|'draw'|null}`); `GET|POST /games/:gameId/comments`.

**Picks** ([routes/picks.js](routes/picks.js)): `GET /picks`, `POST /picks`, `DELETE /picks/:id`, `GET /picks/friends?gameId=` (±30 d, 500 rows, server-scored + masked).

**Groups** ([routes/groups.js](routes/groups.js)): `GET /groups`; `GET /groups/discover`; `GET /groups/:groupId`; `POST /groups`; invite / accept / decline; `POST /:id/join` (public/password); `POST /:id/leave`; `POST /:id/transfer`; `POST /:id/visibility`; `DELETE /:id`; join-request request/approve/deny (Tier 19); `GET|POST /:id/comments`.

**Leaderboard** ([routes/leaderboard.js](routes/leaderboard.js)): `GET /leaderboard?groupId=&leagueId=&seasonId=&orderBy=&offset=&limit=&overallOffset=&overallLimit=` — `optionalAuth`+`publicReadLimiter`, query validated inline, masking applied.

**Friends** ([routes/friends.js](routes/friends.js)): `POST /friends/request`, `/friends/:id/accept`, `/friends/:id/decline`, `DELETE`, `GET /friends`.

**Users** ([routes/users.js](routes/users.js)): `GET /search?q=&type=` (`optionalAuth`); `GET /users/:username/profile` (`optionalAuth`; privacy gate).

**Comments** ([routes/comments.js](routes/comments.js)): `PUT /comments/:id`, `DELETE /comments/:id`, `POST /comments/:id/reactions`, `DELETE /comments/:id/reactions/:emoji`.

**Notifications** ([routes/notifications.js](routes/notifications.js)): `GET /notifications`, `POST /:id/read`, `POST /read-all`.

**Leagues** ([routes/leagues.js](routes/leagues.js)): `GET /leagues` — public; active leagues with `seasons[]`.

**Push** ([routes/push.js](routes/push.js)): `GET /push/vapid-public-key` (503 when VAPID unset), `POST /push/subscribe`, `DELETE /push/subscribe`.

**Admin** ([routes/admin.js](routes/admin.js), every mutation `auditMutation`-wrapped): games `POST/PUT/DELETE` + `POST /bulk` (cap 500, actions delete/setResult); users `GET` + `:id/role` + `DELETE :id` + `POST /bulk` (cap 100, actions promote/demote/delete, self-skip→`skipped[]`); leagues `GET/POST/PUT/DELETE` + `:id/sync`; `GET /audit-log?limit=&offset=` (cap 200); `GET /cache-stats`.

**Health** ([routes/health.js](routes/health.js)): `GET /healthz` (root, no `/api` prefix; liveness; **no DB ping; body `{ok:true}` exactly** — used by ACA liveness + Docker HEALTHCHECK); `GET /readyz` (DB `SELECT 1`; 503 on failure; ACA readiness probe). **They are intentionally different** — a transient DB outage should pull a replica out of rotation (`/readyz` fails) but NOT restart the container (`/healthz` stays 200).

**Docs** ([routes/docs.js](routes/docs.js)): `/api/openapi.json` + `/api/docs` (Swagger UI) — mounted **only when `NODE_ENV !== 'production'`** (attack-surface reduction).

Then `app.use('/api', 404 JSON sentinel)` (so unknown `/api/*` returns JSON 404, not the SPA HTML — the sentinel sits below the dev-only docs and above the SPA catch-all) and `app.get('*') → dist/index.html`.

### 5.7 Service layer & side-effect helpers

Routes are thin: **parse → auth → call a service → respond.** All business logic, cache invalidation, notify/badge/streak side-effects, and cascades live in services (pure functions; no `req`/`res`; throw `AppError`).

Canonical helper homes and call sites:

| Helper                                                                                                  | Home                     | Called from                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scorePick(pick, game)`                                                                                 | `lib/scoring.js`         | `buildUserSummary`, `buildGroupLeaderboard`, `getProfileByUsername`, `GameService.{setResult,bulkSetResult,applyLiveUpdate}`, `UserScoreService.computePoints`, `StatsService`, `PickService.listFriendsPicks` |
| `notify(userId,type,title,body?,link?)`                                                                 | `NotificationService`    | Pick/Game/Group services, `BadgeService.awardBadge`, friend routes, `CommentService.fanOutGroupComment`, jobs                                                                                                  |
| `awardBadge` / `evaluateBadges` / `computeProgressForUser`                                              | `BadgeService`           | pick create, result set, group create, friend events; referrer fan-out                                                                                                                                         |
| `applyForUser` (streak)                                                                                 | `StreakService`          | `GameService.{setResult,bulkSetResult,applyLiveUpdate}` (post-tx)                                                                                                                                              |
| `applyPickTransition` / `reversePick` / `applyDelta`                                                    | `UserScoreService`       | 7 write hooks (in-tx)                                                                                                                                                                                          |
| `getOverall[ForViewer]` / `getForGroup[ForViewer]` / `invalidate` / `invalidatePrefix` / `assertParity` | `LeaderboardService`     | leaderboard route + every standings-affecting mutation                                                                                                                                                         |
| `cascadeDelete({transaction})`                                                                          | User/Game/Group services | admin delete + bulk + group delete                                                                                                                                                                             |
| `applyLiveUpdate` / `upsertFixture` / `syncFixtures`                                                    | Game/League services     | live-score + reconcile jobs + admin sync                                                                                                                                                                       |
| `onResultUpdated` / `rePredictFutureFixtures`                                                           | `PredictionService`      | inside + after the result-capture transaction                                                                                                                                                                  |
| `setAuthCookies` / `clearAuthCookies` / `revokeAllUserRefreshTokens` / `generateRawToken` / `hashToken` | `lib/auth.js`            | auth + me routes                                                                                                                                                                                               |
| `sendVerificationEmail`                                                                                 | `lib/emailHelpers.js`    | register, PATCH /me/email, resend                                                                                                                                                                              |
| `record`                                                                                                | `AuditLogService`        | `auditLog` middleware `res.on('finish')`                                                                                                                                                                       |
| `sendToUser`                                                                                            | `PushService`            | `NotificationService.notify` (post-insert, fire-and-forget)                                                                                                                                                    |

### 5.8 Transactional cascades & graceful shutdown

**Cascades** accept `{transaction}` and forward it to every internal `destroy()`. Single-item admin deletes wrap one `sequelize.transaction(async t => cascadeDelete(x, {transaction:t}))`. **Bulk endpoints run one transaction _per entity_** — a single bad row aborts the batch but everything already committed stays orphan-free; the `affected[]`/`skipped[]` response implies per-row success. A mid-cascade exception rolls back the whole helper, leaving parent + children intact.

**Notify/badge/streak calls fire OUTSIDE the cascade transaction** (post-commit) so a rollback never produces ghost rows. The two exceptions — `PredictionService.onResultUpdated` (Elo) and `UserScoreService.applyPickTransition` (materialized delta) — run _inside_ the result-capture transaction because they're part of the atomic write; their downstream effects (re-prediction, notifications) are post-commit.

**Graceful SIGTERM** (Tier 20 Chunk 7): the handler runs in exact order — (1) `server.close()` (stop new, drain in-flight); (2) 25 s race timeout (5 s under Azure's 30 s `terminationGracePeriodSeconds`); (3) `scheduler.stop()` (cron handlers are idempotent, so a partial tick recovers next pod); (4) `sequelize.close()`; (5) `process.exit(0)`. Timeout → exit(1) so a failed drain surfaces in deploy logs. A `shuttingDown` re-entry guard prevents double-fire. `tini` (Dockerfile entrypoint) forwards SIGTERM correctly. **Don't reorder** — closing sequelize before draining would 500 in-flight requests.

---

## 6. Frontend Architecture

### 6.1 Build pipeline & bootstrap

```
src/main.jsx executes, in order:
  1. applyTheme(getStoredTheme())     // SYNCHRONOUS, before React mounts → no flash-of-wrong-theme
  2. import @fontsource/orbitron latin-{500,600,700,800,900}.css   // share-card raster + LED numerals
  3. initSentry()                     // async dynamic import('@sentry/react'), gated on VITE_SENTRY_DSN
  4. installClientErrorReporter()     // window error + unhandledrejection listeners
  5. createRoot(#root).render(
       <StrictMode>
         <ErrorBoundary>
           <LazyMotion features={domAnimation} strict>     // motion/react, ~30 KB own chunk
             <NotificationProvider>      // status banner + scorecast:client-error subscription
               <AuthProvider>            // user, auth flow, browseAsGuest, showAuth, clearSession
                 <AuthGateProvider>      // gate(label) → SignInModal (anon-action gate)
                   <DataProvider>        // games/picks/groups/leaderboard/friends/filters + mutations
                     <App />             // ~136 LOC layout shell
```

`npm run dev` → Vite on `:5173` with HMR, proxying `/api/*` → `:3000` (configured in `vite.config.js`), so frontend code uses relative URLs in dev and prod. `npm run build` → `dist/`. **Code-splitting:** `React.lazy` + `<Suspense>` around `AdminPanel`, `ProfileView`, `PicksHistory`, the lazy views (`SettingsView`/`FriendsView`/`GroupsView`/`LeaderboardView`), and `StatsDashboard`. Vite `manualChunks` splits `react`/`react-dom` → `vendor`, `@sentry/*` → `sentry`, `@radix-ui/*` → `radix`, `motion/*` → `motion`, `recharts`+`d3-*`+`victory-vendor` → `charts`, `html-to-image` → its own chunk. Hidden sourcemaps emit for Sentry release upload.

### 6.2 State management — four contexts, zero Redux

Provider order matters (`src/main.jsx`): Notification → Auth → AuthGate → Data. Coordination is **event-driven, not imperative** — `AuthContext` only knows about `user`; `DataContext` _watches_ `user`.

| Context               | State slots                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NotificationContext` | `status` (single toast string) + listens for `scorecast:client-error` → 3.5 s toast                                                                                                                                                                                                                                                                                                                                                                                         |
| `AuthContext`         | `user`, `authData`, `authView` (`auth`/`forgot`/`reset`), `forgotSent`, `confirmingLogout`, `browseAsGuest` (persisted `localStorage.sc_browse_as_guest`), `showAuth` (initial reads `localStorage.sc_visited`), `clearSession`, `handleChangeEmail`, `handleChangePassword`, `handleResendVerification`. `performLogout` resets `browseAsGuest=false` + `showAuth=false` + clears `sc_visited` → explicit sign-out always lands on the marketing Landing.                  |
| `AuthGateContext`     | `gateLabel`, `isGateOpen`, `gate(label)` → opens `<SignInModal>`, `closeGate`. Composer surfaces use `<InlineGatePanel>` directly.                                                                                                                                                                                                                                                                                                                                          |
| `DataContext`         | `bootDone`, `loading`, `view`, `games`, `groups`, `picks`, `pendingInvites`, `friendsPicks`, `leaderboard`, `groupOrderBy`, `groupOffset`, `selectedGroupId`, `friends`, `discoverGroups`, `ownProfile`, `profile*`/`profileError`, `gameFilters {leagueId,seasonId}` (URL `?league=&season=`), `leaderboardFilters {leagueId,seasonId}` (URL `?lbLeague=&lbSeason=` — separate axis), + every mutation handler + `consumeDeepLinks` / `navigateToDeepLink` / `revalidate`. |

**`DataContext` watches `user` via `useEffect`:**

- `null → set` (login): `loadDashboard()` — parallel authed fetch of `/me`, `/games`, `/groups`, `/picks`, `/leaderboard`, `/friends`, `/groups/discover`, `/picks/friends`.
- `null + browseAsGuest` (boot): `loadAnonDashboard()` — parallel fetch of just public endpoints (games, leaderboard, discover, leagues).
- `set → null` (logout/session-expired): wipes owned slots (`groups`, `picks`, `friendsPicks`, `pendingInvites`, `selectedGroupId`, `view→'games'`, `friends`, `ownProfile`) **and resets `gameFilters` + `leaderboardFilters` to `{leagueId:'',seasonId:''}`** (P1-9 — closes a cross-account leak on shared browsers; without it, user A's filter would scope user B's views). Public slots stay populated so anon-browse picks up where logout left off.

**Boot decision tree** (`DataProvider.useEffect` on mount):

```
loadDashboard()  (sends cookies)
  ├─ 200 → user set → <DashboardView>
  ├─ 401 + browseAsGuest=true (localStorage) → loadAnonDashboard() → <DashboardView> (user=null)
  ├─ 401 + browseAsGuest=false → <AuthView> (Landing or auth grid by showAuth)
  └─ other error → showStatus(error.message)
  .finally(() => setBootDone(true))    // first paint is always <SkeletonView> until bootDone flips
```

**Selector hooks** ([src/hooks/](src/hooks/)) keep components narrow:

- `useAuth` / `useData` / `useNotifications` / `useAuthGate` — context re-exports.
- `useGames` — `{games, upcomingGames, liveGames, completedGames, byDay, refreshGames}`. `byDay` is a `Map<dayKey, Game[]>`; `dayKey(value)` (`Intl.DateTimeFormat('en-CA')` → `YYYY-MM-DD`) is exported so DataContext's deep-link consumer writes matching `?date=` keys. Buckets by `status` first, falling back to `result`.
- `usePicks` — `{picks, pickMap, submitPick, removePick}`. **`pickMap` stores full pick objects keyed by gameId** (not just `choice`) so GameCard can pass `existingPickId` to the undo handler.
- `useFriendsPicks` — `{friendsPicks, byGame: Map<gameId, FriendPick[]>}` (O(1) per-card lookup).
- `useGroups` / `useLeaderboard` / `useFriends` — projections.

**localStorage holds only non-secret UI state:** `sc_visited` (skip Landing for returning users), `sc_browse_as_guest`, `sc_theme` (legacy `'system'`→`'dark'`), `sc_sidebar_collapsed`. Auth state is inferred from `user` (set by the `/api/me` boot fetch); the actual session cookies are HttpOnly + invisible to JS.

### 6.3 The `useRequest()` hook — the heart of frontend↔backend comms

([src/hooks/useRequest.js](src/hooks/useRequest.js)):

```js
return useCallback(
  async (path, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = getCookie('sc_csrf');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    const doFetch = () => fetch(path, { credentials: 'include', ...options, headers });
    let response = await doFetch();
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      const ok = await refreshSession(); // single-flight: one shared inflightRefresh promise
      if (ok) response = await doFetch(); // retry once with rotated cookie
    }
    if (response.status === 401) {
      if (userRef.current) {
        clearSession();
        throw new Error('Session expired');
      }
      const err = new Error('Authentication required');
      err.status = 401;
      throw err;
    }
    // ... 204 / non-ok (err.wasHandled=true on 4xx) / JSON parse ...
  },
  [clearSession],
);
```

Key properties:

- **Always `credentials: 'include'`** (sends cookies); never an `Authorization` header.
- **CSRF auto-injection** from the `sc_csrf` cookie on mutations.
- **Single-flight refresh-then-retry** — a 401 on a non-`/api/auth/*` path awaits ONE shared `POST /api/auth/refresh` (module-level `inflightRefresh` promise via `refreshSession()`). When several requests 401 in the same process (view switches, `Promise.all` fan-outs), they all await the same refresh and then retry — instead of each firing its own, where only the first rotates and the rest 401 → spurious logout. **Don't revert to a per-call refresh.** This is what makes 15-min access tokens invisible: the session lives 30 days from one login.
- **Auto-handles still-401:** with a `user` in state → `clearSession()` (flips `user→null` → DataContext wipes slots) + throw `Session expired`; without a user → throw `Authentication required` (boot uses this to fall to the login screen silently).
- **`err.wasHandled = true` on every 4xx** → `clientErrorReporter` short-circuits (skips both the DOM event AND the server POST), so a validation/401 doesn't fire the generic "Something went wrong" toast over the real message. `FRIENDLY_ERROR_CODES` maps machine codes (`football_api_rate_limit`, `rate_limited`) to human copy.
- **Captures `X-Request-Id`** from each response into `setLastRequestId()` so a later client-error report carries the most recent server reqId.
- **`/api/auth/*` bypass:** `AuthContext` can't use `useRequest` (chicken-and-egg). Login/register/forgot/reset use a bare `apiFetch` from [src/lib/apiClient.js](src/lib/apiClient.js) (CSRF + fetch + JSON, no refresh-retry).

### 6.4 Routing, URL sync & deep-links

Routing is **fake** — the `view` slot on `DataContext` selects the top-level block; the URL doesn't change on a tab switch. Tabs: Matches / My Picks / Leaderboards / Friends / Groups / Profile / Settings (+ Admin when admin). View ids `'games'`/`'mypicks'`/`'groups'`/`'leaderboard'`/`'friends'`/`'profile'`/`'settings'`/`'admin'`.

**Two URL slots sync via `history.replaceState`** (no router): `?league=<code>&season=<year>` (games filters; uses the football-data `sourceLeagueId` code, e.g. `PL`, so links are shareable + stable across DB rebuilds — owned by `GameFiltersBar` → `gameFilters`) and `?lbLeague=&lbSeason=` (leaderboard scope — distinct keys — owned by `LeaderboardFiltersBar` → `leaderboardFilters`). Plus `?tab=<value>` for `<SubTabs>` surfaces.

**Deep-link consumption** — `DataContext.consumeDeepLinks(gamesList, groupsList)`:

- Runs ONCE on boot between data-load and `bootDone` (inside `loadDashboard().then(...)`).
- Recognizes `?view=` → `setView`; `?gameId=<uuid>` → resolves the game's day via `dayKey(game.date)`, writes a synthetic `?date=YYYY-MM-DD` (so GamesCalendar reads it on first mount — today's date _deletes_ `?date=`), `setView('games')`; `?groupId=<uuid>` → `setSelectedGroupId` + `setView('groups')`.
- Toasts "That game/group is no longer available" + strips the param when it doesn't resolve (anon boot passes `null` for groups so a valid public-group deep-link doesn't false-toast).
- Strips consumed params via `history.replaceState`; UUIDs regex-validated.

**`navigateToDeepLink(link)`** — the only sanctioned NotificationBell-click target. `new URL(link, origin)` (tolerates absolute/relative), `history.pushState`, re-runs `consumeDeepLinks`, dispatches a `scorecast:url-changed` `CustomEvent`, closes the bell popover. **The event bridge is load-bearing:** `pushState`/`replaceState` do NOT fire `popstate`, so any component whose state derives from URL params via a `useState` initializer (GamesCalendar reading `?date=`, SubTabs reading `?tab=`) listens for `scorecast:url-changed` and re-reads — otherwise it goes stale on in-app navigation.

**Server-side `link` convention** (every `notify()` call site populates it):

| Type                                                | Link                                       |
| --------------------------------------------------- | ------------------------------------------ |
| `pick-scored` / `odds-shifted` / `kickoff-reminder` | `/?gameId=<id>`                            |
| `badge`                                             | `/?view=profile&tab=badges`                |
| `invite` / `group-join` / `group-comment`           | `/?view=groups&groupId=<id>`               |
| `group-join` (group deleted)                        | `/?view=groups&deleted=1`                  |
| `friend-request` (sent / accepted)                  | `/?view=friends&tab=requests` / `&tab=all` |
| `streak-milestone` / `weekly-recap`                 | `/?view=profile`                           |

Three consumers: boot `consumeDeepLinks`, SW `notificationclick` (`clients.openWindow(data.link)`), in-app bell `navigateToDeepLink`. (A legacy redirect rewrites pre-Phase-1 `view=groups`-without-groupId-and-without-`&deleted=1` to `view=friends` for in-flight friend-request notifications.)

Also consumed on mount by `AuthContext`: `?verifyToken=`, `?resetToken=`, `?ref=CODE` (pre-fills register) — all stripped after read.

### 6.5 Component hierarchy (full tree)

```
<ErrorBoundary>                                  // render-error fallback wrapping the whole tree
└─ <LazyMotion features={domAnimation} strict>   // motion/react lazy bundle inherited by all <m.*>
   <NotificationProvider>                         // status banner + scorecast:client-error listener
     <AuthProvider>                               // user, auth flow, browseAsGuest, showAuth
       <AuthGateProvider>                         // anon-action gate (SignInModal mounted here)
         <DataProvider>                           // games/picks/groups/leaderboard/friends/filters + handlers
           <App>                                  // ~136 LOC layout shell
           ├─ pathname short-circuit (BEFORE bootDone/auth/view-switch):
           │     /terms /privacy /copyright /cookies → matching <LegalLayout> page, fullscreen,
           │     anon + authed identical, no skeleton wait
           ├─ skip-to-content link (visible on focus, target #main)
           ├─ radial gradient background + global status banner (role="status" aria-live="polite")
           └─ body (3-way switch on bootDone + user + showAuth):
               ├─ <SkeletonView>      // boot/loading — carries <main id="main">; SkeletonGameCard/Row
               ├─ <AuthView>          // unauthenticated
               │     showAuth=false → <Landing> (hero cascade · league ticker · stats count-up ·
               │                       asymmetric feature grid · how-it-works · CTA · 3rd "browse as guest")
               │     showAuth=true:
               │       authView='auth'   → <LoginForm> / <RegisterForm> (2 consent checkboxes)
               │       authView='forgot' → <ForgotPasswordForm>
               │       authView='reset'  → <ResetPasswordForm>  (entered via ?resetToken=)
               │     (AuthAmbient decorative aside on the md: split)
               └─ <DashboardView>     // authenticated OR anon-browse
                   ├─ <Sidebar>       // left column nav
                   │     desktop 240↔64px collapsible (localStorage.sc_sidebar_collapsed);
                   │     mobile (<md:) off-canvas drawer via hamburger;
                   │     items = <button role="tab"> (accessible name "<kicker> <label>" — Playwright-stable);
                   │     authed: Matches→My Picks→Leaderboards→Friends→Groups→Profile→(Admin);
                   │     anon: Matches / Groups / Leaderboards;
                   │     active indicator = <m.span layoutId="sidebar-active-indicator"> (auto-animates between tabs)
                   ├─ <main id="main">
                   │   ├─ TOP UTILITY BAR (Tier 30 Phase 3 mobile 2-row reorg):
                   │   │     mobile row 1: grid grid-cols-[1fr_auto_1fr] — true viewport-center BANTRYX
                   │   │        justify-self-start: hamburger (opens drawer)
                   │   │        center: BANTRYX wordmark (decorative aria-hidden; clickable home when authed)
                   │   │        justify-self-end: <UserMenu> (authed) OR [Sign in][Sign up][← Home] pills (anon)
                   │   │     mobile row 2: <RefreshButton> | min-w-0 flex-1 <SearchBar> | <NotificationBell>
                   │   │     desktop: one row (search center; action cluster right w/ vertical bg-divider strip);
                   │   │             <ThemeToggle> historically here, now in SettingsView→Appearance
                   │   │     (logout: UserMenu → "Sign out" → setConfirmingLogout → <ConfirmModal>)
                   │   │
                   │   ├─ view='games':
                   │   │     <GameFiltersBar>   // ?league=&season= URL sync → DataContext.gameFilters
                   │   │     <GamesCalendar>    // 7-day strip (today−3→+3), ±7d arrows, ?date= sync,
                   │   │                         //   "Back to today"/"Next game day" pill; selected day → list:
                   │   │     <GameCard>* (uses usePicks for submit/remove + pickMap):
                   │   │        ├─ status pill: live "Live · 67'" (useMatchMinute) / Draw / Final
                   │   │        ├─ <ScoreTile> per side (.font-led; AnimatePresence digit flip)
                   │   │        ├─ outcomeBadge (3-branch: ✓ Correct +N / Drew +N / ✗ Missed) + LockedPickChip
                   │   │        ├─ <PayoutMatrix>  // 2×3 (Home/Away pick × Win/Draw/Lose); +x/+y placeholders;
                   │   │        │                   //   gated off (with "Picks open once both teams advance" chip)
                   │   │        │                   //   when upcoming && isPlaceholderGame (TBD-vs-TBD)
                   │   │        ├─ pick buttons (gated off on placeholder games) | anon → gate('Sign in to pick')
                   │   │        ├─ Share / Undo action row (inline Lucide SVGs)
                   │   │        ├─ <CrowdMeter>  // "WISDOM OF THE CROWD" 28px bar — only after kickoff
                   │   │        ├─ <FriendPicksPanel game={game}/>  // "N friends picked"; won/draw/missed badges
                   │   │        └─ <CommentThread scope="game" scopeId={game.id}/>
                   │   │              authed: composer + reaction strip | anon: <InlineGatePanel> + gate('react')
                   │   │
                   │   ├─ view='mypicks':
                   │   │     <LeaderboardFiltersBar>  // ?lbLeague=&lbSeason=
                   │   │     SubTabs [Mine | Friends] + friend dropdown (Friends mode, LEFT of filters bar)
                   │   │     <PicksHistory>  // client-side filtered by leaderboardFilters; status/scope chips;
                   │   │                      //   comparePicksByPendingThenRecent; "Friends' Picks" heading (apostrophe)
                   │   │
                   │   ├─ view='groups':  <GroupsView> SubTabs (My Groups / Discover / Invites)
                   │   │     "+ New group" pill → <CreateGroupModal> (locally-owned form state)
                   │   │     Discover list (anon: "Join" → gate); pending invites (authed); <GroupCard>*:
                   │   │        member grid + Avatars (clickable → ProfileDrawer) · invite row · Public/Private
                   │   │        badge · leave/transfer/delete menu · <GroupNameDisplay> (Name #ABCDEF) ·
                   │   │        <CommentThread scope="group" scopeId={group.id}/> (members+owner only)
                   │   │     (password / request-to-join dialogs stay at DashboardView level for SearchBar)
                   │   │
                   │   ├─ view='leaderboard':  <LeaderboardView> SubTabs (Overall / Groups / Friends)
                   │   │     <LeaderboardFiltersBar> above the sub-tabs;
                   │   │     <LeaderboardCard> (exports LeaderboardRow: Avatar + clickable→drawer; honors
                   │   │        entry.isMasked → italic + "private" chip + click suppressed; compact mode:
                   │   │        top-3 + self + friends + "Show all N" toggle via friendUserIds prop);
                   │   │     <GroupLeaderboardCard> (sort select + Prev/Next + "Your position" anchor)
                   │   │
                   │   ├─ view='friends':  <FriendsView> SubTabs (All / Requests / Find people)
                   │   │     Find people: #friend-search debounced autocomplete (250ms / 2-char min);
                   │   │     friendStatus-driven CTA matrix (You / Friends / Request sent / Accept / Add friend)
                   │   │
                   │   ├─ view='profile':  <ProfileView> (lazy)
                   │   │     header (Avatar + displayName + username) + Edit profile → <EditProfileModal>;
                   │   │     SubTabs: Summary (stat grid incl. "Best streak" .font-led) / Badges (<BadgeWall>
                   │   │        progress bars from badgeProgress) / Activity (recent picks) /
                   │   │        Stats (<StatsDashboard> lazy recharts — ONLY when friendStatus==='self')
                   │   │
                   │   ├─ view='settings':  <SettingsView> (lazy) SubTabs:
                   │   │     Account (<ChangeEmailPanel> + <ChangePasswordPanel> + <ReferralCodePanel>) /
                   │   │     Appearance (<ThemeToggle>) /
                   │   │     Notifications (<PushSettingsPanel> — 5 states incl. iOS install gate + per-type) /
                   │   │     Privacy (profileVisibility radio)
                   │   │
                   │   ├─ view='admin' (admin only):  <AdminPanel> SubTabs:
                   │   │     Leagues (<LeagueManager> + per-league "Sync now") / Games (<GameManager> —
                   │   │     drawProbability input + Draw button + bulk action bar; default tab) /
                   │   │     Users (<UserManager> — bulk + self auto-skipped) / Audit (<AuditLog> — paginated
                   │   │     newest-first + collapsible <details> payload)
                   │   │
                   │   └─ <Footer>  // © <year> Bantryx · Trinidad & Tobago · [Terms][Privacy][Copyright][Cookies]
                   │
                   └─ OVERLAYS (rendered inside DashboardView):
                       ├─ <SignInModal>           // mounted by AuthGateProvider; gate(label) opens it
                       ├─ <ConfirmModal>          // logout / deletions / bulk confirms (backdrop + Esc)
                       ├─ <TermsAcceptanceModal>   // BLOCKING when user && !browseAsGuest && needsTermsAcceptance;
                       │                           //   preventDefault Escape/pointer-outside/interact-outside +
                       │                           //   no-op onOpenChange; only "I accept" or "Sign out";
                       │                           //   suppresses OnboardingTour while open
                       ├─ <OnboardingTour>        // gated !onboardingCompletedAt && view==='games' && games.length>0
                       ├─ <ProfileDrawer>         // right-side; wraps <ProfileView> (read-only); "unavailable" sheet
                       │                           //   when DataContext.profileError set (Tier 8.6)
                       └─ <InstallPrompt>         // Chromium beforeinstallprompt / iOS Share→Add instructions

<CommentThread scope="game"|"group" scopeId={...}>:
   <CommentRow>* — Avatar · body · (edited) · edit form (author only) · 5-emoji reaction strip
   baseUrl = scope==='group' ? /api/groups/:id/comments : /api/games/:id/comments
   backwards-compat shim: a caller passing gameId={...} (no scope) is treated as {scope:'game', scopeId:gameId}
```

`<SubTabs>` ([src/components/SubTabs.jsx](src/components/SubTabs.jsx)) wraps Radix Tabs + syncs `?tab=<value>`; an unknown value falls back to `defaultValue` (so a cross-view `?tab=` is safe). It listens for `scorecast:url-changed` so in-app deep-link nav can pre-select a sub-tab. **Modal z-stacking:** ConfirmModal/SignInModal/ProfileDrawer/OnboardingTour/TermsAcceptanceModal all `z-50`; toast viewport `z-[100]`; sidebar drawer + bell dropdown `z-40`. When a modal opens over the mobile drawer, the drawer's Escape handler is guarded by `drawerRef.contains(document.activeElement)` so Escape closes the modal first; the drawer stays open until focus returns. **Don't add a global unconditional Escape→close-drawer listener** — it steals Escape from any stacked modal.

**Per-component reference** (the surfaces a new engineer will touch most):

| Component                                                               | Role / notes                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.jsx`                                                               | ~136-LOC shell: legal short-circuit · skip link · status banner · 3-way view switch · TermsAcceptanceModal + OnboardingTour gates                                                                                                         |
| `views/DashboardView.jsx`                                               | Sidebar + top bar + view switch; the password/request-to-join dialogs live here so SearchBar can trigger them from any view                                                                                                               |
| `Sidebar.jsx`                                                           | `ICONS.groups` = 5-node network graph ("community"); `ICONS.friends` = two overlapping busts ("1:1") — they were inverted pre-`0c3aed6`. Items keep `role="tab"`.                                                                         |
| `UserMenu.jsx`                                                          | avatar + username → `role="menu"` dropdown: View profile / Settings / Sign out; win-streak flame chip inside the dropdown label                                                                                                           |
| `GameCard.jsx`                                                          | the densest component: pick UI, payout matrix, crowd meter, friends' picks, share/undo, comment thread. `pickMap.get(game.id)` → `existingChoice`/`existingPickId`                                                                        |
| `PayoutMatrix.jsx`                                                      | 2×3 preview; Draw row shows `+x`/`+y` when `drawProbability=0`; gated off on placeholder games                                                                                                                                            |
| `CommentThread.jsx`                                                     | scope-agnostic (`scope`+`scopeId`); 5-emoji `REACTION_EMOJIS` (must match `ALLOWED_EMOJIS`); optimistic reaction updates                                                                                                                  |
| `Avatar.jsx`                                                            | FNV-1a(lowercased username) → HSL; `displayName` drives the letter, `username` the colour; fg inline `#ffffff`                                                                                                                            |
| `LeaderboardCard.jsx`                                                   | exports `LeaderboardRow`; honors `entry.isMasked`; compact mode via `friendUserIds`                                                                                                                                                       |
| `SearchBar.jsx`                                                         | 250 ms debounce; user→drawer, group→tab/join, game→`navigateToDeepLink('/?gameId=')`                                                                                                                                                      |
| `NotificationBell.jsx`                                                  | 30 s poll (5 min under a SW); row click = markRead + `navigateToDeepLink(n.link)` + close popover; poll gated on `user?.id`                                                                                                               |
| `ShareableCard.jsx`                                                     | off-screen 1080×{1080,1920}; **all inline hex** (no token context in the raster)                                                                                                                                                          |
| `OnboardingTour.jsx` / `TermsAcceptanceModal.jsx` / `InstallPrompt.jsx` | the three gated overlays (§8.24)                                                                                                                                                                                                          |
| `ui/*`                                                                  | Radix wrappers — `Button` (min-h-[44px] mobile), `Dialog`, `DropdownMenu`, `Popover`, `Select`, `Tabs`, `Toast`, `Tooltip`, `Switch`, `Checkbox`, `Radio`, `Input`, `PasswordInput`, `Textarea`, `Badge`, `Avatar`, `Skeleton`, `Spinner` |
| `legal/*`                                                               | `LegalLayout` + Terms/Privacy/Copyright/CookiePolicy (plain-English copy; `LEGAL_CONTACT` constant)                                                                                                                                       |

**Tier 13 prop-drilling status:** every component either takes only data props (`game`/`group`/`profile`) or consumes contexts via hooks directly. The legacy `request`/`currentUserId`/`onError`/`onSaveProfile` chains are gone — except `GroupCard`/`LeaderboardCard`/`GroupLeaderboardCard` still receive `currentUserId` as a prop (pure presentation, used in multiple contexts; migrating buys nothing).

### 6.6 Error reporting — three paths, one sink

```
1. React render error → <ErrorBoundary> → fallback card (Reload/Try again; raw msg only in DEV)
                                          → reportClientError + Sentry.captureException
2. window 'error' / 'unhandledrejection' → clientErrorReporter (throttle 5/60s, keepalive POST,
                                          clip stack 8KB) → POST /api/client-errors
                                          → dispatch scorecast:client-error → NotificationContext toast
3. useRequest() throws (handled 4xx)     → caller .catch() → showStatus(error.message)
                                          → wasHandled flag suppresses paths 1+2 double-toasting
```

All converge on a server-side structured log via `POST /api/client-errors` (carrying the browser's last-seen `X-Request-Id`). Sentry sees paths 1+2 directly (its browser SDK installs its own window listeners). Server-side, `lib/instrument.js` (Sentry init) carries `sendDefaultPii:false`, `maxBreadcrumbs:50`, and a `beforeSend` that redacts keys matching `password|secret|token|recovery|otp|totp|cookie|set-cookie|authorization|csrf|api[-_]?key`.

**AuthView swallows auth re-throws** — both `handleLogin` and `handleRegister` wrap the AuthContext call in an empty try/catch (AuthContext already surfaced the message via `showStatus`); without this, the re-throw bubbles as an unhandled rejection and fires the generic toast over "Invalid credentials" (the documented Tier 5.5b race, closed in 6b).

### 6.7 Design tokens, theming, motion

- **Tokens** — every colour/shadow/radius/font is a CSS custom property in [src/index.css](src/index.css) under `:root` (dark) and `:root[data-theme='light']` (light overrides). Tailwind maps utilities through `rgb(var(--c-<name>) / <alpha-value>)`. Semantic names: `bg-base`/`bg-elevated`/`bg-overlay`, `text-fg`/`text-fg-muted`/`text-fg-subtle`, `border-default`/`border-strong`, `bg-accent`/`text-accent`/`ring-accent`, `text-success`/`-warning`/`-danger`/`-info`. **Components under `src/components/**`MUST use tokenized utilities** — raw`slate-_`/`cyan-_`/`text-white`literals bypass the theme switch and look broken in the inverse theme. (Deliberate exceptions: the brand wordmark glow and the Avatar foreground are theme-independent inline hex.) Tier 30 Phase 2 added`--shadow-brand-glow-strong`, `--shadow-led`, `.font-led`(Orbitron numerals),`.bg-arena-grid-bold`, `.mask-fade-x`, `.input-stadium` + ticker/LED-flicker keyframes — each with a light-theme variant.
- **Theme** — binary light/dark (system mode removed). `lib/theme.js applyTheme(t)` mutates `<html data-theme>` + `color-scheme`, applied **synchronously in main.jsx before React mounts** (no FOUC). Persisted to `localStorage.sc_theme`; legacy `'system'` reads as `'dark'`. Toggle: `<ThemeToggle>` in SettingsView → Appearance.
- **Motion** — `<m.*>` from `src/lib/motion.js` only (strict `LazyMotion` rejects `<motion.*>`). Named variants in `src/lib/motionVariants.js`. Every consumer honours `useReducedMotion()` (either `initial="visible"` short-circuit or `motion-safe:` CSS gate or conditional `whileHover`). The Sidebar active indicator is a single `<m.span layoutId="sidebar-active-indicator">` that motion auto-animates between tabs.

### 6.8 Anonymous browse mode

Anon visitors browse read-only; the gate UX:

| Surface                     | Authed            | Anonymous                                      |
| --------------------------- | ----------------- | ---------------------------------------------- |
| GameCard pick/undo          | handlers          | `gate('Sign in to pick')`                      |
| CommentThread composer      | textarea + submit | `<InlineGatePanel label="Sign in to comment">` |
| CommentThread reactions     | toggle            | `gate('Sign in to react')`                     |
| FriendsView                 | full              | not in sidebar                                 |
| Group create form           | visible           | `<InlineGatePanel>` (CreateGroupModal gated)   |
| Discover "Join"             | handler           | `gate('Sign in to join this group')`           |
| NotificationBell / UserMenu | visible           | hidden                                         |
| Top bar                     | UserMenu          | `[Sign in]` + `[Sign up]` + `[← Home]` pills   |
| Sidebar                     | 7 items           | Matches / Groups / Leaderboards only           |

Entry: Landing's third CTA "Or just browse as a guest →" sets `browseAsGuest=true`. Exit: `[← Home]` resets `browseAsGuest`/`showAuth` → Landing. `performLogout` always lands on Landing (clears `sc_visited`).

### 6.9 PWA + Web Push (frontend)

`vite-plugin-pwa` with **`injectManifest`** (source SW at [src/sw.js](src/sw.js) — `generateSW` can't express the push handler; don't switch back). The SW: workbox precache + runtime caching (Google Fonts; `/api/{games,leaderboard,me,groups,leagues}` 5-min SWR) + `push` handler (`registration.showNotification`) + `notificationclick` (`clients.openWindow(data.link)`) + a `SKIP_WAITING` message listener (RefreshButton posts it). `registerType: 'autoUpdate'` + `skipWaiting()` + `clientsClaim()`. Icons generated from `public/logo.svg` by `scripts/generate-pwa-assets.mjs` (`@resvg/resvg-js` + `png-to-ico` — sidesteps the broken `sharp` win32-arm64 prebuild). `<InstallPrompt>` branches Chromium (`beforeinstallprompt`) vs iOS (install-first instructions; iOS Safari only supports Web Push from an installed PWA on 16.4+). Subscription via `usePushSubscription` (W3C ceremony with rollback). `PushSettingsPanel` (SettingsView) has 5 states incl. the iOS install gate + per-type checkboxes. NotificationBell polls `/api/notifications` every 30 s, dropping to 5 min when `navigator.serviceWorker.controller != null` (push delivers freshness; the poll gated on `user?.id` so a logged-out tab stops looping).

### 6.10 Polling patterns

There are exactly **three client-side timers** — and crucially, **no client-side polling for game state**:

- **`NotificationBell`** — `setInterval` calling `GET /api/notifications` every 30 s (5 min when a SW controls the page). Started on mount (gated on `user?.id`), cleared on unmount. Hidden entirely in anon-browse.
- **`useCountdown(date)`** ([src/utils/time.js](src/utils/time.js)) — a per-`GameCard` interval re-formatting the countdown label every 30 s. Cheap; returns a string.
- **`useMatchMinute(kickoff, isLive, {halfTimeReached, phase})`** — a per-live-`GameCard` 30 s tick computing the estimated match minute; no-ops when `isLive` is false.

Live-score updates land via the **server-side 30 s cron** into the DB; the next client `refreshGames` (after a pick/undo/admin action or a tab switch) picks them up — there is no client poll for scores. Leaderboards are computed on each `GET /api/leaderboard` (hitting the 30 s server cache) and refetched on user actions, not on a timer. No WebSocket/SSE today (Tier 7).

### 6.11 localStorage keys

localStorage holds **only non-secret UI state** (Tier 6.8 retired token storage — the session cookies are HttpOnly and invisible to JS; auth state is inferred from the `user` object returned by the `/api/me` boot fetch):

| Key                    | Purpose                                                               | Writer                                                      |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `sc_visited`           | "has this browser authed before?" — skips Landing for returning users | `AuthView` after login/register; cleared by `performLogout` |
| `sc_browse_as_guest`   | "is this browser in anonymous-browse mode?"                           | Landing "Browse as guest" CTA + `performLogout`             |
| `sc_theme`             | `'dark' \| 'light'` (legacy `'system'` reads as `'dark'`)             | `lib/theme.js setStoredTheme`                               |
| `sc_sidebar_collapsed` | desktop sidebar collapse state                                        | `Sidebar` toggle                                            |
| `sc_install_dismissed` | PWA install-prompt dismissed                                          | `InstallPrompt`                                             |

`bootDone` (DataContext) tracks whether the initial `/api/me` round-trip completed, so the UI shows `<SkeletonView>` until then instead of briefly flashing the login form to an authenticated user.

---

## 7. Database Architecture

### 7.1 Connection & pool

Single Sequelize instance ([models/index.js](models/index.js)): `process.env.DATABASE_URL` overrides everything, else local default `postgres://postgres:postgres@localhost/scorecast_db`. **Pool `{max: 20, min: 2, idle: 10_000, acquire: 30_000}`** (raised from the Sequelize default 5 in Tier 25 A1) — cluster ceiling ~60 at 3 replicas, ~200 at the 10-replica cap (B1ms has ~100 `max_connections`, so the 10× case needs the C2 SKU). **Both [config/database.js](config/database.js) (sequelize-cli, used by the migrate Job) and [models/index.js](models/index.js) (runtime) must stay in sync** — drift has caused subtle bugs. Azure Postgres requires TLS: both files opt into `dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }` when the URL contains `sslmode=require`. **Don't drop `sslmode=require` from prod URLs** — connections reject with "no pg_hba.conf entry … no encryption."

### 7.2 Schema initialization

`initDatabase()` on every boot, in order:

1. `sequelize.authenticate()` — fail fast if Postgres is unreachable.
2. `sequelize.sync({ alter: false })` — creates _new_ tables only; **never alters existing tables** (`alter:false` is deliberate — we don't trust Sequelize auto-alter; migrations are the source of truth). This is the base-schema creator: every migration is an ALTER assuming the table exists, so `db:migrate` against an _empty_ DB fails on the first migration — CI mirrors the boot order (`sync` then `migrate`).
3. `runMigrations()` — thin umzug shim against `migrations/`. Dev always runs it; prod is a **no-op unless `MIGRATE_ON_BOOT=true`** (prod CD runs `npm run db:migrate` as a one-shot Job instead).
4. `seedDatabase()` — runs only when the `users` table is empty (`User.count() === 0`). It loads the **whole** `data.json` demo set, in order: users (`bulkCreate({individualHooks:true})` so the bcrypt `beforeCreate` hook fires per row) → games → groups → group members → invites → picks. The whole function is wrapped in one `try/catch` that logs `"Seeding failed"` and swallows the error, so a failure on any step silently skips the rest. **Two columns added after `data.json` was written have no model-level default and must be supplied here, or the very first inserts throw a NOT NULL violation and abort the entire seed** (the symptom is a fresh DB with _zero_ users — you can't even log in): `users.referralCode` (Tier 30 A2 — generated 8-hex) and `groups.discriminator` (Tier 30 Phase 0 — generated 6-hex). The `data.json` games also predate the `games.leagueId NOT NULL` tightening (migration `20260518000007`), so the seeder attaches each to the synthetic **"Legacy / Imported"** league + current-year season that that migration guarantees exists by seed time (boot order is `sync → migrate → seed`), and derives `status` from `result`. All three fixups live in `seedDatabase()` in [models/index.js](models/index.js) — **if you add another NOT-NULL-without-default column to `users`/`games`/`groups`, update the seeder in the same commit.**

### 7.3 Migrations framework

sequelize-cli (CLI + CD) + umzug (dev-boot), shared `SequelizeMeta`. Scripts: `db:migrate`, `db:migrate:undo`, `db:migrate:undo:all`, `db:migrate:status`, `db:seed` (=`db:seed:all`), `db:seed:undo`.

**Rules (load-bearing):**

- Generate via `npx sequelize-cli migration:generate --name <desc>`.
- **Use raw SQL with explicit `IF NOT EXISTS` / `IF EXISTS` guards** (and `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;` for `CREATE TYPE`), **NOT** the Sequelize `addColumn`/`removeColumn`/`addIndex` helpers (none carry an `IF NOT EXISTS` option). **This is load-bearing for CI:** the `migrations-smoke` job runs `sync({alter:false})` _before_ `db:migrate` (mirroring boot), so any migration adding a column without an `IF NOT EXISTS` semantic fails in CI even though it works in prod CD (which migrates against the previous revision's already-real schema). Canonical example: `20260519000001-picks-add-probability-snapshot.js` (rewritten to raw `ADD COLUMN IF NOT EXISTS`).
- `down` paths are best-effort (local rollback only): `DROP COLUMN IF EXISTS`, etc.
- Never add raw DDL to `runMigrations()` (umzug shim).
- `migrations/` + `seeders/` are versioned source — always commit.

**The 41 migrations** (chronological): role / pick-unique-index / group-visibility-enum / friendship-pair-unique / displayName+bio / comment-edited-at / comment-reactions-table (May 13 — Tiers 1–8 base); user-login-attempts / email-columns / email-verification-tokens / password-reset-tokens / refresh-tokens / user-totp (Tier 6); disable-all-2fa (ops); onboarding / cascade-user-fks / profile-visibility (Tier 8.6/11); create-leagues / create-seasons / games-add-league-season-source / games-status-enum / games-add-live-phase / create-audit-log / games-tighten-league-not-null / games-add-draw-scoring (Tier 4b + draw); picks-add-probability-snapshot (Tier 17); create-push-subscriptions / games-add-kickoff-reminder-sent-at (PWA); create-teams / games-add-elo-snapshot (Tier 17); comments-add-group-scope / users-add-terms-acceptance (Tier 18); tier19-groups-visibility-and-join-requests / games-add-pick-probabilities-locked-at (Tier 19); tier24-create-user-scores (Tier 24); games-add-intl-neutral-and-tier (intl-model); groups-add-discriminator / users-add-last-verification-sent-at / users-add-streak-columns / users-add-referral-fields (Tier 30 Phase 0+3); users-rework-streak-to-wins (Tier 30 Phase 3 A1 revision).

**Seeders:** password-backfill (bcrypt any plaintext), seed-teams-from-elo-history (PL Elo bootstrap), seed-teams-from-intl-elo-history (WC/INT Elo bootstrap). The team seeders are **NOT auto-run by CD** — an operator runs them once after the first prod deploy (`npm run db:seed -- --seed <file>`).

### 7.4 Tables

UUID v4 PKs throughout (`DataTypes.UUIDV4` default).

#### `users`

| Column                                                         | Type                                                | Notes                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `id`                                                           | UUID PK                                             |                                                                                              |
| `username`                                                     | STRING UNIQUE NOT NULL                              | `iLike` lookup; regex `^[A-Za-z0-9_]+$` (underscores yes, hyphens no)                        |
| `password`                                                     | STRING NOT NULL                                     | bcrypt cost 10; `beforeCreate`/`beforeUpdate` auto-hash anything not `^\$2[aby]\$`           |
| `role`                                                         | ENUM('user','admin') DEFAULT 'user'                 |                                                                                              |
| `displayName` / `bio`                                          | VARCHAR(60) / TEXT NULLABLE                         | shown in place of username when set; bio capped 280 by zod                                   |
| `email`                                                        | VARCHAR(254) NULLABLE                               | functional unique index `users_email_lower_unique` on `LOWER(email) WHERE email IS NOT NULL` |
| `emailVerifiedAt`                                              | TIMESTAMPTZ NULLABLE                                | required before `forgot-password` dispatches                                                 |
| `lastVerificationSentAt`                                       | TIMESTAMPTZ NULLABLE                                | stamped on each `sendVerificationEmail`; drives "Sent N min ago" + Resend                    |
| `loginAttempts` / `lockedUntil`                                | INTEGER DEFAULT 0 / TIMESTAMPTZ NULLABLE            | lockout                                                                                      |
| `totpSecret` / `totpEnabledAt` / `totpRecoveryCodes`           | TEXT / TIMESTAMPTZ / JSONB NULLABLE                 | dormant 2FA (parked; all NULL today)                                                         |
| `profileVisibility`                                            | ENUM('public','friends','private') DEFAULT 'public' | gates profile + drives leaderboard masking                                                   |
| `onboardingCompletedAt`                                        | TIMESTAMPTZ NULLABLE                                | NULL → first-run tour                                                                        |
| `pushPreferences`                                              | JSONB DEFAULT '{}'                                  | per-type bool; absent/`true`=deliver, only explicit `false`=opt-out                          |
| `termsAcceptedAt` / `termsAcceptedVersion`                     | TIMESTAMPTZ / INTEGER NULLABLE                      | vs `CURRENT_TERMS_VERSION`; NULL → blocking modal                                            |
| `currentWinStreak` / `longestWinStreak` / `lastMilestoneFired` | INTEGER DEFAULT 0                                   | Tier 30 A1 revision; `longest` is monotonic                                                  |
| `referralCode`                                                 | CHAR(8) NOT NULL UNIQUE                             | server-set 8-hex via `crypto.randomBytes(4)`                                                 |
| `referredByUserId`                                             | UUID NULLABLE → users(id) ON DELETE SET NULL        | drives Recruiter badge                                                                       |
| `createdAt`                                                    | TIMESTAMPTZ DEFAULT NOW                             |                                                                                              |

Cascade: `users` → `badges`/`notifications`/`email_verification_tokens`/`password_reset_tokens`/`refresh_tokens`/`push_subscriptions`/`user_scores`/`user_scores_overall` are DB-level `ON DELETE CASCADE` (retrofitted by `20260516000002` — the "Cascade-delete fix-up": prod's `sync()`-created FKs were stuck at `NO ACTION`). Owned groups, picks, comments, friendships, memberships, invites are **app-level** in `UserService.cascadeDelete`.

#### `games`

| Column                                                    | Type                                                               | Notes                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `id`                                                      | UUID PK                                                            |                                                                                     |
| `homeTeam` / `awayTeam`                                   | STRING NOT NULL                                                    | logical link to `teams` by name (no FK UUID)                                        |
| `date`                                                    | TIMESTAMPTZ NOT NULL                                               | UTC kickoff                                                                         |
| `homeProbability` / `drawProbability` / `awayProbability` | DECIMAL(3,2) NOT NULL                                              | sum 1.0 ±0.01; fresh fixtures `(0.50,0.00,0.50)` sentinel                           |
| `result`                                                  | ENUM('home','away','draw') NULLABLE                                | only auto-derived when currently NULL                                               |
| `leagueId`                                                | UUID NOT NULL → leagues(id)                                        | tightened NOT NULL in Tier 4b Chunk 3 (backfilled to synthetic "Legacy / Imported") |
| `seasonId`                                                | UUID NULLABLE → seasons(id)                                        | created on demand by `ensureSeason`                                                 |
| `sourceId`                                                | VARCHAR NULLABLE                                                   | football-data id; partial unique `(leagueId,sourceId) WHERE sourceId NOT NULL`      |
| `status`                                                  | ENUM('scheduled','in-progress','finished','postponed','cancelled') | `setResult` flips status alongside result                                           |
| `homeScore` / `awayScore`                                 | INTEGER NULLABLE                                                   | live/final score                                                                    |
| `kickoffTz`                                               | VARCHAR(64) NULLABLE                                               | informational                                                                       |
| `halfTimeReached`                                         | BOOLEAN DEFAULT false                                              | monotonic in `applyLiveUpdate`                                                      |
| `phase`                                                   | VARCHAR(20) NULLABLE                                               | regular/extra-time/penalty-shootout                                                 |
| `homeEloPre` / `awayEloPre`                               | NUMERIC(8,2) NULLABLE                                              | Tier 17 immutable pre-match snapshot                                                |
| `appliedResult`                                           | VARCHAR(10) NULLABLE                                               | which result the Elo cascade has applied                                            |
| `kickoffReminderSentAt`                                   | TIMESTAMPTZ NULLABLE                                               | 15-min reminder dedup                                                               |
| `pickProbabilitiesLockedAt`                               | TIMESTAMPTZ NULLABLE                                               | Tier 19; partial index `games_unlocked_scheduled_idx (status,date) WHERE NULL`      |
| `neutralVenue`                                            | BOOLEAN NOT NULL DEFAULT false                                     | intl-model; drives symmetrization                                                   |
| `eloKMultiplier`                                          | NUMERIC(4,2) NULLABLE                                              | intl-model; null = 1.0                                                              |

**`timestamps: false`** — no `updatedAt`. Raw SQL UPDATEs must NOT set `"updatedAt" = NOW()` (the games table is mutated every 30-s live tick; timestamp churn with no consumer). Result is auto-derived only when `result === null` (admin entries never clobbered); `eloKMultiplier`/`neutralVenue` must be frozen once `appliedResult` is non-null.

#### `groups`

| Column          | Type                                               | Notes                                     |
| --------------- | -------------------------------------------------- | ----------------------------------------- |
| `id`            | UUID PK                                            |                                           |
| `name`          | STRING NOT NULL                                    |                                           |
| `discriminator` | CHAR(6) NOT NULL UNIQUE                            | server-set 6-hex; rendered "Name #ABCDEF" |
| `ownerId`       | UUID NOT NULL                                      | app-enforced                              |
| `visibility`    | ENUM('public','private','secret') DEFAULT 'secret' | Tier 19 3-tier                            |
| `passwordHash`  | STRING(72) NULL                                    | bcrypt for private+password join          |
| `createdAt`     | TIMESTAMPTZ DEFAULT NOW                            |                                           |

#### `group_members` — composite PK `(groupId, userId)`, no other columns.

#### `group_invites` — `id`, `groupId`, `username` (stored as username so case-insensitive invites resolve at accept-time), `createdAt`.

#### `group_join_requests` (Tier 19) — `id`, `groupId`, `requesterId`, `message`, `status`, `createdAt`. For request-to-join on private groups.

#### `picks`

| Column                                                                      | Type                       | Notes                                                                      |
| --------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `id`                                                                        | UUID PK                    |                                                                            |
| `userId` / `gameId`                                                         | UUID NOT NULL              | unique index `picks_user_game_unique (userId, gameId)`                     |
| `choice`                                                                    | ENUM('home','away')        | winner-only                                                                |
| `pickedHomeProbability` / `pickedDrawProbability` / `pickedAwayProbability` | DECIMAL(3,2) NULLABLE      | Tier 17 snapshot; written at pick-create, OVERWRITTEN at kickoff (Tier 19) |
| `appliedResult`                                                             | VARCHAR(10) NULLABLE       | Tier 24 idempotency sentinel                                               |
| `appliedPoints`                                                             | INTEGER NOT NULL DEFAULT 0 | the integer delta currently in user_scores                                 |
| `submittedAt`                                                               | TIMESTAMPTZ DEFAULT NOW    | updated on edit                                                            |

#### `badges` — `id`, `userId` (CASCADE), `slug` (must exist in catalog), `awardedAt`. Unique `(userId, slug)` → `awardBadge` idempotent via catch-on-conflict.

#### `friendships` — `id`, `requesterId`/`addresseeId`, `status` ENUM('pending','accepted') DEFAULT 'pending', `createdAt`, `acceptedAt`. **Functional unique index `friendships_pair_unique (LEAST(requesterId,addresseeId), GREATEST(...))`** — one row per unordered pair regardless of direction (Postgres-only).

#### `comments`

| Column                   | Type                                | Notes                                             |
| ------------------------ | ----------------------------------- | ------------------------------------------------- |
| `id`                     | UUID PK                             |                                                   |
| `gameId`                 | UUID NULLABLE → games(id) CASCADE   | NULLABLE since Tier 18 Chunk 5                    |
| `groupId`                | UUID NULLABLE → groups(id) CASCADE  | partial index `comments_group_idx WHERE NOT NULL` |
| `userId`                 | UUID NOT NULL → users(id) NO ACTION | cleaned in user-delete                            |
| `body`                   | TEXT NOT NULL                       | 1–500 chars, profanity-checked                    |
| `createdAt` / `editedAt` | TIMESTAMPTZ                         | `editedAt` set on PUT                             |

**CHECK `comments_one_scope_chk`: `(gameId IS NOT NULL)::int + (groupId IS NOT NULL)::int = 1`** — exactly one scope; `assertSingleScope` re-asserts at the service layer (recognizable 400 instead of a Postgres CHECK violation). Index `comments_game_idx (gameId)`.

#### `comment_reactions` — `id`, `commentId` (CASCADE), `userId`, `emoji`, `createdAt`. Unique `(commentId,userId,emoji)`; index on `commentId`.

#### `notifications` — `id`, `userId` (CASCADE), `type` (free-form STRING, **not ENUM** so new types need no migration), `title`, `body`, `link` (deep-link), `read` DEFAULT false, `createdAt`. Index `(userId, read, createdAt)`.

#### `email_verification_tokens` / `password_reset_tokens` — `id`, `userId` (CASCADE), `tokenHash` VARCHAR(64) UNIQUE (SHA-256 hex), `expiresAt` (24h / 15min), `consumedAt`, `createdAt`. Index on `userId`.

#### `refresh_tokens` — same shape + `revokedAt`, `userAgent` (≤500 chars), `expiresAt` 30d. Indexes `(userId)` + partial `(userId) WHERE revokedAt IS NULL`.

#### `push_subscriptions` (PWA) — `id`, `userId` (CASCADE), `endpoint`, `keys` JSONB, `failureCount`, `createdAt`. Unique `(userId, endpoint)`. Auto-purged at 5 consecutive failures or on 410/404 Gone.

#### `leagues` — `id`, `name`, `sourceProvider`, `sourceLeagueId` (provider code e.g. `PL`/`WC`/`BSA`; **shareable across DB rebuilds**), `country`, `logoUrl`, `active`, timestamps. Unique `(sourceProvider, sourceLeagueId)`. Seeded with PL (active) + WC (inactive at seed; activated for the World Cup).

#### `seasons` — `id`, `leagueId` (CASCADE), `year` (calendar year season ENDS), `startsAt`/`endsAt`, `current`, timestamps. Unique `(leagueId, year)`; created on demand by `ensureSeason`.

#### `teams` (Tier 17) — `id`, `name` VARCHAR(128) (canonical football-data form, e.g. "Manchester City FC"), `leagueId` (CASCADE; per-league Elo space), `elo` NUMERIC(8,2) DEFAULT 1500 (Sequelize returns DECIMAL as STRING — parseFloat before math; NUMERIC avoids drift over years of K=20 updates), `gamesPlayed`, `lastMatchDate`, timestamps. Unique `(name, leagueId)`; index on `leagueId`. Two write paths: the bootstrap seeder (idempotent `ON CONFLICT DO NOTHING`) + runtime `ensureTeamExists` (auto-insert at `MIN(elo)`).

#### `audit_log` (Tier 4b) — `id`, `actorUserId` (**SET NULL** on user delete — history survives), `action` (`admin.<entity>.<verb>`), `entityType`, `entityId`, `before` JSONB (NULL except DELETE), `after` JSONB (request body, 4 KB-truncated), `requestId`, `statusCode`, `createdAt`. Index `(createdAt DESC)`.

#### `user_scores` (Tier 24) — composite PK `(userId, leagueId, seasonId)`, `points`/`picksScored`/`picksWon` INTEGER, `updatedAt`. Partial index `(leagueId, seasonId, points DESC, userId) WHERE points > 0`. All three FKs CASCADE.

#### `user_scores_overall` (Tier 24) — PK `userId`, same counter columns. Partial index `(points DESC, userId) WHERE points > 0`.

### 7.5 Cascade behaviour summary

| Parent → child                                                                | On parent delete                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| games → picks                                                                 | app-level in `GameService.cascadeDelete` (+ `reversePick` per pick)            |
| games → comments                                                              | DB CASCADE + explicit destroy                                                  |
| comments → comment_reactions                                                  | DB CASCADE + explicit destroy                                                  |
| users → badges/notifications/tokens/push_subscriptions/user_scores(\_overall) | DB CASCADE + explicit destroy in `UserService.cascadeDelete` (belt-and-braces) |
| users → picks/comments/friendships/group_members/owned groups/invites         | app-level ordered cleanup                                                      |
| users → audit_log.actorUserId                                                 | **SET NULL**                                                                   |
| leagues → seasons/teams                                                       | DB CASCADE                                                                     |
| groups → group_members/group_invites/comments                                 | app-level + DB CASCADE on comments                                             |
| games → teams                                                                 | none (string link; lookup by `(name,leagueId)`)                                |

---

## 8. Domain Subsystems

### 8.1 Scoring

```
function scorePick(pick, game):
  if not game.result or not pick: return 0
  if game.result == 'draw':
    opposite = game.awayProbability if pick.choice == 'home' else game.homeProbability
    return round((game.drawProbability * opposite / (game.homeProbability + game.awayProbability)) * 100)
  winning = (pick.choice == game.result)        # result ∈ {'home','away'}
  if not winning: return 0
  probability = game.homeProbability if pick.choice == 'home' else game.awayProbability
  return round((1 - probability) * 100)
```

**Duplicated in two files that MUST change together in the same commit:** [lib/scoring.js](lib/scoring.js) (authoritative — leaderboards, profile, result notifications, materialized dual-writer, stats, friends'-picks) and [src/utils/scoring.js](src/utils/scoring.js) (client preview — GameCard outcome badge, PicksHistory, PayoutMatrix). There is no shared module (no monorepo); divergence means the on-screen "+N pts" stops matching the leaderboard total. `src/utils/scoring.js` also has `pickStatus(pick,game)` → `won|lost|draw|pending|live|no-pick`, `expectedWinPoints`, and `expectedDrawPoints` (returns `null` when `drawProbability ≤ 0` so PayoutMatrix shows `+x`/`+y` placeholders, not misleading `+0`). Picks stay winner-only; `winRate` counts only literal `choice === result`.

### 8.2 Picks lifecycle

```
created/edited (toggle choice) → pickedHome/Draw/AwayProbability snapshot written from game.* (placeholder)
   │
   ▼  game.date passes
   ─── Tier 19 kickoff lock fires (cron OR applyLiveUpdate) ───
       bulk-UPDATE every Pick on the game with game.{home,draw,away}Probability,
       stamp games.pickProbabilitiesLockedAt → all picks now score identically
   │
   ▼  admin/cron sets game.result
       scorePick(pick, game) → N (reads the locked snapshot)
       UserScoreService.applyPickTransition (in-tx) · notify('pick-scored') · evaluateBadges · StreakService
```

Lock rules (in `POST /api/picks` + `DELETE /api/picks/:id`): `game.date <= now` → 400; `game.result !== null` → 400. **Idempotent create** — the transaction loops on `SequelizeUniqueConstraintError` (the `(userId,gameId)` index) up to 3×, returning the existing pick instead of 500ing on a rapid double-tap; the Tier 24 dual-writer correctly unwinds the materialized write on rollback. `DELETE /api/picks/:id` undoes a pick before kickoff (GameCard shows "Undo" only when upcoming + has-pick). The kickoff lock (§8.18) means same-team picks pay the same regardless of when placed — the "pick early at long odds" loop was deliberately removed; the pick-time snapshot is just the storage substrate.

### 8.3 Groups

Four primitives: Group, GroupMember, GroupInvite, GroupJoinRequest. Actions: create (inserts Group + creator GroupMember, fires `group-founder` badge, generates a 6-hex `discriminator` with 5× retry on unique-violation); invite (member-only, by username, notifies); accept/decline; discover (≤20 public groups the caller isn't in); join (public, or private+password via `passwordHash`); request-to-join (private — `group_join_requests`, owner approves/denies); leave (400 if owner — must transfer first); transfer (owner-only, target must be a member); delete (owner-only, cascades, notifies); toggle visibility. **`MAX_GROUP_MEMBERS=2000`** (env-overridable, clamped [10,5000]) enforced in the 4 add-member paths (joinPublic / joinWithPassword / acceptInvite / approveJoinRequest). Every group-returning API surface includes the discriminator. `listJoinRequests` batches user hydration via a single `User.findAll({where:{id:{[Op.in]:ids}}})` + Map (no per-row N+1). Render with `formatGroupLabel(group)` (server) / `<GroupNameDisplay>` (client).

### 8.4 Friendships

One row per unordered pair (functional unique index). States: `pending` (only addressee accepts/declines; either party cancels via DELETE) → `accepted` (either party unfriends). `friendStatus` ∈ `self|friends|pending-in|pending-out|none`. When `friends`, the profile adds `headToHead: {viewerWins, targetWins, ties}` over all completed games where **both** picked (ties = equal point totals).

### 8.5 Badges

23 badges in [badges/catalog.js](badges/catalog.js) (`{slug, name, description, emoji, threshold?, metric?}`). `evaluateBadges(userId)` recomputes all unlock conditions (idempotent via the `(userId,slug)` constraint — `awardBadge` catches the conflict). Triggers: pick create (first-pick), result set (per pick on the game), group create. `computeProgressForUser(userId)` returns a **16-metric snapshot** (`{picks, wins, upsetWins, favoritesWon, consecutiveWins, consecutiveLosses, leagues, pickDays, pickWeeks, longestStreak, comments, friends, groups, referrals, winRate, scoredPicks}`) feeding both unlock decisions AND BadgeWall progress bars — surfaced **only on self-view** (`viewer.id === target.id`). Tiered ladders: **Streakmaster I/II/III** (5/10/15 wins) and **Recruiter I/II/III** (1/5/25 referees with ≥1 scored pick). **Recruiter fan-out:** at the end of `evaluateBadges`, if the user has a `referredByUserId` AND a scored pick, fire `evaluateBadges(referrer)` fire-and-forget (bounded one level deep). `beta-tester` (🧪) is a **manual-grant** badge (`scripts/grant-beta-badge.mjs`), never auto-awarded. Full catalog: first-pick, first-win, correct-10/25/50, upset-specialist, group-founder + centurion, hot-hand, cold-plunge, crystal-ball, globetrotter, roundsman, loyalist, margin-master, streakmaster-1/2/3, conversationalist, friendly-five, threes-a-crowd, recruiter-1/2/3, beta-tester.

### 8.6 Notifications

```
notify(userId, type, title, body=null, link=null)
  → Notification.create({userId, type, title, body, link, read:false})   (errors swallowed + warn-logged)
  → PushService.sendToUser(userId, type, {title,body,link}).catch(()=>{})  (fire-and-forget, post-insert)
```

`type` is a free-form string for the bell row but constrained to `PUSH_NOTIFICATION_TYPES` for the push-preference UI. **Adding a push-eligible type edits BOTH `PUSH_NOTIFICATION_TYPES` (validation/schemas.js) AND `NOTIFICATION_TYPES` (src/components/PushSettingsPanel.jsx) in the same commit.** Current types: `pick-scored`, `badge`, `invite`, `group-join`, `odds-shifted`, `kickoff-reminder`, `friend-request`, `group-comment`, `streak-milestone`, `weekly-recap`. Every call site populates `link` (convention table in §6.4). `read-all` = `UPDATE notifications SET read=true WHERE userId=? AND read=false`. Bell polls 30 s (5 min when a SW controls the page); mark-read is optimistic-then-remote.

### 8.7 Comments

Scope-agnostic: a row carries `gameId` XOR `groupId` (DB CHECK + `assertSingleScope`). `CommentService.list({gameId, groupId}, viewerId)` + `create({gameId, groupId, userId, body})`. The `GET` enriches each row with `editedAt`, `reactionCounts: {emoji:N}`, `yourReactions: [emoji...]` (empty for anon). Authz: **game** — post by any authed user; **group** — members only (non-member POST → 403 even on public groups), anon-readable for public groups, **404 (not 403)** for non-members of _private_ groups (existence-leak avoidance). Edit — author only (`editedAt=NOW`). Delete — author or admin (cascades reactions). `assertStillMember` IDOR re-check on group-comment edit/remove (a user who left can't rewrite old comments; admin override on delete only). **`fanOutGroupComment`** (fire-and-forget after every group create) notifies every OTHER member via an **8-at-a-time worker-pool drainer** (`FANOUT_CONCURRENCY=8`, shared cursor) — bounding parallel `notify()` so a 2000-member group doesn't burn the 20-slot DB pool or thunder Web Push; title `"<author> commented in <group>"`, body ≤160 chars, link `/?view=groups&groupId=<id>`. `GroupService.cascadeDelete` explicitly destroys group comments + reactions in-tx (defensive against `sync()` bootstrap FKs). **Reaction palette is fixed** (👍 ❤️ 😂 😮 🔥) — `ALLOWED_EMOJIS` (validation/schemas.js) + `REACTION_EMOJIS` (CommentThread.jsx) must stay in sync. POST reaction idempotent (`(commentId,userId,emoji)` unique → 200); DELETE no-op-safe.

### 8.8 Profile

`UserService.getProfileByUsername({username, viewer})` composes: basic fields; totals (`totalPoints`/`picksScored`/`picksWon` read from `UserScoreOverall` first, on-the-fly aggregate fallback); a 50-row `recentPicks` (capped at the DB layer, `ORDER BY createdAt DESC`); badges + full catalog; `friendStatus` + (if friends) `headToHead`; `streak: {current, longest}`; `badgeProgress` (16-metric, **self-view only**). **Game lookups are narrowed to pick gameIds** (was a full-table scan that OOM'd at launch volume — don't reintroduce `Game.findAll()` without a where). Privacy gate (§8.16). Two callers: the read-only ProfileDrawer (any leaderboard-row click) and the editable Profile tab (`<EditProfileModal>` for displayName/bio). `PUT /me` uses `save({hooks:false})` so `beforeUpdate` doesn't re-hash the password.

### 8.9 Admin

`requireAdmin`-gated. Game CRUD (`createGameSchema`/`updateGameSchema` `.refine()` enforce probability sum 1.0) + bulk (cap 500: delete / setResult). User moderation: list (enriched with picksCount/groupsCount), role (self-demote guarded), delete (self-delete guarded, 9-step `cascadeDelete`), bulk (cap 100: promote/demote/delete; self-id silently filtered → `skipped:[{id,reason:'self'}]`). League CRUD + manual sync. Audit-log view (paginated, cap 200/page). Cache-stats. Result-setting is the legacy `POST /api/games/:gameId/result` (not under `/admin`). Bulk = one transaction per entity.

### 8.10 Search

`GET /api/search?q=&type=` — min 2 chars (else empty), 5/type, `iLike '%term%'` across username/displayName/group name/team names. Private groups the caller isn't in are hidden. User rows carry `profileVisibility` (friend-requests need the username; client may render masked). Frontend `SearchBar` debounces 250 ms; user→ProfileDrawer, group→Groups tab/join, game→`navigateToDeepLink('/?gameId=')`.

### 8.11 Avatars

`<Avatar username displayName size>` — pure presentational. FNV-1a hash of the **lowercased username** → 360° hue → `hsl(hue, 55%, 35%)` background. `displayName` drives the displayed _letter_; **`username` always drives the colour** (renames don't shuffle colours). Foreground is inline `#ffffff` (theme-independent, matching the inline-styled disk). No avatar upload (out of scope).

### 8.12 Leaderboard sort + pagination + filters

`GET /api/leaderboard?groupId=&orderBy=&offset=&limit=&leagueId=&seasonId=&overallOffset=&overallLimit=`. Response (Tier 24 slim shape):

```json
{ "overall": [/* top-50 */],
  "overallMeta": { "rows":[...], "total":N, "viewerRow":{...}, "offset":0, "limit":50 },
  "group": [/* current page */],
  "groupMeta": { "rows":..., "total":..., "viewerRow":..., "orderBy":..., "offset":..., "limit":... } }
```

`orderBy ∈ points|winRate|username`; `limit` capped 50; `overallLimit` ≤500, `overallOffset` ≤10000. `viewerRow` is always populated (even when paged out) so the UI can show "Your rank: 247". League/season filters scope BOTH blocks (cache key carries the axes: `overall:l:<id|*>:s:<id|*>`, `group:<id>:l:<id|*>:s:<id|*>`). Users with zero in-scope picks stay listed at `points:0`. My Picks scoping is client-side. Masking (§8.16) projects on top of the row shape.

### 8.13 Materialized leaderboard scores (Tier 24)

Replaces the old O(picks×games×users) JS aggregation (which would OOM the 1 GiB replica at launch volume) with two tables maintained incrementally on every score-affecting write.

```sql
CREATE TABLE user_scores ("userId" UUID, "leagueId" UUID, "seasonId" UUID,
  points INT DEFAULT 0, "picksScored" INT DEFAULT 0, "picksWon" INT DEFAULT 0, "updatedAt" TIMESTAMPTZ,
  PRIMARY KEY ("userId","leagueId","seasonId"), <all 3 FK CASCADE>);
CREATE INDEX user_scores_topn_idx ON user_scores ("leagueId","seasonId",points DESC,"userId") WHERE points>0;
CREATE TABLE user_scores_overall ("userId" UUID PRIMARY KEY, points INT, "picksScored" INT, "picksWon" INT, ...);
ALTER TABLE picks ADD COLUMN "appliedResult" VARCHAR(10) NULL, ADD COLUMN "appliedPoints" INT DEFAULT 0;
```

`picks.appliedResult`/`appliedPoints` are idempotency sentinels (mirror Tier 17's Elo snapshot). The **8-arm transition matrix** in `UserScoreService.applyPickTransition(t, {pick, game})`:

| Arm | Before → after              | Action                                       |
| --- | --------------------------- | -------------------------------------------- |
| 1   | scheduled, result null      | no-op                                        |
| 2/3 | null → non-null (win/loss)  | INCREMENT by `scorePick`; stamp sentinels    |
| 4   | X → same X                  | **short-circuit no-op**                      |
| 5/6 | X → Y / X → draw            | DECREMENT old; INCREMENT new; restamp        |
| 7   | non-null → null (clear)     | DECREMENT old; clear sentinels               |
| 8   | pick deleted on scored game | DECREMENT old before destroy (`reversePick`) |

Round-trips (`null→home→null`, `home→away→home`) return both `user_scores` and `pick.{appliedResult,appliedPoints}` to **bit-identical** state — `appliedPoints` is the reverse-delta source of truth, not a recomputation. **7 write hooks** fire it inside the originating transaction: `PickService.{createPick, deletePick}`, `GameService.{setResult, bulkSetResult, applyLiveUpdate, cascadeDelete (deleteGame), cascadeDelete (bulkDelete)}`. Concurrency: `INSERT ... ON CONFLICT DO UPDATE` with **additive** `points = user_scores.points + EXCLUDED.points` (associative under concurrent writes — **never switch to a max-merge**). Read path reads the materialized tables + LEFT-JOIN zero-rows so no member drops. `TIER24_LEGACY_LEADERBOARD=1` flips back to JS aggregation; `PARITY_LOG_ENABLED=1` fires `assertParity` after each write hook (logs `tier24.parity_mismatch`). Operator backfill: `scripts/backfill-user-scores.mjs` (idempotent — **required once after the migration deploys** to stamp pre-existing scored picks). The 30-s cache stays as a concurrent-read buffer. Cost: ~80/50 bytes per row; ~0.5 ms per affected pick; top-50 read = one B-tree scan. Eliminated the Tier 25 C1 Redis dependency (no cross-replica coherence problem at the storage layer).

### 8.14 Leaderboard cache

[lib/leaderboardCache.js](lib/leaderboardCache.js) — `Map<key, {value, expiresAt}>`, 30-s TTL. `getOrBuild(key, builder)` / `invalidate('all'|key)` / `invalidatePrefix(prefix)` (clears every key matching `prefix` exactly or `prefix:*` — needed because one group scope spans many `(leagueId,seasonId)` variants) / `stats()` (exposed at `GET /api/admin/cache-stats`). **Every standings-affecting mutation must invalidate from inside the owning service:** `PickService.{create,delete}`→`'all'`; `GameService.{setResult,bulkSetResult,bulkDelete,deleteGame,applyLiveUpdate}`→`'all'`; `GroupService.{acceptInvite,joinPublic,leave,deleteGroup}`→`invalidatePrefix('group:<id>')`; `UserService.{deleteUserById,bulkAction}`→`'all'`; `PUT /me` when displayName/profileVisibility changes. Forgetting = stale standings ≤30 s.

### 8.15 Auth & account security (Tier 6)

**Session lifecycle:**

```
┌─────────────────┐   correct pw (+ 2FA when un-parked)   ┌──────────────────┐
│ unauthenticated │ ────────────────────────────────────► │   authenticated  │
│  (no cookies)   │                                        │  sc_access (15m) │
│                 │ ◄── 401 → POST /api/auth/refresh ────  │  sc_refresh (30d)│
└─────────────────┘                                        └──────────────────┘
        ▲                       /api/auth/logout                     │
        └─────────────────────────────────────────────────────────────┘
```

The access JWT lives 15 min; on expiry the next call 401s and `useRequest` transparently calls `POST /api/auth/refresh` (which only sees `sc_refresh` because of path-scoping) for a new pair, then retries — the user sees nothing. The refresh token lives 30 days, **rotates on every use**, and is revoked on `/api/auth/logout` (current device) and `/api/auth/reset-password` + `POST /api/me/password` (ALL devices via `revokeAllUserRefreshTokens` — the force-logout-everywhere primitive). Login on a new device does NOT revoke others; each device has its own active chain (`refresh_tokens.userAgent` captured for a future "active sessions" UI).

**Login flow (with the parked 2FA branch shown for context):**

```
POST /api/login {username, password}
   │
   ▼  bcrypt.compare(password, user?.password ?? LOGIN_DUMMY_HASH)   ← constant-time, runs in every branch
   ├─ wrong ─► loginAttempts++; if ≥5 → lockedUntil = NOW+15min ─► 401 {error:'Invalid credentials'} (generic)
   └─ correct
        │  clear loginAttempts / lockedUntil
        ▼
        (2FA PARKED — historically: if totpEnabledAt → issue sc_challenge JWT (5min, Path=/api/auth),
                       return {challenge:true}; client renders <TwoFactorChallenge>; POST /api/auth/2fa/verify
                       {code|recoveryCode} → speakeasy.totp.verify(window=1) OR Promise.all(codes.map(bcrypt.compare))
                       → clearCookie(sc_challenge) + setAuthCookies + {user})
        ▼  setAuthCookies(res, user) → INSERT refresh_tokens → {user}   (no token in body)
```

**Token storage pattern** (verify-email / password-reset / refresh): 32 random hex bytes generated by `generateRawToken()` — the **raw value only exists in transit** (email link or cookie); `crypto.createHash('sha256').update(raw).digest('hex')` is stored in `tokenHash` (unique-indexed, O(1) lookup). We do NOT bcrypt these (256 bits is brute-infeasible, and bcrypt-comparing every candidate row per verify would be needless). **Recovery codes are the exception** — human-typable 10-char strings (low entropy) → `bcrypt.hash(code, 8)`, looped on verify (only 10 per user, bounded cost). **Brute-force defence stacks:** `loginLimiter` (5/15min/IP) → per-user lockout (5 fails → 15 min, survives IP-switching) → generic 401 (no enumeration); `forgotPasswordLimiter` (3/h) + always-204; `clientErrorLimiter` (30/5min). **Email service never throws** (best-effort; do the DB work first, then dispatch).

**2FA is parked** — the route handlers, frontend components (`TwoFactorSetup`/`TwoFactorChallenge`), and zod schemas were removed; **kept by design:** `users.{totpSecret, totpEnabledAt, totpRecoveryCodes}` columns, every migration mentioning totp, `lib/auth.js CHALLENGE_COOKIE`/`CHALLENGE_TTL_MS`, the `twoFactorEnabled` (always `false`) field on `GET /me`, and the `speakeasy`/`qrcode` deps. Revival is `git revert <commit b2bd286>` (no `npm install`, no schema work). **Before reviving,** audit `SELECT COUNT(*) FROM users WHERE "totpEnabledAt" IS NOT NULL` (should be 0 — migration `20260514000001` cleared them all in May 2026) and decide whether to enforce 2FA for any stragglers or wipe + treat as opt-in.

### 8.16 Profile privacy (Tier 8.6)

`profileVisibility`: `public` (anyone), `friends` (accepted friends + self + admins), `private` (self + admins). **Friends-gated-out and private both return an identical 404** from `getProfileByUsername` — distinguishing them would let an attacker probe the friend graph by watching which 404s become 200s after a friend flow. **Leaderboard masking** — the cache stores **viewer-agnostic** rows carrying `profileVisibility`; `LeaderboardService.getOverallForViewer`/`getForGroupForViewer` apply `applyMasking(rows, {viewerId, viewerIsAdmin, friendIds, exemptIds})` per request. Rule per row: admin → never; self → never; `userId ∈ exemptIds` → never; `public` → never; `friends && userId ∈ friendIds` → never; otherwise replace `username` with `displayName` else `'Player #'+uuid.slice(0,4)`, set `isMasked:true`. **Group implicit social contract:** within a group leaderboard, `exemptIds` = the group's membership, so members never see each other masked (joining is consent). Friend-request search bypasses the gate (returns the username + `profileVisibility`). Cache invalidation on `PUT /me` when `displayName`/`profileVisibility` change.

### 8.17 Football data integration (Tier 4b + 18)

Three layers. **Provider client** ([lib/footballApi.js](lib/footballApi.js)) wraps football-data.org v4 behind a provider-agnostic surface (`getCompetitions` / `getFixtures({code})` / `getLiveMatches()` (single global `?status=LIVE,IN_PLAY,PAUSED`) / `getMatchesByIds(ids)` (≤50/call)). Every fetch wrapped in a **10-s AbortController** (`AbortError` → 502 `football_api_unreachable`; `response.json()` failure → 502 `football_api_bad_response`). Rate budget env-driven (`FOOTBALL_DATA_RATE_LIMIT`, default 20 for TIER_ONE); a 60-s sliding window bails at `available <= 1` (always reserving 1 slot for admin syncs). Responses cached (`lib/cache.js`): fixtures 1 h, live 30 s. TIER_ONE does NOT expose `minute`/`injuryTime` — the frontend estimates (see below). **Status mapping** ([lib/fixtureStatus.js](lib/fixtureStatus.js)) — single source of truth shared by `LeagueService.upsertFixture` and `GameService.applyLiveUpdate`: `mapUpstreamStatus(raw)` (LIVE/IN_PLAY/PAUSED/EXTRA_TIME/PENALTY_SHOOTOUT/SUSPENDED → `'in-progress'`; FINISHED/AWARDED → `'finished'`; POSTPONED/CANCELLED distinct) and `deriveResultFromFixture(fixture, localStatus)` (prefers `score.winner` over score comparison so penalty knockouts resolve; upstream `DRAW`/score-equality → `'draw'`). football-data wants **comma-separated** `?status=X,Y,Z` (repeated params → 400).

**Jobs** ([lib/scheduler.js](lib/scheduler.js) + [lib/jobs/](lib/jobs/)). The scheduler acquires `pg_try_advisory_lock(crc32(jobName))` per tick (deterministic + stable across deploys → multi-replica runs each tick once; lock released in `finally`); no-op when `NODE_ENV=test`. All jobs early-return when `FOOTBALL_DATA_API_KEY` is unset. The three football jobs:

- **syncFixtures** (daily 03:00 UTC) — iterate `active=true` leagues → `LeagueService.syncFixtures(leagueId)`; one league failure doesn't stop the rest.
- **syncLiveScores** (30 s) — **cost-gate first**: a cheap `Game.count` against `{leagueId IN active, [(status='in-progress') OR (status='scheduled' AND date IN [now−4h, now+2h])]}`; count 0 → `{skipped:true, reason:'no-relevant-games'}` before any upstream call (Container Apps bills per vCPU-second; pre-gate, off-season ramped daily cost from ~$0.10 to ~$0.77). Then: global LIVE poll → `applyLiveUpdate` per match → **reconcile pass** via `?ids=` for local in-progress games missing from the LIVE response (caught IN_PLAY→FINISHED) or local scheduled games with kickoff >15 min ago (caught missed SCHEDULED→IN_PLAY). The 4 h lookback covers a kickoff that passed while scaled to zero (longest match ≈165 min); the 2 h lookahead catches the SCHEDULED→IN_PLAY flip.
- **reconcileInProgressGames** (3 min) — defensive `?ids=` sweep over every local `status='in-progress'` game _regardless_ of LIVE-filter membership; closes the upstream `?status=` staleness gap (incident below); idempotent; self-gated (empty when nothing is live).

**`applyLiveUpdate(localGame, apiMatch)`** is transactional + hardened:

```
BEGIN
  fresh = SELECT * FROM games WHERE id=? FOR UPDATE     # serializes the 30s+3min jobs on the row
  if fresh.status=='finished' && apiMatch.status not in ('FINISHED','AWARDED'):
     log + return changed=false                          # finished-status flip-back guard
  newStatus = mapUpstreamStatus(apiMatch.status)
  newResult = deriveResultFromFixture(...)               # only if fresh.result === null
  transitionedOutOfScheduled = (fresh.status=='scheduled' && newStatus!='scheduled' && !fresh.pickProbabilitiesLockedAt)
  if (!changed) return early
  UPDATE games SET status, scores, result, halfTimeReached, phase WHERE id=?
  if transitionedOutOfScheduled: bulk-lock pick probabilities + stamp pickProbabilitiesLockedAt  # Tier 19
  if transitionedToFinished && newResult: PredictionService.onResultUpdated(fresh, {transaction})  # Tier 17 Elo
COMMIT
POST-COMMIT (outside tx): per-pick notify('pick-scored') + evaluateBadges + UserScoreService transition;
  StreakService.applyForUser per unique user; LeaderboardService.invalidate('all');
  PredictionService.rePredictFutureFixtures({affectedTeams, leagueId})
```

The `FOR UPDATE` lock + flip-back guard close the 2026-05-19 race/regression. **Don't drop the lock; don't widen the guard to accept non-FINISHED/AWARDED.**

**Live-minute display** (`src/utils/time.js matchMinute(kickoff, {halfTimeReached, phase})`): `phase==='penalty-shootout'`→"PEN"; `'extra-time'`→"ET"; `halfTimeReached && elapsed∈[46,60]`→"HT"; `!halfTimeReached && elapsed>45`→"45'"; post-HT minute shifted down 15 for the break; `>90`→"90'+". `halfTimeReached` is monotonic.

**Incident postmortem — 2026-05-19, AFC Bournemouth 1–1 Manchester City (sourceId 538145):**

- **Trigger.** The fixture finished 1–1 at 22:25 UTC. The canonical `?ids=538145` endpoint immediately reflected `status=FINISHED, winner=DRAW, fullTime=1-1, lastUpdated=22:25:33Z`. But the filtered `?status=LIVE,IN_PLAY,PAUSED` endpoint kept returning the match as `IN_PLAY` with the HT score `1-0` until ~23:59 UTC — a **94-minute divergence between two endpoints of the same provider.**
- **Local impact.** The 1-min `syncLiveScores` job polled the LIVE filter and faithfully mirrored the stale snapshot. The existing reconcile pass _explicitly excluded_ 538145 from `?ids=` escalation because the game WAS present in the LIVE response (`sourceId NOT IN [...liveSourceIds]`). So the fresh endpoint was never consulted. The row stayed `status='in-progress', homeScore=1, awayScore=0, result=null` — picks couldn't score, the leaderboard couldn't update, no notifications fired.
- **Why prior design missed it.** The architecture assumed the two endpoints share one freshness lane: the filter was trusted to enumerate "what's live", and canonical lookup was only for catching matches that had _dropped off_ the filter. football-data.org's free tier broke that assumption. (The TIER_ONE upgrade has NOT been verified to fix the underlying staleness — the defensive sweep stays.)
- **Diagnostic path** (preserved): (1) direct DB probe found the stuck row; (2) probed both endpoints from inside the prod container with the live key — `?ids=` correct, `?status=` stale (confirmed an upstream bug, not ours); (3) traced the reconcile predicate and identified the LIVE-filter-membership exclusion as the gap.
- **Fix (commit `c2d8fae`, revision `scorecast-app--0000045`).** (1) New 3-min `reconcileInProgressGames` — sweeps every local `status='in-progress'` game via `?ids=` _regardless_ of LIVE-filter membership. (2) `SELECT ... FOR UPDATE` row lock in `applyLiveUpdate` — serializes the 30-s and 3-min jobs at xx:00/xx:05 alignments (without it, both could read the same stale snapshot at the same instant and the second `save()` would overwrite the first). (3) Finished-status flip-back guard — once `fresh.status === 'finished'`, any `apiMatch.status` other than `FINISHED`/`AWARDED` is treated as a stale lie and ignored (FINISHED/AWARDED still allowed through, so legitimate score corrections / replay re-finalizes propagate).
- **Live verification timeline (UTC).** 23:47:37 new revision boots, `reconcileInProgressGames` registered → 23:50:01 first `*/5` tick catches 538145 (`caught stale-upstream finish via ?ids= ... result=draw`); DB transitions to `finished, 1-1, draw` → 23:50:06 → 23:59:03 the guard fires 10× (once/min) as the 1-min job keeps seeing the still-stale `?status=` snapshot; every guard fire is logged and the row preserved — **zero regressions across 10 adversarial ticks** → ~00:00 upstream's filter catches up; guard log stops.
- **Worst-case stuckness:** pre-fix 92+ min (would have continued to the next daily sync at 03:00); post-fix **≤3 min** (next reconcile tick).
- **Accepted residual risks** (not addressable in code alone): both endpoints simultaneously stale → admin manual override is the only path (provider swap is the long-term fix); app scaled to zero during a tick → in-process node-cron loses that tick, next reconcile recovers within ≤3 min (eliminated by `minReplicas=1`, now shipped); `FOOTBALL_DATA_API_KEY` unset → cron silently no-ops (dev behaviour).
- **Operational signature:** repeated `applyLiveUpdate: ignored stale non-FINISHED upstream snapshot for already-finished game` log lines for one sourceId = the upstream-filter-staleness signature. Cost per firing: one PK-lookup transaction + one log line. If it ever fires for many fixtures at once, demote the log to `debug` or rate-limit per-game.

### 8.18 Kickoff-time pick scoring lock (Tier 19 Chunk 5)

**Problem:** pre-lock, the pick-time probability snapshot was written once at create and never updated — a Monday picker at home=0.30 scored +70, a Saturday picker at home=0.45 (after the cascade moved odds) scored +55, for the same outcome. **Solution:** the authoritative snapshot moves to kickoff-time so all picks on a game score identically. Two writers (defense in depth): (1) the 1-min cron [lib/jobs/lockPickProbabilities.js](lib/jobs/lockPickProbabilities.js) (cost-gated by `Game.count` against `{status:'scheduled', pickProbabilitiesLockedAt:null, date<=NOW()}`; per-game `FOR UPDATE` then bulk `Pick.update` + stamp); (2) the in-line block in `applyLiveUpdate` (atomic with the status flip, captured as `transitionedOutOfScheduled` _before_ the status assignment). Whichever fires first, the other no-ops (the `pickProbabilitiesLockedAt IS NULL` predicate excludes it). The partial index `games_unlocked_scheduled_idx (status,date) WHERE NULL` keeps the cron query cheap. `rePredictFutureFixtures` gains a paranoid `pickProbabilitiesLockedAt: null` guard. **Tradeoff (deliberate):** the "pick early at long odds" loop is gone; same-team picks pay the same. The `'odds-shifted'` notification stays meaningful pre-lock and becomes structurally impossible post-lock.

### 8.19 Win streaks (Tier 30 Phase 3 A1 revision)

Per-result **win streak** (replaced the original calendar-day pick streak after feedback that lining up a month of picks in one day was a weak +1). `classify(pick, game)`: **W** (`result∈{home,away}` AND `choice===result` → +1), **D** (`result==='draw'` → no-op), **L** (any other scored result → reset to 0). Pending picks filtered out. `computeStreakFromPicks(scoredPicks)` (pure) sorts by `(date ASC, resultPriority ASC, gameId ASC)` with `W=0,D=1,L=2` so **same-kickoff wins land first** and `longest` captures the batch peak (user spec: "highest ever streak recorded including games won concurrently, even if one match ends before the other" — prev=5 + same-kickoff W/W/L → current 0, longest 7). **`longest` is monotonic** (`save = max(prev.longest, computed.longest)` — a retroactive trim keeps the peak). Fired fire-and-forget POST-transaction from `GameService.{setResult, bulkSetResult, applyLiveUpdate}` via `fanOutStreakUpdates(picksForGame)` (one `applyForUser` per unique userId) — **not from PickService** (pick creation no longer affects the streak). `resolveMilestone(newCurrent, prevStamp)` fires the largest of `STREAK_MILESTONES=[5,10,15,20,30,50]` in `{M : M≤newCurrent AND M>prevStamp}` (one push per recompute); on a drop the stamp falls back so re-crossings re-fire. `streak-milestone` push → `/?view=profile`. Streakmaster badge I/II/III at 5/10/15. Backfill: `scripts/recompute-streaks.mjs` (idempotent, ASCII-only). Cost O(N lifetime scored picks per affected user), sub-ms.

### 8.20 Referrals (Tier 30 Phase 3 A2)

`users.referralCode CHAR(8) UNIQUE` (server-set, backfilled deterministically from id + collision sweep) + `referredByUserId` (stamped on register when a valid code is supplied; unknown codes silently ignored; partial index `WHERE NOT NULL`). `?ref=CODE` consumed on first mount → pre-fills RegisterForm. `<ReferralCodePanel>` (SettingsView → Account) renders the code + copy-invite-link (`${origin}/?ref=CODE`). Drives the Recruiter badge tier (referees with ≥1 scored pick) via the referrer fan-out in §8.5.

### 8.21 Voice-of-the-crowd (Tier 30 Phase 3 A3)

`GameService.getCrowdForGames(gameIds)` → `Map<gameId,{home,away,total}>` via a single bulk `SELECT gameId, choice, COUNT(*) GROUP BY gameId, choice`; per-game 60-s cache (empty buckets stamped so zero-pick games don't re-query). `listGames()` attaches `crowd` **only after the match has started** — `status !== 'scheduled'` OR `new Date(date) <= now` — **hidden until kickoff for everyone, picker or not** (the anti-bias contract; the field is OMITTED from the JSON below the gate so DevTools can't bypass it). `PickService.{create,delete}` call `invalidateCrowd(gameId)`. The `<CrowdMeter>` (GameCard) renders a "WISDOM OF THE CROWD" header + a 28 px Home/Away segmented bar with `awayPct = 100 − homePct` so rounding never leaves a sliver. **Don't move to client-side gating; don't re-add the pick-based reveal.**

### 8.22 Share-as-image (Tier 30 Phase 3 A4)

`GameCard.captureAndShare({game, choice, points, ratio})` is an imperative `createRoot` dance: dynamic-import `react-dom/client` + `<ShareableCard>` + `lib/share`; mount off-screen at 1080×1920 (Story default) or 1080×1080; wait 2 RAF ticks; **`await Promise.all(document.fonts.load("<weight> <size> 'Orbitron'"))` for all 5 weights (500/600/700/800/900) + `document.fonts.ready`** (RAF covers paint, NOT web-font download — without this it rasterizes Courier New); `html-to-image.toBlob`; route through `navigator.share({files})` on mobile or a PNG download on desktop/cancel; `unmount()` + `host.remove()` in `finally`. `<ShareableCard>` styling is **inline hex** (the raster has no Tailwind/token context). All 5 Orbitron weight CSS imports in `main.jsx` must match the load list. Instagram's destination picker is unavoidable from a PWA (`instagram-stories://share` needs native `UIPasteboard`) — a single Square/Story button only; `captureAndShare(ratio)` keeps the param.

### 8.23 Personal stats dashboard (Tier 30 Phase 3 C1)

`StatsService.getStatsForUser(userId, {window})` (`window ∈ 30d|90d|season` — season = rolling 1 year) returns: `summary {picks,scored,wins,points}`; `pointsOverTime` (per-UTC-day, **zero-filled** + running cumulative); `winRateTrend` (per-active-day + 14-day MA); `perLeague` (W/D/L by league, `null`→'Other'); `pickTimeHeatmap` (7×24 UTC dow×hour); `blindSpot` (worst team by loss-rate at ≥3 picks + ≥1 loss; templated, no LLM); `mostDisagreedFriend` (accepted Friendships × cross-pick join, most differing choices on shared games). `points` via `scorePick` (honours pick-time snapshot). 5-min cache keyed `stats:<userId>:<window>` (no invalidation hooks — acceptable drift; `invalidateForUser` exists, unwired). Route `GET /api/me/stats` (auth, 400 on unknown window). **Self-only — no `/api/users/:username/stats`** (the granular pick-time/blind-spot/disagreement data would defeat the §8.16 gate); the Stats sub-tab mounts only when `profile.friendStatus === 'self'`. Frontend `<StatsDashboard>` lazy-loads `recharts` (isolated `charts` chunk).

### 8.24 Onboarding tour (Tier 11 Chunk 4)

First-time users see a 4-step Radix Dialog ([src/components/OnboardingTour.jsx](src/components/OnboardingTour.jsx)) walking through **picks → scoring → leaderboard → groups**. State lives in `users.onboardingCompletedAt TIMESTAMPTZ NULLABLE` (NULL → fire). Mount condition: `user && !browseAsGuest && user.onboardingCompletedAt == null && view === 'games' && games.length > 0` (the `games.length > 0` gate avoids firing mid-load). Both **Skip** and **Done** `POST /api/me/onboarding-completed` (idempotent — preserves an existing timestamp); the user state's `onboardingCompletedAt` is set locally on success so it stops mounting immediately. Suppressed while the terms gate is open (no dialog stacking). Honours `useReducedMotion`. E2E seed users ship with `onboardingCompletedAt: now` so flows aren't blocked; runtime-registered test users are dismissed via the `dismissOnboardingTour()` helper.

### 8.25 Legal pages + terms acceptance (Tier 18 Chunk 6c)

End-to-end consent capture for the Trinidad & Tobago jurisdiction.

**Legal pages** ([src/components/legal/](src/components/legal/)): `LegalLayout` (shared chrome) + `Terms` / `Privacy` / `Copyright` / `CookiePolicy`. `App.jsx` checks `window.location.pathname` against `/terms`, `/privacy`, `/copyright`, `/cookies` **BEFORE any boot/auth/view logic** and returns the matching component — anon + authed see identical content, no skeleton wait. Trailing slash normalized. The existing SPA fallback in `server.js` means no backend route changes are needed. Copy is **deliberately plain-English** — NO specific cookie names (`sc_access` etc.), NO exact retention windows (24h/15min/30d), NO security-mechanism names (bcrypt/SHA-256/HttpOnly/CSP), NO named sub-processors (Azure/Cloudflare/Resend/Sentry). This satisfies T&T DPA Chapter 22:04 (2011) disclosure without publishing an attacker-friendly inventory; a real DPA inquiry can be answered with specifics privately. Operator details live in a `LEGAL_CONTACT` constant per file. `<Footer>` (Landing + DashboardView) links to all four via plain `<a href>` (full navigation back through the short-circuit).

**Terms acceptance:** `users.{termsAcceptedAt, termsAcceptedVersion}` (both nullable). `CURRENT_TERMS_VERSION` (currently 2) lives in **TWO files that must stay in sync** — `validation/schemas.js` (server: drives `registerSchema`'s `acceptedTerms: z.literal(true)` + `acceptedTermsVersion: z.literal(CURRENT_TERMS_VERSION)` + the `confirmedAge: z.literal(true)` age gate, and `acceptTermsSchema`) and `src/lib/terms.js` (client: `needsTermsAcceptance(user)` + the version sent). **Bump BOTH in one commit** (bumping only the client → 400 on every registration; only the server → traps every user in the modal). Registration stamps both columns on `User.create` so new users never see the modal. `<TermsAcceptanceModal>` mounts when `user && !browseAsGuest && needsTermsAcceptance(user)` and is **fully blocking**: `onEscapeKeyDown`/`onPointerDownOutside`/`onInteractOutside` all `preventDefault`, `onOpenChange` is a no-op; the only actions are "I accept" (`POST /api/me/accept-terms {version}` — 400 on a stale version) or "Sign out". `confirmedAge` is NOT persisted — the registration row + `termsAcceptedAt` ARE the consent record (PII-minimization; the 13+ line lives in Terms §3). Seed users pre-accepted at version 2; `registerViaUI` ticks both `#register-confirm-age` and `#register-accept-terms`.

### 8.26 Games calendar (Tier 18 Chunk 3)

Replaces the original "live / upcoming / completed" cascade with a fixed 7-day strip ([src/components/GamesCalendar.jsx](src/components/GamesCalendar.jsx)) inside `view === 'games'`.

**Window math:** 7 cells visible (today−3 → today+3, centred on today). Window index `N` covers `[N*7−3, N*7+3]` relative to today; `windowIndex=0` default. Prev/Next arrows page ±7 days (no horizontal scroll; `grid grid-cols-7`). `?date=YYYY-MM-DD` read on mount (regex-validated); if the URL date sits outside the default window, `windowIndex = Math.round(diffInDays(today, urlDate) / 7)` so the chip is visible on first paint. Selecting a chip writes `?date=` via `history.replaceState`; **selecting today's chip DELETES the param** (today is canonical). Subscribes to `scorecast:url-changed` (re-reads `?date=` + snaps `selectedKey`/`windowIndex` on in-app nav).

`useGames` exports `dayKey(value)` (`Intl.DateTimeFormat('en-CA')` → `YYYY-MM-DD`) + a `byDay: Map<string, Game[]>` memo for O(1) per-day lookups; `consumeDeepLinks` writes matching `?date=` keys. Chips show: cyan day-number (inline style to bypass CSS conflicts), game count, live red pulsing dot (`meta.hasLive`). Active chip `bg-accent/15`; today's chip `border-accent/40` even when unselected. "Back to today" / "Next game day" pill in the header (the latter jumps to the soonest future day with games; pulses red when any in-progress game today regardless of window). Empty days render a day-aware `EmptyState`.

### 8.27 Friends' picks visibility (Tier 18 Chunk 4)

Surfaces every friend's pick on every game in a ±30-day window. **Endpoint** `GET /api/picks/friends?gameId=<uuid>` ([routes/picks.js](routes/picks.js) → `PickService.listFriendsPicks(viewerId, {gameId})`): `FRIENDS_PICKS_HORIZON_DAYS = 30`, `FRIENDS_PICKS_MAX_ROWS = 500`, INNER JOIN against `Game` (date + optional gameId filter apply server-side). Each row is **scored server-side via `scorePick`** (honouring the Tier 17 pick-time snapshot — a friend who picked at 0.35 odds shows +65 even if the cascade later rewrote them; **don't score client-side**) and passed through `LeaderboardService.applyMasking` (a friend who flipped to private appears at their masked label, not username; **don't skip masking**).

**State:** `DataContext.friendsPicks` (flat slot, loaded in `loadDashboard` + `revalidate`). **Selector** `useFriendsPicks` memoizes `byGame: Map<gameId, FriendPick[]>` (O(1) per-card). **Per-card** `<FriendPicksPanel game={game}/>` (bottom of every GameCard): collapsed "N friends picked" / "No friends picked yet"; expanded rows = Avatar + side chip + outcome badge:

| Game state                          | Badge          | Tone                                                         |
| ----------------------------------- | -------------- | ------------------------------------------------------------ |
| Pre-result (`result == null`)       | side chip only | neutral                                                      |
| Won (`choice === result`, not draw) | `✓ +<pts>`     | success (green)                                              |
| Drew (`result === 'draw'`)          | `Drew +<pts>`  | **warning yellow** (not green — matches GameCard convention) |
| Missed (`choice !== result`)        | `✗ Missed`     | danger (not "+0" — easier to read)                           |

**My Picks "Friends" tab:** `[Mine|Friends]` SubTabs + a friend dropdown (Friends mode, LEFT of `LeaderboardFiltersBar`). Shared `comparePicksByPendingThenRecent` comparator (unresolved kickoff ASC, then resolved kickoff DESC). Pill label "Friends" has no apostrophe; the section heading "Friends' Picks" keeps it (deliberate, kept for screen-reader consistency). Honours `leaderboardFilters` client-side.

### 8.28 PWA + Web Push (full pipeline)

**Frontend installability:**

```
index.html: <link rel="manifest"> · apple-touch-icon · theme-color · viewport-fit=cover
   │ on first load
   ▼ vite-plugin-pwa registerSW.js → navigator.serviceWorker.register('/sw.js')
   ▼ dist/sw.js (built from src/sw.js via injectManifest):
       workbox precache(self.__WB_MANIFEST)
       runtime caching: Google Fonts (CacheFirst); /api/{games,leaderboard,me,groups,leagues} (SWR 5min)
       skipWaiting + clientsClaim + SKIP_WAITING message listener (RefreshButton posts it)
       'push' handler → registration.showNotification(title, {body, icon, badge, tag:type, data:{link}})
       'notificationclick' → focus existing tab OR clients.openWindow(data.link)
   ▼ user gesture: <InstallPrompt> "Install app" (Chromium beforeinstallprompt)
       OR Safari Share→Add to Home Screen (iOS) → installed standalone PWA
```

Icons: `public/logo.svg` → `scripts/generate-pwa-assets.mjs` (`@resvg/resvg-js` + `png-to-ico` — sidesteps the broken `sharp` win32-arm64 prebuild). `<InstallPrompt>` self-suppresses once installed / dismissed (`localStorage.sc_install_dismissed`).

**Backend push pipeline:**

```
NotificationService.notify(userId, type, title, body, link)
   1. Notification.create(...)  → in-app bell row
   2. PushService.sendToUser(userId, type, {title,body,link}).catch(()=>{})   ← fire-and-forget, post-insert
        if !initialized (VAPID env unset): silent no-op
        user.pushPreferences[type] === false ? skip
        subs = PushSubscription.findAll({userId})
        Promise.all(sendToSubscription(sub)):
           webpush.sendNotification(sub, payload, {TTL:24h})
           on 410/404 Gone → destroy sub ; other error → failureCount++ (auto-purge at 5)
           defensive SSRF block: drop the sub if its endpoint host resolves to a private/loopback IP
```

**Subscription:** `usePushSubscription` drives the W3C ceremony — `Notification.requestPermission()` → `GET /api/push/vapid-public-key` → `pushManager.subscribe({userVisibleOnly:true, applicationServerKey})` → `POST /api/push/subscribe` — with rollback on server failure so client+server never drift. **Per-type prefs:** `users.pushPreferences` JSONB; absent/`true`=deliver, only explicit `false` opts out; `PUT /me/push-preferences` does a partial merge. **Endpoint allowlist** (`pushSubscribeSchema.endpoint` refine): host must be FCM / Apple / Mozilla (or `.notify.windows.com` / `.push.apple.com`) + HTTPS-only — a new provider edits the schema. **iOS constraint:** Safari only supports Web Push from an _installed_ PWA on 16.4+ — `PushSettingsPanel` renders an install-first gate when `isIos && !isStandalone` (the master toggle stays disabled until reopened from the home-screen icon; don't try to "fix" this — iOS rejects the subscription otherwise). **VAPID config:** `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (generate with `npx web-push generate-vapid-keys`); the private key is a KV secret seeded by hand before the first Bicep apply that wires push; without all three, `init()` warns once and `sendToUser` is a permanent no-op + `GET /push/vapid-public-key` 503s. Bell drops its poll 30 s → 5 min when a SW controls the page.

---

## 9. The Machine-Learning Pipeline

**Why it exists:** the scoring formula needs real per-game probabilities — without them `LeagueService.upsertFixture` writes the sentinel `(0.50, 0.00, 0.50)` and every pick pays a flat 50 with no edge to find. The pipeline activates (1) the upset bonus, (2) draw partial-credit (needs `drawProbability > 0`), and (3) the PayoutMatrix preview.

**Tier 17 inversion (2026-05-23):** the daily Container Apps Job that scored fixtures and POSTed through the admin API is **gone** (along with `ml-deploy.yml`, `ml-job.bicep`, the `scorecast-ml` ACR repo, and the `ml_pipeline` DB user). Inference now runs **in-process in Node** and fires **reactively on every captured result** — Elo updates atomically inside the result transaction; upcoming fixtures get re-predicted after commit. Python is **training-only**.

### 9.1 Offline training (Python, `ml/`)

```
ml/data/raw/PL_*.csv  (32 seasons, ~3 MB, committed via .gitignore negation)
   │
   ▼  python -m scorecast_ml train --league PL
   1. parse CSVs (ingest/football_data_uk.py — tolerates ragged trailing columns)
   2. strict reconcile vs reconcile/teams.json (KeyError on any unmapped name)
   3. Elo walk (elo/engine.py — K=20, INITIAL=1500, HFA=0, promoted='min_rating') → home_elo_pre, away_elo_pre
   4. 2-feature matrix [home_elo, away_elo] + H/D/A labels {H:0,D:1,A:2}
   5. XGBoost multi:softprob (max_depth 4, lr 0.05, 400 rounds, early-stop 30, seed=42)
      time-based split: train through --train-through-season, val on --val-season
   6. booster.save_model('ml/data/models/PL_elo_<date>.json')
   │
   ▼  operator: cp → lib/ml/models/PL_elo.json ; git commit + push  (CD bakes it into the next image)
```

`requirements.txt` slimmed to pandas/numpy/xgboost/scikit-learn/typer/pydantic-settings/structlog/python-dateutil (+ pytest/ruff). No httpx/tenacity/psycopg/rapidfuzz/joblib/pyarrow (no API writes, DB reads, fuzzy matching, joblib bundles, or parquet anymore).

### 9.2 Runtime inference (Node, in-process)

- **[lib/ml/eloMath.js](lib/ml/eloMath.js)** — pure Elo. `expectedHomeScore(h,a) = 1/(1+10^((a−(h+HFA))/400))`; `eloDelta(h, a, result, {kMultiplier=1, neutral=false})` (neutral forces HFA=0; both delta legs ×kMultiplier; zero-sum `home === −away`). JS port of `ml/scorecast_ml/elo/engine.py`; parity-tested both ways. **`opts={}` is bit-identical to the no-opts signature** (PL non-regression).
- **[lib/ml/xgboostInference.js](lib/ml/xgboostInference.js)** — zero-dep native-JSON tree walker + numerically-stable softmax (subtract max before exp). Accumulates per-class logits via `tree_info[t]`. **`parseBaseScore()` defaults to 0** when XGBoost 2.x emits a hex-float `base_score` (`Number("5E-1F")` is NaN; for `multi:softprob` base_score broadcasts equally and cancels under softmax — caught poisoning the live cascade with `[NaN,NaN,NaN]` for ~48 h). Honours `default_left[i]` on NaN features. Throws on any non-finite output (surfaces bugs at the predict boundary). `loadModel(path)` returns `null` on a missing file → the cascade no-ops `{rewritten:0, skipped:'no model'}` (never crashes a result commit). ~50 µs/fixture (depth-4 × 615 trees).
- **[lib/ml/normalize.js](lib/ml/normalize.js)** — `toThreeWay(p_h, p_d, p_a)`: validate range → renormalize if drifted (±5% tolerated, throw on wilder) → **clip each to [0.01, 0.99] BEFORE rounding** (DECIMAL(3,2) rounds <0.005 to 0.00; without the clip an isotonic-style 0.001 emits a literal "0% chance" — load-bearing, not defensive) → round to 2 dp → absorb the residual into the class with the largest **raw** probability (not the largest rounded value — preserves model ordering through ties) → nudge off the `(0.50,0.00,0.50)` sentinel (shift to `(0.51,0.00,0.49)` / `(0.49,0.00,0.51)` by raw direction).

**The XGBoost 2.x native-JSON format** (what `xgboostInference.loadModel` parses):

```jsonc
{
  "learner": {
    "learner_model_param": { "num_class": "3", "base_score": "<C99 hex-float string>", ... },
    "gradient_booster": { "model": {
      "trees": [
        { "tree_param": { "num_nodes": "N" },
          "left_children":    [int...],   // -1 ⇒ leaf
          "right_children":   [int...],
          "split_indices":    [int...],   // feature index at a split node
          "split_conditions": [float...], // threshold (or leaf weight when a leaf)
          "default_left":     [0|1...],   // direction taken for a NaN feature
          "base_weights":     [float...]  // leaf output value
        }, ...
      ],
      "tree_info": [int...]               // class index per tree (multi:softprob)
    } }
  }
}
```

**The tree walker** (zero-dep, ~150 LOC):

```js
function walkTree(tree, features) {
  let i = 0;
  for (let steps = 0; steps < tree.left_children.length; steps += 1) {
    if (tree.left_children[i] === -1) return tree.base_weights[i]; // leaf
    const f = features[tree.split_indices[i]];
    const goLeft = Number.isNaN(f) ? tree.default_left[i] === 1 : f < tree.split_conditions[i];
    i = goLeft ? tree.left_children[i] : tree.right_children[i];
  }
  throw new Error('walkTree: did not reach a leaf within num_nodes steps');
}
```

`predict(model, features)` sums per-class logits across that class's trees (`tree_info[t]` says which class tree `t` belongs to), adds `base_score` uniformly (a no-op for softmax — it broadcasts equally and cancels), runs a numerically-stable softmax (subtract `max(logits)` before `exp` to avoid overflow), and **throws if any output is non-finite** (surfaces propagation bugs at the predict boundary, not silently inside `toThreeWay`). `loadModel(path)` is the graceful-missing-model boundary: absent file → warn + return `null`; the cascade null-checks and no-ops `{rewritten:0, skipped:'no model'}` so a missing JSON never crashes a result commit.

**The hex-`base_score` gotcha** (caught poisoning the live cascade with `[NaN,NaN,NaN]` for ~48 h until PR E): XGBoost 2.x serialises `learner_model_param.base_score` as a C99 hex-float string (e.g. `"5E-1F"` for 0.5). JS `Number("5E-1F")` returns `NaN`. `parseBaseScore()` defaults to **0** when the parse fails — correct for `multi:softprob` (shift-invariant under softmax). For a future `binary:logistic` model it would matter (there's a TODO).

**Performance:** depth-4 × 615 trees ≈ 9,800 comparisons + a small softmax ≈ **~50 µs per fixture**. A typical PL result rewrites 5–15 fixtures → ~0.5 ms total cascade overhead. Effectively free.

### 9.3 The reactive cascade (`PredictionService`)

```
GameService.setResult / bulkSetResult / applyLiveUpdate
  └─ sequelize.transaction(t):
       game.result = next; game.status = 'finished'; game.save({t})
       PredictionService.onResultUpdated(game, {t}):
         previous = game.appliedResult; next = game.result
         if previous === next → idempotent no-op, return null
         Team.findOne(homeTeam,leagueId).LOCK.UPDATE ; same for away   # serialize concurrent captures
         read kMultiplier = game.eloKMultiplier ?? 1 ; neutral = game.neutralVenue
         if previous != null && snapshot present:
            team.elo -= eloDelta(homeEloPre, awayEloPre, previous, {kMultiplier, neutral})   # reverse
         if next != null:
            if !snapshot: game.homeEloPre = liveHomeElo; game.awayEloPre = liveAwayElo        # snapshot once
            team.elo += eloDelta(homeEloPre, awayEloPre, next, {kMultiplier, neutral})        # apply
         team.gamesPlayed += {0|+1|−1} ; team.lastMatchDate = game.date (on apply)
         game.{homeEloPre, awayEloPre, appliedResult} = ...; game.save({t})
       UserScoreService.applyPickTransition(t, ...) per pick
  └─ COMMIT  (mid-cascade exception → ROLLBACK; result + Elo + scores all consistent)
  POST-COMMIT (best-effort, .catch — can't undo the result):
    per pick: notify('pick-scored') + evaluateBadges ; StreakService.applyForUser per user ;
    LeaderboardService.invalidate('all') ;
    PredictionService.rePredictFutureFixtures({affectedTeams, leagueId}):
       resolve sourceLeagueId → MODEL_PATHS[code] (per-league cache)
       Game.findAll({leagueId, status:'scheduled', pickProbabilitiesLockedAt:null, homeTeam|awayTeam IN affected})
       for each fixture: probs = predict(model, [homeElo, awayElo])
         if neutralVenue: probsSwap = predict(model, [awayElo, homeElo]);
            home=(probs[0]+probsSwap[2])/2; draw=(probs[1]+probsSwap[1])/2; away=(probs[2]+probsSwap[0])/2  # symmetrize
         triple = normalize.toThreeWay(...) ; game.update({home/draw/awayProbability})
```

**PR F reversibility** — `games.{homeEloPre, awayEloPre}` snapshot the **pre-match** Elo pair at first capture and are **immutable thereafter**. A result change reverses the prior delta against the _snapshot_ (not live Elo, which may have shifted from other games) and applies the new delta against the _same_ snapshot, so A→B→A round-trips to **bit-identical** Elo. `appliedResult` is the idempotency sentinel. `onResultUpdated` runs inside the transaction (atomic with the result); `rePredictFutureFixtures` runs after commit (best-effort).

### 9.4 Elo state in Postgres

`teams (name, leagueId)` holds per-team Elo NUMERIC(8,2). Bootstrapped by [seeders/20260522000001-seed-teams-from-elo-history.js](seeders/20260522000001-seed-teams-from-elo-history.js) (walks the committed CSV history in JS with identical-to-Python math; `ON CONFLICT (name,leagueId) DO NOTHING` preserves live Elo). **Operator runs it once after the first prod deploy** — CD's migrate Job does NOT auto-seed. `LeagueService.ensureTeamExists` auto-inserts promoted clubs at `MIN(elo) WHERE leagueId=X` (1500 when empty) on every `upsertFixture`.

### 9.5 International model (intl-model, 2026-05-28)

A second booster [lib/ml/models/INT_elo.json](lib/ml/models/INT_elo.json) (615 trees, val mlogloss 0.883) trained on the martj42 archive (49,215 matches × 333 nations, committed at `international_match_archive/`). **All nations share ONE Elo pool via the existing `WC` league row** (the meta-pool — Euros/Copa/Nations League fold in here later; **don't add a new league row** without a plan to migrate the 333 team rows). `MODEL_PATHS.WC = INT_elo.json`. Two requirements shaped it:

1. **FIFA-style K-multiplier tiers** (×3.0 WC; ×2.5 WC-qualifiers + continental finals; ×2.0 continental qualifiers + Nations League; ×1.5 Confed Cup + Olympics; ×1.0 friendlies) applied as BOTH the Elo K-factor weight AND the XGBoost row `sample_weight`. The tier table is **duplicated in 3 files** (Python ingest `_KMULT_TABLE`, JS seeder `KMULT_TABLE`, `fixup-wc-state.mjs`) — change all three together.
2. **Neutral-venue symmetrization** — for `neutralVenue=true` games the cascade averages forward + swapped predictions with class-label compensation (`home=(probs[0]+swap[2])/2`, etc.), GUARANTEEING `predict(A,B) === predict(B,A)` (the fairness requirement). A 1-cent DECIMAL(3,2) residual on equal-team neutral fixtures is expected (test tolerance 0.0101). PL games (`neutralVenue=false`) skip this branch entirely → bit-identical to pre-intl.

Schema: `games.{neutralVenue, eloKMultiplier}` (migration `20260528000002`), frozen once `appliedResult` is non-null. `LeagueService.upsertFixture` stamps `neutralVenue=true, eloKMultiplier=3.0` when `sourceLeagueId='WC'`. INT seeder ([seeders/20260528000003](seeders/20260528000003-seed-teams-from-intl-elo-history.js)) calls `lib/ml/eloMath.js` directly (structurally eliminating one parity-drift path). Python: new `ingest/international.py` (date-windowed historical-name rewriting via `former_names.csv`; `derive_k_multiplier`); `train --source international` (date split, `promoted='initial'`, permissive reconcile, `sample_weight=k_mult`). The conditional `xgb.DMatrix` kwarg construction (omit `weight` when `None`, don't pass `weight=None`) preserves PL byte-identity.

**Prod-rollout gotchas (now operator runbook):** (a) 104 pre-shipped WC fixtures lacked the neutral/K-mult stamps (synced before the code) → `fixup-wc-state.mjs` backfills; (b) a TBD team row existed at 1500 from `ensureTeamExists` → deleted (cascade then skips TBD-vs-TBD via the null-elo guard, honouring "no probabilities on TBD"); (c) 48 nations were stuck at 1500/gamesPlayed=0 because `ON CONFLICT DO NOTHING` preserved the auto-inserted rows over the seeder's values → `fixup-wc-state.mjs` re-walks history and UPDATEs `WHERE gamesPlayed=0`. Four football-data ↔ martj42 name diffs (Czechia↔Czech Republic, Bosnia-Herzegovina↔Bosnia and Herzegovina, Cape Verde Islands↔Cape Verde, Congo DR↔DR Congo) bridged by `HISTORY_SYNONYMS`. Final prod state: 104 WC games stamped, 337 teams, 72/104 fixtures with probabilities (32 TBD knockouts at sentinel), top Elo Spain 2091 / Argentina 2039 / France 2018.

**Operator activation:** push to main → CD migrates + rolls → `az containerapp exec --command "node scripts/run-int-seed.mjs"` (populates 333 nations) → `inspect-wc-state.mjs` → `fixup-wc-state.mjs [--rewrite-probs]` → `list-wc-team-elo.mjs`. All intl scripts emit **ASCII-only** stdout (subprocess-isolating pino/npx/sequelize-cli) to survive the Azure CLI cp1252 crash (`az containerapp exec`'s `_ssh_utils.py` hardcodes cp1252; a non-cp1252 byte crashes the reader thread and kills the container's async work).

### 9.6 Retraining & extending

Retrain PL: `cd ml && python -m scorecast_ml train --league PL` → `cp` JSON → commit → CD (model cache picks it up on next cascade). Add a league: commit CSVs, extend `reconcile/teams.json` + `seeders/reconcileMap.json`, add to `MODEL_PATHS`, extend the seeder, train. Add an international competition (Euros): activate the `EC` league row OR (recommended) map EC fixtures to the WC meta-pool at sync time, extend the K-mult stamp branch in `upsertFixture`, ensure teams exist, flip `active=true`, run `fixup-wc-state.mjs --rewrite-probs`. **ML invariants:** Python↔JS Elo parity; atomic Elo-with-result; `rePredictFutureFixtures` post-commit; immutable snapshot; clip-before-round; `parseBaseScore`→0; seeder `ON CONFLICT DO NOTHING`; auto-insert at `MIN(elo)`; symmetrize only when `neutralVenue`; K-mult frozen after `appliedResult`; the 3-file K-mult table.

### 9.7 Worked example — capturing (and correcting) the WC final

This makes the snapshot/reversal invariant concrete. Suppose France (home) beats Argentina (away) 2–1 in the 2026 WC final; the game carries `neutralVenue=true, eloKMultiplier=3.00`.

**Pre-state** (`teams` under WC): France `elo=2018.46, gamesPlayed=933`; Argentina `elo=2039.01, gamesPlayed=1064`.

**Admin sets `{result:'home'}`** → `GameService.setResult` opens a transaction, `game.save`, calls `onResultUpdated`:

1. Idempotency: `previous = appliedResult = null`, `next = 'home'` → proceed.
2. Lock both team rows (`FOR UPDATE`); read `eloOpts = {kMultiplier: 3, neutral: true}`.
3. First capture → snapshot the _live_ Elo: `homeEloPre = 2018.46, awayEloPre = 2039.01`.
4. `eloDelta(2018.46, 2039.01, 'home', {kMultiplier:3, neutral:true})`: `expectedHome = 1/(1+10^((2039.01−2018.46)/400)) ≈ 0.4705`; `k = 20×3 = 60`; `home_delta = 60×(1−0.4705) = +31.77`, `away_delta = −31.77`.
5. Apply: France → `2050.23`, Argentina → `2007.24`. `gamesPlayed += 1` each; stamp `appliedResult = 'home'`.
6. COMMIT. Post-commit: `rePredictFutureFixtures` re-predicts scheduled WC fixtures involving France/Argentina (neutral → symmetrized); per-pick `notify('pick-scored')` + badges + streak + `UserScoreService` transition; leaderboard invalidate.

**Operator notices it was actually Argentina who won — re-sets `{result:'away'}`:**

1. `previous = 'home', next = 'away'` → reversal path.
2. Reverse against the **snapshot** (not live Elo): `eloDelta(2018.46, 2039.01, 'home', opts) = {+31.77, −31.77}` → France `2050.23 − 31.77 = 2018.46`, Argentina `2007.24 + 31.77 = 2039.01` — **both back to pre-snapshot exactly**.
3. Apply the new delta against the **same** snapshot: `eloDelta(2018.46, 2039.01, 'away', opts) = {−28.23, +28.23}` (different magnitude because Argentina was the slight favourite) → France `1990.23`, Argentina `2067.24`.
4. `appliedResult = 'away'`; the snapshot stays frozen at `2018.46, 2039.01`, so any further correction reverses against it — round-trips are bit-exact. This is why the snapshot must never be re-taken from live Elo (the PR C bug PR F fixed).

### 9.8 ML failure-mode debugging

| Symptom                                                  | Likely cause                                                                                                                      | Fix                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| All WC fixtures stuck at `0.50/0.00/0.50` after deploy   | `INT_elo.json` missing from the image OR `MODEL_PATHS.WC` unset                                                                   | `az ... exec -- ls lib/ml/models/`; check `MODEL_PATHS`; cascade logs `no model file for league`             |
| One team stuck at 1500, others fine                      | row auto-inserted by `ensureTeamExists` before the seeder ran; `ON CONFLICT DO NOTHING` preserved it                              | `node scripts/fixup-wc-state.mjs` (UPDATEs `WHERE gamesPlayed=0`); extend `HISTORY_SYNONYMS` if names differ |
| All Elo reset to 1500 after redeploy                     | someone changed the seeder to `ON CONFLICT DO UPDATE`                                                                             | revert — DO NOTHING is load-bearing; use `fixup-wc-state.mjs` for targeted updates                           |
| Probabilities not symmetric on a neutral fixture         | `neutralVenue` not stamped (pre-shipped) OR `upsertFixture` branch missing the competition code                                   | check `SELECT "neutralVenue","eloKMultiplier"`; run `fixup-wc-state.mjs`; extend the stamp branch            |
| Result captured but downstream fixtures not re-predicted | fixtures are `in-progress` not `scheduled`; OR `pickProbabilitiesLockedAt` set; OR opponent row missing; OR league `active=false` | inspect the `rePredictFutureFixtures` WHERE clause vs the fixture columns; cascade logs `skipped: N`         |
| `[NaN,NaN,NaN]` probabilities                            | XGBoost 2.x hex `base_score` reaching `Number()`                                                                                  | `parseBaseScore` must default to 0 (already does); never `Number()` it directly                              |
| `az exec` crashes with cp1252 unicode error              | a script emits unicode (npx spinner, pino, country names)                                                                         | use an existing ASCII-only script; subprocess-isolate unicode work per `run-int-seed.mjs`                    |
| PL probabilities silently shift after an INT change      | default-opts drift in `eloDelta` or the trainer                                                                                   | retrain PL + verify predictions are bit-identical across a test grid in the JS runtime                       |

---

## 10. End-to-End Data Flows

### 10.1 Login → Dashboard load

```
POST /api/login {username,password}
  loginLimiter → validate → getUserByUsername → check lockedUntil
  → bcrypt.compare(pw, hash OR LOGIN_DUMMY_HASH)   # constant-time
  → reset loginAttempts → setAuthCookies (INSERT refresh_tokens) → {user}   # no token in body
Client: setUser → loadDashboard() parallel-fetches /me /games /groups /picks /leaderboard /friends
        /groups/discover /picks/friends → setLoading(false) → render
NotificationBell mounts → 30s poll (5min when a SW controls the page)
consumeDeepLinks(games, groups) runs once before bootDone flips
```

### 10.2 Pick → result → points + Elo + re-prediction

```
POST /api/picks {gameId, choice}
  validate → reject if game.date<=now or result!=null → upsert Pick (idempotent retry) →
  write pick-time snapshot → UserScoreService.applyPickTransition (no-op, unscored) →
  invalidateCrowd → evaluateBadges → refreshGames/Picks/Leaderboard
... later ...
POST /api/games/:id/result {result}   (admin)   — see §9.3 transaction + post-commit fan-out
Client: NotificationBell poll surfaces "✓ Correct +N pts" within ~30s
```

### 10.3 Friend request → accept → head-to-head

```
POST /friends/request {username} → guards → Friendship.create(pending) → notify('friend-request')
addressee POST /friends/:id/accept → status='accepted', acceptedAt=NOW → notify back
re-open profile → friendStatus 'friends' → headToHead computed over shared completed games
```

### 10.4 Admin deletes a user (transactional)

```
DELETE /api/admin/users/:id → self-guard (400) → BEGIN TX
  UserService.cascadeDelete(target, {transaction:t}):
    owned groups → delete their members/invites/groups
    delete target's picks · comments · comment_reactions · friendships · group_members ·
           group_invites (by username) · email/password/refresh tokens · push_subscriptions ·
           notifications · badges · user_scores(_overall) · then the user row
COMMIT  (mid-cascade exception → ROLLBACK; parent+children intact)
audit_log row written via res.on('finish')
```

Bulk-delete: one transaction per id (bad row aborts the batch; committed rows orphan-free; self-id filtered to `skipped[]`).

### 10.5 Live-score tick → pick resolution

```
30s tick → advisory lock → cost-gate (Game.count) → LIVE poll
  → per match: applyLiveUpdate (FOR UPDATE, flip-back guard, in-tx Elo + pick-lock, post-commit fan-out)
  → reconcile pass (?ids= for in-progress missing from LIVE, or scheduled kickoff>15min ago)
3min tick → advisory lock → reconcileInProgressGames (?ids= sweep, defensive)
Client picks up on next refreshGames / tab switch; notifications via the 30s bell poll. No WebSocket/SSE.
```

---

## 11. Cross-Cutting Concerns

### 11.1 Error handling

**Server:** handlers throw `AppError` (factories in `lib/errors.js`); `errorMiddleware` maps to `{error, [issues]}`; zod → 400 with issues; unexpected → 500 + `req.log.error({err})` (no stack leak; the response's `X-Request-Id` traces back to the exact handler). Sentry error middleware (after all routes) captures `next(err)`-propagated errors (no-op without DSN). **Frontend:** the three-path strategy of §6.6. What users see: render error → full-page fallback card (raw text only in DEV); window/async → 3.5 s "Something went wrong" toast; API error → contextual toast with the server's `error` message.

### 11.2 Security posture (summary)

| Concern                 | Status                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Password storage        | bcrypt cost 10 (model hooks)                                                                                        |
| Auth secret             | `JWT_SECRET` required in prod; dev fallback never reaches prod                                                      |
| Session transport       | HttpOnly cookie (15-min access JWT + 30-day rotating refresh, SHA-256 in DB). No bearer. XSS can't lift the session |
| Token storage           | SHA-256 of high-entropy tokens; bcrypt only for recovery codes                                                      |
| Brute force             | per-route limits + per-user lockout + generic 401; `trust proxy:1` for real IPs                                     |
| Login timing            | constant-time (`LOGIN_DUMMY_HASH`); forgot-password token+email in `setImmediate`                                   |
| JWT verify              | HS256 pinned on every call site                                                                                     |
| Identity-change re-auth | `currentPassword` required on `/me/email` + `/me/password`                                                          |
| Input validation        | zod on every body; 32 KB limit; reject bidi/zero-width/control codepoints (ZWJ allowed); profanity on 6 surfaces    |
| SQL injection           | Sequelize parameterizes; raw migration SQL has no user input                                                        |
| RBAC + self-protection  | `requireAdmin`; admin can't demote/delete self (server-side)                                                        |
| XSS                     | React escaping; no `dangerouslySetInnerHTML`; CSP `default-src 'self'`                                              |
| CSRF                    | double-submit cookie + `timingSafeEqual`                                                                            |
| CORS                    | env allowlist; throws on boot in prod; localhost fallback dev                                                       |
| Headers                 | helmet CSP + HSTS preload (2 yr) + DENY + extended Permissions-Policy                                               |
| Password reset          | email-based, 15-min single-use, always-204, revokes all refresh tokens                                              |
| Email verification      | required at register; forgot-password only to verified                                                              |
| Web Push                | endpoint allowlist (FCM/Apple/Mozilla) + HTTPS-only + private/loopback-IP SSRF block                                |
| Audit log               | every `/api/admin/*` mutation; 4 KB truncation; `actorUserId` SET NULL                                              |
| Telemetry PII           | Sentry `sendDefaultPii:false` + redacting `beforeSend`                                                              |
| Dependency hygiene      | CI `npm audit --audit-level=high --omit=dev`; Dependabot weekly; `overrides.uuid ^11.1.1`                           |
| 2FA                     | **parked** (revival = `git revert`)                                                                                 |

Accepted risks (documented): Postgres firewall `AllowAllAzureServices` (cost-gated; VNet at Tier 10.4); no CAPTCHA on register (`registerLimiter` + Resend quotas); no file-upload surface. Operational defense-in-depth parked: Cloudflare WAF + Bot Fight Mode + edge rate limits, Sentry alerts, restore drill, secrets-rotation drill, `security@bantryx.com` / `.well-known/security.txt`, audit-log weekly digest, HSTS preload submission after 30 days.

### 11.3 Performance

Materialized leaderboard (sub-ms B-tree read) behind a 30-s cache buffer; static assets cached immutably (Vite hash-versioned), SPA shell `no-cache`; N+1 elimination (batched `findAll IN` hydration — `getGroupsForUser`, `listJoinRequests`); gzip (~75% on the JS bundle); bounded fan-outs (8-worker comment pool); ML cascade ~0.5 ms per result; lazy-loaded recharts/admin/profile chunks; pool max 20; the profile endpoint narrows `Game.findAll` to pick gameIds (was a full-table OOM risk).

### 11.4 Accessibility

Token-driven `focus-visible:ring-2 ring-accent`; labelled inputs; sidebar items `<button role="tab">` with accessible name `<kicker> <label>` (Playwright-stable + screen-reader-friendly regardless of collapse); `role="status" aria-live="polite"` toast; `role="alert"` inline form errors; `aria-busy` during boot; Radix dialogs (focus trap / Esc / return-focus / `aria-modal`); skip-to-content link; `<nav aria-label="Primary navigation">`; `<main id="main">` landmarks; `useReducedMotion()` + `useFocusOnRouteChange()`; iOS Safari 16-px form-input minimum at `<768px` (no zoom-on-focus). Public [ACCESSIBILITY.md](ACCESSIBILITY.md). Gaps: no axe-core in CI, no formal contrast audit, skeletons don't announce.

### 11.5 Observability

pino structured logs (JSON prod, pretty dev, `LOG_LEVEL`) + request-id correlation (`req.id` echoed as `X-Request-Id`, on every `req.log` line) + one `pino-http` access line per request (level mapped from status). Client-error pipeline → server log + Sentry. Sentry opt-in: server `@sentry/node` via `lib/instrument.js` (first require, OpenTelemetry); browser `@sentry/react` dynamic-import (tree-shaken when `VITE_SENTRY_DSN` unset — verified zero bytes). Logs ship to Log Analytics via Container Apps stdout. **Still missing:** no `/metrics` endpoint; App Insights resource exists but its SDK isn't wired into app code.

### 11.6 Testing

**~270 Playwright tests across 22 specs** (~5 min full run): UI/flow specs (`pick-and-result`, `group-lifecycle`, `comment-reaction`, `auth-security`, `friend-system`, `notifications-badges`, `leaderboard-scoring`, `admin-panel`, `profile-privacy`, `change-email/password-panel`, the Tier 30 view specs, `screenshots/mobile`) + the per-endpoint **API boundary suite** under `tests/e2e/api/` (one file per route file, ~250 tests: happy path + 401 + admin-403 + CSRF-403 + 400 + 404 + ownership for every endpoint). Runs against `npm run build && node server.js` on `:3100` with `NODE_ENV=test`, **`workers:1`** (shared Sequelize pool — **specs must NOT call `closeDb()` in `afterAll`**). `globalSetup` syncs + migrates + truncates + reseeds 3 deterministic users (`e2e_admin`/`e2e_alice`/`e2e_bob`, pre-accepted terms + pre-completed onboarding) + 3 games. Rate limiters skipped in test. Each spec resets only the state it touches via DB helpers (`tests/e2e/helpers/api.js`); `apiAssertions.js` collapses boundary boilerplate. **Unit tests** (`node --test tests/*.test.js`): `eloMath` (16), `normalize` (10), `xgboostInference` (13), `streakService` (35), `statsService` (29), `userScore` (18), plus intl/predictionService parity. **Python:** `pytest ml/tests/` (Elo determinism, ingest, training, intl parity). CI runs the full Playwright suite + migrations-smoke on every PR.

---

## 12. Cloud, CI/CD & Operations

### 12.1 Environment variables ([.env.example](.env.example))

| Var                                                                                                                                                          | Required | Notes                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                                                                                                                                                 | **prod** | Server refuses to boot in prod without it. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CORS_ORIGINS`                                                                                                                                               | **prod** | Comma-separated allowlist; throws on boot in prod if empty; localhost-only fallback in dev                                      |
| `DATABASE_URL`                                                                                                                                               | —        | Postgres conn string; append `?sslmode=require` for Azure (opts into TLS)                                                       |
| `PORT`                                                                                                                                                       | —        | default 3000                                                                                                                    |
| `NODE_ENV`                                                                                                                                                   | —        | gates JWT/CORS enforcement, logger format, cookie Secure, migrate behaviour, dev-only docs                                      |
| `LOG_LEVEL`                                                                                                                                                  | —        | pino level (default debug dev / info prod)                                                                                      |
| `MIGRATE_ON_BOOT`                                                                                                                                            | —        | `'true'` to auto-migrate on prod boot (default off — CD runs the migrate Job)                                                   |
| `SENTRY_DSN`                                                                                                                                                 | —        | server Sentry (read at process start)                                                                                           |
| `VITE_SENTRY_DSN`                                                                                                                                            | —        | browser Sentry (**build-time** — rebuild after change)                                                                          |
| `RESEND_API_KEY` / `EMAIL_FROM` / `PUBLIC_APP_URL`                                                                                                           | —        | outbound email (log-only without key); From header; verify/reset link base                                                      |
| `FOOTBALL_DATA_API_KEY` / `FOOTBALL_DATA_API_HOST` / `FOOTBALL_DATA_RATE_LIMIT`                                                                              | —        | upstream key (crons no-op without it); host override; rate budget (default 20)                                                  |
| `FIXTURE_SYNC_CRON` / `LIVE_SCORE_SYNC_CRON` / `IN_PROGRESS_RECONCILE_CRON` / `KICKOFF_REMINDER_CRON` / `LOCK_PICK_PROBABILITIES_CRON` / `WEEKLY_RECAP_CRON` | —        | cron overrides (node-cron 6-field for sub-minute)                                                                               |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`                                                                                                   | —        | Web Push (no-op without all three; `GET /push/vapid-public-key` 503s)                                                           |
| `MAX_GROUP_MEMBERS`                                                                                                                                          | —        | default 2000, clamped [10,5000]                                                                                                 |
| `TIER24_LEGACY_LEADERBOARD` / `PARITY_LOG_ENABLED`                                                                                                           | —        | leaderboard rollback / parity logging                                                                                           |

### 12.2 Local setup

**Prerequisites:** Node 20+, a local PostgreSQL 16+ (running, on `PATH`, with a `postgres` superuser — Windows install walkthrough in `DATABASE_SETUP.md`), and optionally Docker Desktop (for the `docker-compose` stack) + the Azure CLI & GitHub CLI (for cloud work, §12.14).

```bash
createdb scorecast_db
cp .env.example .env        # set JWT_SECRET (any random string in dev); CORS dev-fallback is localhost-only
npm install
node server.js              # terminal 1 — backend :3000 (in dev: authenticate → sync → migrate → seed)
npm run dev                 # terminal 2 — Vite :5173 (proxies /api → :3000)
# open http://localhost:5173
```

**What a fresh boot gives you.** On an empty DB, dev boot auto-migrates and then `seedDatabase()` (§7.2) loads the `data.json` demo set: **3 users — `vo123/password123` (admin), `alice/secret`, `bob/secret` — 3 games (Barcelona-vs-Real Madrid already finished; Liverpool + Arsenal upcoming to pick on), 2 groups, and 3 picks.** Log in as `vo123` to get the Admin tab. (The seed runs only while `users` is empty; it's idempotent-by-absence, not re-run on later boots.)

**Adding more data locally.** To get live fixtures with real probabilities you need a football-data.org key — register a free account at https://www.football-data.org/client/register, put it in `.env` as `FOOTBALL_DATA_API_KEY` (the crons silently no-op without it), then in the Admin → Leagues tab activate a league and click **Sync now**; the daily/live crons then keep it fresh. Without a key, create fixtures by hand in Admin → Games (a league row must exist — PL/WC are seeded by the `create-leagues` migration; the synthetic "Legacy / Imported" league also exists). New fixtures start at the `(0.50, 0.00, 0.50)` sentinel until the ML cascade or a manual probability edit runs.

**E2E database.** `npm run test:e2e` needs a separate `scorecast_test` DB (the helpers derive its URL from `.env`'s `DATABASE_URL` by swapping the path): `createdb scorecast_test`. Run a single spec with `npx playwright test tests/e2e/<file>.spec.js`, or the interactive UI with `npm run test:e2e:ui`.

### 12.3 Production build

```bash
npm run db:migrate   # apply pending migrations (idempotent)
npm run build        # → dist/
node server.js       # serves dist/ + /api (does NOT auto-migrate in prod)
# or one-shot: npm start (= vite build && node server.js)
```

### 12.4 Azure resource topology (`eastus2`, https://bantryx.com)

| Resource           | Name                           | Role                                                                                                                          | ~Cost/mo |
| ------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| Resource Group     | `scorecast-prod`               | container                                                                                                                     | —        |
| Container Apps env | `scorecast-env-p3aaelev7xp52`  | Consumption; hosts app + migrate Job                                                                                          | $0 idle  |
| Container App      | `scorecast-app`                | Node server; ingress :3000→:443; **minReplicas 1 / maxReplicas 10**                                                           | ~$8–40   |
| Container Apps Job | `scorecast-migrate`            | one-shot `npm run db:migrate` before each roll-out                                                                            | $0 idle  |
| Container Registry | `scorecastacrp3aaelev7xp52`    | `scorecast:<sha>` + `:latest` (Basic, admin disabled, AcrPull via MI)                                                         | ~$5      |
| Postgres Flexible  | `scorecast-pg-p3aaelev7xp52`   | B1ms (1 vCPU / 2 GB), PG16, 32 GB, 7-day backups, public+firewall                                                             | ~$17     |
| Key Vault          | `scorecast-kv-p3aaelev7xp`     | RBAC; `jwt-secret`, `database-url`, `postgres-admin-password`, `resend-api-key`, `football-data-api-key`, `vapid-private-key` | ~$0.10   |
| Log Analytics      | `scorecast-logs-p3aaelev7xp52` | Container Apps stdout sink (1 GB/day cap)                                                                                     | ~$2      |
| App Insights       | `scorecast-appi-p3aaelev7xp52` | APM resource (env present; SDK not wired in app yet)                                                                          | ~$2      |
| Azure AD app       | `scorecast-github-cd`          | GitHub OIDC federation (no client secret)                                                                                     | —        |
| DNS                | Cloudflare `bantryx.com`       | apex CNAME → ACA FQDN (grey-cloud), www proxied for redirect                                                                  | $13/yr   |

Idle total ~$40–60/mo post-Tier-25. **There is no ML Container Apps Job and no `scorecast-ml` ACR repo** (deleted in Tier 17 — inference is in-process). Names use `uniqueString(resourceGroup().id)` so redeploys are idempotent + globally unique.

### 12.5 Bicep IaC ([infra/](infra/))

`main.bicep` orchestrates 7 modules (params: `location`, `appName`, `imageTag`, `pgAdminPassword` `@secure`, `customDomain`, `customDomainCertId`, `vapidPublicKey`, `vapidSubject`, `useAzureDns`):

| Module        | Provisions                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `logs`        | Log Analytics + App Insights                                                                                                                                                                                                                                                                                                                                       |
| `registry`    | ACR Basic (admin disabled, anonymous pull disabled)                                                                                                                                                                                                                                                                                                                |
| `secrets`     | Key Vault, RBAC mode, soft-delete 7d                                                                                                                                                                                                                                                                                                                               |
| `db`          | Postgres Flex B1ms; writes `database-url` (`?sslmode=require`) + `postgres-admin-password` into KV; Azure-services firewall rule. **`geoRedundantBackup` is creation-time-only** — silently no-ops on update; folded into the future C3 GP SKU bump (which recreates the server)                                                                                   |
| `app`         | Container Apps env + main app; system-assigned MI + AcrPull (registry) + Key Vault Secrets User; secret refs via `keyVaultUrl` + `identity:'system'`; **liveness probe `/healthz`, readiness probe `/readyz`**; `customDomains:[{name, bindingType:'SniEnabled', certificateId}]` when `customDomain` set; `CORS_ORIGINS`/`PUBLIC_APP_URL` pivot on `customDomain` |
| `migrate-job` | Container Apps Job `command:['npm','run','db:migrate']`; same MI/RBAC pattern                                                                                                                                                                                                                                                                                      |
| `dns`         | conditional Azure DNS zone — gated `useAzureDns=false` (Cloudflare handles DNS)                                                                                                                                                                                                                                                                                    |

**There is no `ml-job.bicep`** (deleted Tier 17). **Bicep reapply requires 5 params** (post-Tier-17): `imageTag` (live SHA — skipping it flips the App to the helloworld bootstrap), `pgAdminPassword` (live pw), `customDomain=bantryx.com`, `customDomainCertId` (discover via `az containerapp env certificate list ... --query "[?properties.subjectName=='bantryx.com'].id"`), `vapidPublicKey` (live key). **Day-to-day CD never runs Bicep** — only `az containerapp update --image`. **Registries/secrets/env blocks are always populated** (no `imageTag=='placeholder' ? [] : [...]` ternaries — reintroducing them breaks CD's registry auth + the new revision's env). Empirically validated full reapply: ~2 min, `provisioningState: Succeeded`, no net resource changes.

**Secret resolution:** each Container App/Job has a system-assigned MI with **Key Vault Secrets User**; the `secrets:` block references KV via `keyVaultUrl` + `identity:'system'`; Container Apps resolves them into env vars (e.g. `JWT_SECRET`, `DATABASE_URL`) at container start; the app reads plain `process.env` (no KV SDK in app code). Bootstrap secrets (`jwt-secret`, `resend-api-key`, `football-data-api-key`, `vapid-private-key`) are seeded by hand (`az keyvault secret set`) **before** the first Bicep apply that needs them.

### 12.6 CI pipeline ([.github/workflows/ci.yml](.github/workflows/ci.yml))

Runs on PRs to `main` (and pushes to non-main branches). `permissions: contents: read`. Three jobs:

1. **lint-and-build** — `npm ci` (HUSKY=0) → `npm run lint` → `npm run format:check` → `npm audit --audit-level=high --omit=dev` → `npm run build`.
2. **migrations-smoke** — Postgres 16 service (`scorecast_test`, `NODE_ENV=test`). **`sync({alter:false})` first** (mirrors boot order, because every migration is an ALTER assuming the table exists) → `db:migrate` → `db:migrate:undo:all` → `db:migrate` (idempotency check) → `db:migrate:status`.
3. **e2e** — Postgres service, cached Chromium (`actions/cache` keyed on `package-lock.json`), `npm run test:e2e`; uploads the Playwright HTML report + traces on failure (7-day retention).

[.github/dependabot.yml](.github/dependabot.yml) opens weekly grouped PRs (npm prod/dev + pip `ml/` + github-actions + docker).

### 12.7 CD pipeline ([.github/workflows/deploy.yml](.github/workflows/deploy.yml))

Triggers on push to `main` (or `workflow_dispatch`). `permissions: contents: read, id-token: write` (OIDC). Env: `AZURE_RESOURCE_GROUP=scorecast-prod`, `AZURE_CONTAINER_APP=scorecast-app`, `AZURE_MIGRATE_JOB=scorecast-migrate`, `ACR_NAME=scorecastacrp3aaelev7xp52`, `IMAGE_REPO=scorecast`, `HEALTH_URL=https://bantryx.com/healthz`. Three sequential jobs:

1. **build-and-push** — `actions/setup-node@v4` (Node 20, npm cache) → `npm ci` (HUSKY=0) → `npm run lint` (defense in depth) → `npm run build` → compute tag `${GITHUB_SHA::7}` → `azure/login@v2` (OIDC) → `az acr login` → `docker build -t <repo>:<tag> -t <repo>:latest .` → push both.
2. **migrate** — `azure/login@v2` → `az containerapp job update --image <new>` → `az containerapp job start` → poll `az containerapp job execution show` up to 60×10 s; `Succeeded` → exit 0, `Failed`/`Degraded`/timeout → exit 1. **No traffic shift if migrations didn't apply.**
3. **deploy** — `azure/login@v2` → `az containerapp update --image <new>` → poll the latest revision's `runningState` up to 30×10 s; `Running` → exit 0; `Failed`/`Degraded`/`ActivationFailed` → exit 1 (terminal — surfaces a `require()`-throw in <1 min instead of timing out) → smoke `curl /healthz` up to 12×10 s until 200.

Typical run ~5–8 min. Failures keep the old revision live; **rollback is "revert + push."** Auth: a federated credential on `scorecast-github-cd` trusts `repo:vindevoudit/scorecast:ref:refs/heads/main`; the SP has `Contributor` on the RG + `AcrPush` on the ACR; repo secrets `AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/`AZURE_SUBSCRIPTION_ID` (no client secret). Image tags: every push builds `<sha7>` AND `latest`; the migrate Job updates to the new image **before** the app rolls.

**Known CD failure mode — AcrPull MI rotation:** the migrate-job's SystemAssigned MI `principalId` can rotate (job re-create, identity toggle, major API-version migration), orphaning the `AcrPull` role assignment (bound to the old principalId via `guid(...)` naming). CD then fails with `InvalidParameterValueInContainerTemplate ... unable to pull image using Managed identity system for registry`. **Fix without Bicep reapply:** `az role assignment create --assignee <current principalId from 'az containerapp job show ... --query identity.principalId'> --role AcrPull --scope <acr id>`, wait ~60 s for RBAC propagation, re-run `gh workflow run deploy.yml`. Same pattern applies to the main app's MI.

### 12.8 Custom domain + TLS

`bantryx.com` on Cloudflare Registrar + DNS:

| Record                  | Value                                                                          | Proxy                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `bantryx.com` CNAME     | Container Apps FQDN                                                            | **DNS only (grey-cloud)** — orange-cloud would terminate TLS at Cloudflare and break Azure's HTTP-01 cert validation |
| `asuid.bantryx.com` TXT | ACA env `customDomainVerificationId`                                           | DNS only                                                                                                             |
| `www.bantryx.com` CNAME | `bantryx.com`                                                                  | proxied (orange-cloud) for the redirect rule                                                                         |
| Redirect rule           | `https://www.bantryx.com/*` → `https://bantryx.com/${1}` (301, preserve query) | —                                                                                                                    |

Container Apps issues + binds a free Azure managed cert via HTTP-01 ACME (the platform serves `/.well-known/acme-challenge/*`); auto-renews ~every 6 months.

### 12.9 Docker

Multi-stage `Dockerfile`: build stage (`npm ci` + `npm run build`), runtime stage `node:20-alpine` with `npm ci --omit=dev`, **non-root uid 1001**, `tini` entrypoint (forwards SIGTERM correctly), `HEALTHCHECK /healthz`. The runtime stage must `COPY .sequelizerc` (else sequelize-cli looks for `config/config.json` and fails) **+ `scripts/` + `international_match_archive/`** (so operator scripts + the INT seeder are reachable via `az containerapp exec`). `docker-compose.yml` runs app + Postgres 16 + Redis 7 locally — note the container uses `NODE_ENV=production` so login cookies are `Secure` and won't transmit over `http://localhost` (use the two-terminal flow for hot-reload dev).

### 12.10 Capacity ladder & cost (Tier 25 — [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md))

**Shipped:** A1 pool max 20; A2 static cache headers (`/assets/<hashed>` immutable 1 yr, rest no-cache); A4 `trust proxy:1`; A5 `maxReplicas 10` ($0 idle, +$15–40/mo at peak); B1 `minReplicas 1` (kills 3–5 s cold start, ~$8–12/mo; verified first `/healthz` after idle = 251 ms vs 3–5 s). **Parked/trigger-driven (Phase 3):** A7 App Insights alerts (operator TODO — 3 portal rules: 5xx>1%, `/readyz` failures, replica-cap-pinned); A6 `LOG_LEVEL=warn` (if Log Analytics >800 MB/day); C1 managed Redis Basic C0 (multi-replica rate-limit or SSE, +$16/mo); C2 Postgres B2s (CPU>70%, +$15); C3 GP D2ds_v5 (~2000 DAU, +$112, absorbs geo backup); C5 SSE realtime ($0, uses C1); A3/B5 Cloudflare orange-cloud + WAF (bot/DDoS signal — needs a `trust proxy` audit).

**Total monthly Azure spend per launch stage** (totals, not deltas):

| Stage                              | Levers in place                       | Total Azure  |
| ---------------------------------- | ------------------------------------- | ------------ |
| Pre-Tier-25 baseline               | A4 only                               | ~$30–50/mo   |
| **Post-Tier-25 Phase 1+2 (today)** | + A1 + A2 + A5 + B1 + probe alignment | ~$40–60/mo   |
| First real traffic surge           | A5 spins up during peaks              | ~$55–100/mo  |
| Multi-replica sustained            | + C1 (Redis)                          | ~$75–120/mo  |
| DB constrained                     | + C2 (Postgres B2s)                   | ~$90–135/mo  |
| Sustained growth                   | + C3 (GP Postgres + B2 absorbed)      | ~$200–250/mo |

A6 / C5 are $0 marginal; A7 (App Insights alerts) is $0 (alerts are free; ingestion is metered + bounded by A6). The theoretical worst case for A5 (all 10 replicas pinned 24/7, ~500 RPS) is ~$385/mo — but Consumption bills per-replica-active-time, so headroom is free at idle.

### 12.11 Operator scripts ([scripts/](scripts/))

Run via `az containerapp exec --name scorecast-app --resource-group scorecast-prod --command "node scripts/<x>.mjs"`. **All ASCII-safe** (the Azure CLI cp1252 crash). Most support `--dry-run`.

| Script                                                                                             | Purpose                                                 | When                                 |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| `backfill-user-scores`                                                                             | populate materialized tables + pick sentinels           | **once after the Tier 24 migration** |
| `exercise-user-scores`                                                                             | deterministic dual-writer exercise (0 drift check)      | verification                         |
| `recompute-streaks`                                                                                | recompute streaks from history                          | **once after the streak migration**  |
| `query-teams` / `find-game` / `repair-test-game-elo` / `backfill-probabilities`                    | ML state query / lookup / repair / forced re-prediction | ad-hoc + post-retrain                |
| `run-int-seed` / `inspect-wc-state` / `fixup-wc-state` / `list-wc-team-elo` / `activate-wc-league` | intl-model seed / inspect / fixup / list / activate     | WC rollout                           |
| `grant-beta-badge` / `notify-beta-badge`                                                           | beta→launch reset                                       | one-off                              |
| `generate-pwa-assets` / `generate-marketing-assets`                                                | regenerate icons/OG from SVG                            | build-time                           |

**Exact recipes:**

```bash
# Tier 24 backfill — REQUIRED once after the user_scores migration deploys
az containerapp exec --name scorecast-app --resource-group scorecast-prod \
  --command "node scripts/backfill-user-scores.mjs"

# Streak backfill — REQUIRED once after the streak-rework migration deploys
az containerapp exec --name scorecast-app --resource-group scorecast-prod \
  --command "node scripts/recompute-streaks.mjs"

# Retrain the PL model (local Python), then ship it:
cd ml
python -m venv .venv && .venv/Scripts/Activate.ps1          # or .venv/bin/activate
pip install -r requirements.txt
python -m scorecast_ml train --league PL                    # → ml/data/models/PL_elo_<date>.json
cp data/models/PL_elo_<date>.json ../lib/ml/models/PL_elo.json
git add ../lib/ml/models/PL_elo.json
git commit -m "ml: retrain PL elo-only model (val mlogloss X.XXX)"
git push                                                    # CD deploys ~5–8 min; cache picks it up next cascade

# Retrain the INT (World Cup) model:
cd ml
PYTHONIOENCODING=utf-8 python -m scorecast_ml train --league INT --source international \
  --val-start-date 2024-01-01 --train-through-date 2023-12-31
cp data/models/INT_elo_<date>.json ../lib/ml/models/INT_elo.json
git add ../lib/ml/models/INT_elo.json && git commit -m "chore(intl-model): retrain INT booster" && git push

# Force-refresh upcoming-fixture probabilities (CLI version of rePredictFutureFixtures):
node scripts/backfill-probabilities.mjs --dry-run            # eyeball first
node scripts/backfill-probabilities.mjs                      # for real

# Bootstrap the teams tables on a fresh prod DB (NOT auto-run by CD):
npm run db:seed -- --seed 20260522000001-seed-teams-from-elo-history.js        # PL
az containerapp exec --command "node scripts/run-int-seed.mjs"                  # INT (WC)

# WC rollout / fix-up sequence:
az containerapp exec --command "node scripts/inspect-wc-state.mjs"
az containerapp exec --command "node scripts/fixup-wc-state.mjs --rewrite-probs"
az containerapp exec --command "node scripts/list-wc-team-elo.mjs"

# Repair a corrupted game's Elo state (rare):
node scripts/find-game.mjs "Home FC" "Away FC"
node scripts/repair-test-game-elo.mjs <gameId> "Home FC" "Away FC"
npx sequelize-cli db:seed --seed 20260522000001-seed-teams-from-elo-history.js

# Bootstrap a Sentry test event (Sentry filters direct console throws):
#   in the browser console: setTimeout(() => { throw new Error('sentry-test'); }, 0)
```

**Open obligation (July 2026):** when 2026/27 PL fixtures publish (~mid/late June), reactivate PL (`active=true` in League Manager), resync the new season, and retrain the PL model (above). Elo carries across seasons so a full `teams` rebuild is optional; for a clean rebuild, delete the PL `teams` rows + re-run the PL seeder.

### 12.12 Backup / restore

Standard `pg_dump` / `pg_restore`. Azure provides 7-day automated Postgres backups (geo-redundant deferred to the C3 SKU bump). No app-specific export; `data.json` seed re-runs only on an empty `users` table.

### 12.13 Operations troubleshooting

| Symptom                                                                     | Likely cause                                                                                            | Fix                                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CD fails: `unable to pull image using Managed identity system for registry` | migrate-job MI `principalId` rotated, orphaning the AcrPull assignment                                  | `az role assignment create --assignee <current principalId> --role AcrPull --scope <acr id>`; wait ~60 s; re-run `gh workflow run deploy.yml` (invariant 68) |
| New revision never goes `Running` (CD deploy job exits 1)                   | a `require()` throws at boot (e.g. `instrument.js` moved, missing env) → ACA reports `ActivationFailed` | check container logs in Log Analytics; the deploy job surfaces it in <1 min                                                                                  |
| Server refuses to boot in prod                                              | `JWT_SECRET` or `CORS_ORIGINS` unset                                                                    | seed both (KV secret + Bicep param / env); these throw on boot by design                                                                                     |
| Connections reject "no pg_hba.conf entry … no encryption"                   | prod `DATABASE_URL` missing `?sslmode=require`                                                          | append it; both config/database.js + models/index.js opt into TLS on that substring                                                                          |
| Stale leaderboard standings (≤30 s persistent)                              | a new mutation path didn't invalidate the cache                                                         | add the `invalidate`/`invalidatePrefix` call inside the owning service (invariant 33)                                                                        |
| Materialized totals drift from live aggregate                               | a raw `Pick.update`/`Game.update({result})` path bypassed the dual-writer                               | route it through the service layer; run `scripts/backfill-user-scores.mjs` to repair (invariant 17)                                                          |
| A live game stuck `in-progress` for hours, picks unscored                   | upstream `?status=` filter went stale (incident 2026-05-19)                                             | the 3-min `reconcileInProgressGames` should self-heal (≤3 min); if both endpoints stale, set the result manually in Admin                                    |
| Daily Azure cost spiked                                                     | a cron lost its cost-gate, or live-score cadence tightened                                              | confirm the COUNT cost-gates fire; off-season ticks should be near-free                                                                                      |
| Migration works locally but fails CI                                        | a migration added a column without `IF NOT EXISTS` (CI runs `sync` then `migrate`)                      | rewrite to raw SQL `ADD COLUMN IF NOT EXISTS` (invariant 36)                                                                                                 |
| Email links point to localhost in prod                                      | `PUBLIC_APP_URL` unset/wrong                                                                            | set it to the deployed URL (baked into verify/reset links)                                                                                                   |
| Push silently does nothing                                                  | VAPID env not fully set                                                                                 | set all of `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`; `GET /push/vapid-public-key` 503s until then                                              |
| Share card renders in Courier New                                           | font-load await missing/incomplete                                                                      | `await document.fonts.load` all 5 Orbitron weights before raster (invariant 53)                                                                              |
| SERP rich result broke                                                      | JSON-LD block in `index.html` reformatted → CSP hash mismatch                                           | recompute the `scriptSrc` hash (invariant 69)                                                                                                                |
| Every login shows the terms modal                                           | `CURRENT_TERMS_VERSION` bumped on only one side                                                         | bump it in BOTH `validation/schemas.js` and `src/lib/terms.js` (invariant 52)                                                                                |

> The "check container logs" fixes above assume you can reach the running system — §12.14 has the exact `az` commands.

### 12.14 Accessing & operating the running system (`az` CLI)

**First-time CLI bootstrap** (any engineer who's never authed the Azure CLI on this machine — you need **Contributor** on the `scorecast-prod` resource group, granted by an existing owner):

```bash
az login                                            # opens a browser; or `az login --use-device-code` headless
az account set --subscription <AZURE_SUBSCRIPTION_ID>   # the same sub id CD uses (repo secret)
az account show --query "{sub:name, id:id}" -o table     # confirm you're on the right subscription
```

**Read production logs** (the answer to every "check container logs in Log Analytics" in §12.13):

```bash
# Live tail of the running app (stdout = pino; JSON in prod, so each line is a JSON log record):
az containerapp logs show --name scorecast-app --resource-group scorecast-prod --follow --tail 200

# A specific (e.g. failed) revision's startup logs — where a require()-throw / ActivationFailed shows up:
az containerapp logs show --name scorecast-app --resource-group scorecast-prod \
  --revision <revision-name> --tail 200

# The migrate Job's last execution logs (e.g. a failed migration):
az containerapp job execution list --name scorecast-migrate --resource-group scorecast-prod \
  --query "[0].name" -o tsv                          # newest execution name, then:
az containerapp logs show --name scorecast-migrate --resource-group scorecast-prod --type job

# Which revision is actually serving traffic right now:
az containerapp revision list --name scorecast-app --resource-group scorecast-prod \
  --query "sort_by([],&properties.createdTime)[].{name:name,active:properties.active,state:properties.runningState,created:properties.createdTime}" -o table
```

**Structured search over history** (Log Analytics retains what stdout streamed; the portal's Logs blade or the CLI). Correlate a user-reported error with its server line via the `X-Request-Id` the client saw (it's `reqId` in every `req.log` line):

```bash
az monitor log-analytics query \
  --workspace <log-analytics-customer-id> \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'scorecast-app' | where Log_s contains '<reqId-or-error-substring>' | project TimeGenerated, Log_s | order by TimeGenerated desc | take 100" \
  -o table
```

**Shell into the running container** (operator scripts — but mind the **cp1252 ASCII-only caveat**, invariant 64): `az containerapp exec --name scorecast-app --resource-group scorecast-prod --command "node scripts/<x>.mjs"`. **Secrets:** `az keyvault secret show --vault-name <kv> --name jwt-secret --query value -o tsv` (read) / `az keyvault secret set ...` (seed a bootstrap secret before a Bicep apply). **Trigger / watch CD by hand:** `gh workflow run deploy.yml` then `gh run watch`. (Resource names: §12.4. KV name: `az keyvault list -g scorecast-prod --query "[0].name" -o tsv`.)

### 12.15 Contribution workflow

1. **Branch off `main`.** A merge to `main` auto-deploys to production (`deploy.yml`, §12.7) — never push work-in-progress straight to `main`.
2. **Local hooks fire automatically** (`husky`): **pre-commit** runs `lint-staged` (ESLint `--fix` + Prettier on staged files); **pre-push** runs `npm run build`. CI sets `HUSKY=0` to skip them in the runner. Run `npm run lint` / `npm run format` manually any time.
3. **Commit style:** Conventional Commits — `feat(scope): …`, `fix(scope): …`, `chore: …`, `docs: …` (match the existing `git log`). AI-assisted commits carry a `Co-Authored-By:` trailer.
4. **Open a PR to `main`.** CI (§12.6) must be green: `lint-and-build` (lint + format-check + `npm audit` + build), `migrations-smoke` (sync→migrate→undo:all→migrate→status), and the full Playwright `e2e` suite. Squash-merge.
5. **On merge, CD runs** build → migrate (one-shot Job) → roll a new revision → smoke `/healthz` (~5–8 min). A failure keeps the old revision live; **rollback is "revert the commit + push."** If CD fails on image pull, it's the AcrPull MI-rotation issue (§12.7 / invariant 68).
6. **Change-type checklists:** schema → §7.3 (raw SQL with `IF NOT EXISTS`; test `up → undo:all → up` locally) + update `seedDatabase()` if you add a NOT-NULL-without-default column (§7.2); scoring/leaderboard → keep `lib/scoring.js` ⇄ `src/utils/scoring.js` in sync (§8.1) and respect the Tier 24 dual-writer (§8.13); a new non-obvious constraint → add it to §13 in the same PR.

---

## 13. Load-Bearing Invariants

The complete catalogue of things that are **not obvious from reading the code** — the things future-you gets burned by. Grouped by area.

Each item is **what** + **why** (the consequence if you break it). The body sections carry the full mechanism; this is the scannable catalogue.

### Routing & API shape

1. **Route ordering** — `/api/groups/discover` registers before `/api/groups/:groupId` → _else Express matches `discover` as a `:groupId` path param and the discover endpoint 404s._ Any `/api/groups/<literal>` follows suit.
2. The `app.use('/api', 404)` JSON sentinel sits between the dev-only docs and the SPA catch-all → _else unknown `/api/_`paths fall through to`dist/index.html` (HTML) instead of a JSON 404, breaking API clients.\*
3. OpenAPI docs (`/api/openapi.json`, `/api/docs`) mount only when `NODE_ENV !== 'production'` → _else the full attack surface is published from the live site._
4. `validate()` only handles `req.body`; query params validate inline via `safeParse(req.query)` → _else query validation silently never runs._
5. `/healthz` (liveness, no DB, body `{ok:true}` exactly) ≠ `/readyz` (DB ping) → _adding a DB ping to `/healthz` would restart the container on a transient DB hiccup; dropping `/readyz` would route traffic to a replica with a dead DB connection._ A test asserts `/healthz` has no `uptime` (timing leaks deploy patterns).

### Scoring & ML

6. `scorePick` is duplicated — `lib/scoring.js` (authoritative) + `src/utils/scoring.js` (preview) → _change both in one commit, else the on-screen "+N pts" diverges from the leaderboard total._
7. Three branches (home/away winner / draw partial-credit / null); `winRate` counts only literal `choice === result` → _the migration deliberately does NOT backfill legacy `result=null+status=finished` to `'draw'`, else it would retroactively reshuffle the leaderboard._
8. `expectedDrawPoints` returns `null` for unconfigured games → _so PayoutMatrix shows a visibly-pending `+x`/`+y` instead of a misleading `+0`._
9. Python ↔ JS Elo parity (K=20, INITIAL=1500, HFA=0) → _drift silently desyncs the seeder's bootstrap (Python-derived) from the runtime cascade (JS-derived), corrupting probabilities over time._ Both sides have invariant tests.
10. Per-game Elo snapshot (`homeEloPre`/`awayEloPre`) is **immutable after first store** → _reverse + reapply use it as the pre-match reference; re-taking it from live Elo would compound drift on every result toggle (the PR C bug)._ `eloKMultiplier`/`neutralVenue` are **frozen once `appliedResult` is non-null** (the reverse leg reads them live).
11. `onResultUpdated` runs INSIDE the result transaction (Elo rolls back with the result); `rePredictFutureFixtures` runs AFTER commit (best-effort; a model-load failure must never undo the result).
12. `parseBaseScore` defaults to 0 for XGBoost 2.x hex `base_score` → _else `Number()` returns NaN and poisons every logit (`[NaN,NaN,NaN]` — caught live for ~48 h)._ Clip to [0.01,0.99] **before** rounding (else a 0.001 emits a literal "0% chance"); rebalance residual onto the largest **raw** class (preserves ordering through ties); nudge off the `(0.50,0.00,0.50)` sentinel (else it collides with the auto-insert sentinel check).
13. Promoted teams enter at `MIN(elo)` (empirically they underperform the league bottom); team seeders use `ON CONFLICT DO NOTHING` (never `DO UPDATE`) → _else a re-seed wipes live cascade-accumulated Elo back to historical-snapshot values._
14. Symmetrize ONLY when `neutralVenue === true` → _widening it to "always" would silently shift PL probabilities, which depend on home-field asymmetry._ The K-mult tier table is duplicated in 3 files (Python ingest / JS seeder / fixup) — change all three together. football-data↔martj42 name diffs bridged in `HISTORY_SYNONYMS`.
15. `games.timestamps:false` (no `updatedAt`) → _raw SQL UPDATEs must not set it; the games table churns every 30 s and timestamp write-amplification has no consumer._

### Tier 24 materialized scores

16. Additive `points = points + EXCLUDED.points` only → _the dual-writer's correctness under concurrent writes depends on the merge being associative; a max-merge would corrupt totals._
17. No raw `Pick.update`/`Pick.destroy`/`Game.update({result})` paths that bypass the service layer → _the materialized totals silently drift._ Test helpers `clearGameResults`/`clearPicksAndBadges` route through (or mirror) the dual-writer for this reason.
18. `backfill-user-scores.mjs` is required once after the migration deploys → _the dual-writer only fires on future transitions; pre-existing scored picks stay invisible to the materialized totals until backfilled._

### Auth & security

19. `lib/instrument.js` is the first `require()` in `server.js` → _`@sentry/node` v8+ uses OpenTelemetry, which must instrument Express/Sequelize before they're imported; moving it down one line silently disables auto-instrumentation._
20. `authMiddleware` reads `sc_access` cookie only (no bearer); `jwt.verify` HS256-pinned on all 4 call sites → _re-adding bearer-header auth re-exposes the XSS-readable-session surface; pinning is belt-and-braces against a future `alg:none` regression._
21. `forgot-password` always 204 (token+email in `setImmediate`); lockout returns generic 401 → _any status/body/timing difference for the existence case is a username-enumeration leak; never surface "Account is locked"._
22. `LOGIN_DUMMY_HASH` generated once at module load + recovery-code verify is `Promise.all(...)` → _inlining the dummy hash per-request, or early-exiting the recovery loop, reintroduces a timing channel that leaks whether a user exists / which code slot matched._
23. CSRF `EXEMPT_PATHS` = pre-auth/anon mutations only → _adding a post-auth endpoint there disables its CSRF protection._
24. `sc_refresh` stays `Path=/api/auth` (so the high-value cookie isn't sent on every request); refresh is single-flight (`inflightRefresh`) → _a per-call refresh stampedes the rotating-token logic and spuriously logs the user out._ Server-side rotation uses `SELECT ... FOR UPDATE` to serialize parallel tabs.
25. Login does NOT revoke other devices → _multi-device is intentional; only logout (current) + reset/password-change (all) revoke._
26. `currentPassword` required on `/me/email` + `/me/password` → _so a stolen 15-min access JWT alone can't pivot a brief cookie compromise into account takeover._
27. `editProfileSchema` rejects bidi-override/zero-width/control codepoints (ZWJ U+200D allowed for emoji) → _blocks homograph/display-spoofing in usernames/bios without breaking 👨‍💻._
28. Web Push: endpoint allowlist (FCM/Apple/Mozilla) + HTTPS-only + private/loopback-IP SSRF block → _both layers needed; the IP block covers DNS-rebind + stale-row scenarios that bypass the write-time schema gate._
29. `pushPreferencesSchema` is `z.record(z.string(), z.boolean())` + refine → _the enum-keyed form requires every key present, breaking the documented partial-update JSONB merge._
30. 2FA parked — keep columns/migrations/`CHALLENGE_*`/`twoFactorEnabled` no-op/deps → _revival is then a clean `git revert` with no schema work._ Audit `totpEnabledAt != null` (should be 0) first.
31. `npm overrides.uuid ^11.1.1` → _`uuid <11.1.1` has a buffer-bounds CVE reachable via sequelize; don't drop until sequelize ships its own bump._
32. `save({hooks:false})` in role-update, `PUT /me`, the bcrypt backfill seeder, bulk role flips → _else `beforeUpdate` re-hashes the already-hashed password._

### Data & cache

33. Every standings-affecting mutation invalidates from inside the owning service (`invalidatePrefix('group:<id>')` for group scopes) → _else readers see stale standings ≤30 s; `invalidate` (singular) would leak stale filtered variants since one group spans many `(leagueId,seasonId)` keys._
34. Side-effects (notify/badge/streak) fire OUTSIDE the transaction; bulk = one tx per entity → _a rollback never produces ghost notifications; a single bad bulk row doesn't undo the committed rest._
35. `comments` carry exactly one scope (DB CHECK `comments_one_scope_chk` + `assertSingleScope`) → _a programmer error surfaces as a recognizable 400, not a raw Postgres CHECK violation._
36. Migrations use raw SQL with `IF NOT EXISTS`/`DO $$ EXCEPTION` guards → _load-bearing for the CI smoke job, which runs `sync({alter:false})` before `db:migrate`; a Sequelize `addColumn` (no IF NOT EXISTS) fails in CI even though it works in prod CD._
37. `getGroupsForUser`/`getGroupById` return shapes are consumed by several components → _preserve them or break the consumers._
38. `getProfileByUsername` reads `UserScoreOverall` first + narrows `Game.findAll` to pick gameIds → _don't reintroduce a full-table `Game.findAll()`; it OOMs the 1 GiB replica at launch volume._
39. Group-comment edit/delete re-checks `assertStillMember` (IDOR) → _else a user who left a group can still rewrite/delete their old comments inside it._ Admin override on delete only (admins shouldn't impersonate authors via edit).
40. `MAX_GROUP_MEMBERS=2000` enforced in 4 add-member paths → _bounds the leaderboard payload + the comment fan-out; further raises should re-check memory + the worker-pool._
41. `fanOutGroupComment` uses an 8-worker pool, not unbounded `Promise.all` → _at 2000 members the naive form burns the 20-slot DB pool + thunders Web Push, starving other handlers._
42. Private-group comment GET returns 404 (not 403) for non-members → _403 would leak the existence of a private group._
43. football-data wants comma-separated `?status=X,Y,Z` → _repeated `?status=X&status=Y` params return 400._
44. `games.leagueId NOT NULL`; `lib/fixtureStatus.js` is the single status/result mapping source → _both sync paths import from it so they can't drift._
45. Live-score reconcile passes + `reconcileInProgressGames` are load-bearing (don't remove/de-frequency) → _without them a stuck-live game silently blocks pick scoring + leaderboards for everyone holding picks, for hours (the 2026-05-19 incident)._ `applyLiveUpdate` needs `FOR UPDATE` + the finished-status flip-back guard; don't widen the guard to accept non-FINISHED/AWARDED → _that reopens the stale-LIVE regression vector._
46. The 3 cron cost-gates (syncLiveScores COUNT, reconcile self-gate, kickoff self-gate) — don't remove or shrink the 4 h lookback / 2 h lookahead → _Container Apps bills per vCPU-second; the lookback is the only catch for a kickoff that passed while scaled to zero._
47. `auditMutation` wraps routes BEFORE `validate` (captures the raw payload); `actorUserId` SET NULL (history survives admin removal); 4 KB truncation; never throws → _an audit-log outage must never block a real admin action._

### Frontend

48. Design tokens only in `src/components/**` (no raw `slate-*`/`cyan-*`/`text-white`) → _literals bypass the light-mode override and look broken in the inverse theme._ Exceptions: brand glow + Avatar fg inline hex (deliberately theme-independent).
49. `pickMap` stores full pick objects (undo needs the id); Avatar hashes the lowercased username → _renames don't shuffle colours._
50. Theme applied synchronously before mount (no FOUC); `<m.*>` only under strict LazyMotion (catches accidental full-namespace imports); every motion consumer honours `useReducedMotion`.
51. Sidebar items keep `role="tab"` → _every Playwright flow locates them via `getByRole('tab', …)`._ Legal pages short-circuit before boot/auth → _else a flash of unauthenticated chrome before the legal copy renders._
52. `CURRENT_TERMS_VERSION` in two synced files; `PUSH_NOTIFICATION_TYPES`+`NOTIFICATION_TYPES` synced; reaction emoji palette synced → _bumping only one side 400s registrations / strands users in the modal / yields a stuck UI button._
53. Share card: `await document.fonts.load(...)` all 5 Orbitron weights before raster → _RAF covers paint, not web-font download; without it the card rasterizes Courier New._ All 5 weight imports in `main.jsx` must match the load list (else faux-bolding).
54. `?league=&season=` ≠ `?lbLeague=&lbSeason=` (separate axes); reset both filters on user→null → _else picking a games-view league also scopes stats, and user A's filter leaks into user B's views on a shared browser._
55. Crowd hidden until kickoff (server-gated, omitted from JSON below the gate) → _client-side gating ships the data to every viewer; re-adding the pick-based reveal defeats the anti-bias contract._
56. `scorecast:url-changed` event bridge — any URL-param-derived component that survives in-app navigation must subscribe → _`pushState`/`replaceState` don't fire `popstate`, so a once-only `useState` initializer goes stale on in-app nav._
57. `err.wasHandled` flag on every 4xx → _`clientErrorReporter` short-circuits (skips the DOM event + server POST), else the generic "Something went wrong" toast clobbers the real message._ Keep the `NotificationContext` defense-in-depth check.
58. AuthView swallows login/register re-throws → _else the unhandled rejection fires the generic toast over "Invalid credentials" (the Tier 5.5b race)._
59. `useRequest` retries a 401 once after refresh; `/api/auth/*` exempt → _don't add another retry layer at a caller; if the post-refresh attempt still 401s the user is genuinely logged out and should fall to `clearSession`._
60. `<TermsAcceptanceModal>` is fully blocking (preventDefault all dismissal vectors); no "remind me later" → _that would defeat the consent-capture contract._
61. NotificationBell poll gated on `user?.id` (a logged-out tab stops 401-looping); `navigateToDeepLink` is the only sanctioned bell-click target; `odds-shifted` must emit `/?gameId=` not `/games/<id>` → _the path-form is not a route and silently no-ops on every consumer._
62. Placeholder-game UI gate (`isPlaceholderGame` regex hides PayoutMatrix + pick buttons on TBD-vs-TBD) is frontend-only by design → _a curl pick still scores correctly once the cascade fills real names, so there's no integrity hazard; don't loosen the regex (false-positives hide real picks)._

### Ops / cloud

63. Bicep reapply = 5 params; never reintroduce the placeholder ternaries; `COPY .sequelizerc`+`scripts/`+`international_match_archive/` in the Dockerfile → _the ternaries clear registry auth + env on reapply (breaking CD + new revisions); missing COPYs break sequelize-cli, operator scripts, and the INT seeder._
64. Operator scripts via `az exec` must be ASCII-only → _the Azure CLI hardcodes cp1252; a non-cp1252 byte crashes the reader thread and kills the container's async work._ Subprocess-isolate pino/npx/sequelize-cli output.
65. SIGTERM drain order is fixed (`server.close` → 25 s race → `scheduler.stop` → `sequelize.close` → exit) → _closing sequelize before draining would 500 in-flight requests._ `tini` forwards the signal.
66. `MIGRATE_ON_BOOT` false in prod (CD runs the migrate Job); `sslmode=require` required on prod URLs (else "no encryption" reject); `pino-pretty` not shipped (`--omit=dev`).
67. `geoRedundantBackup` is server-creation-time-only → _Azure silently no-ops the update; it's folded into the C3 SKU bump which recreates the server._
68. AcrPull MI-rotation recovery: `az role assignment create --assignee <current principalId> --role AcrPull --scope <acr id>` + re-run CD → _no Bicep reapply needed; the orphaned assignment is the cause of `unable to pull image using Managed identity`._
69. JSON-LD inline block in `index.html` is CSP-hashed → _any whitespace/content change requires recomputing the `scriptSrc` SHA-256, else helmet rejects it and the SERP rich result breaks._
70. Trust proxy is `1` (single hop), never `true` → _`true` would let an external `X-Forwarded-For` spoof bypass every per-IP rate limiter._
71. CORS*ORIGINS empty + prod → server refuses to boot → \_don't quietly add an `origin:true` prod fallback; the loud failure is the whole point (a misconfigured staging env would otherwise accept credentialed requests from any origin).*
72. `data.json` seed re-runs only on an empty `users` table; never `closeDb()` in a Playwright `afterAll` → _`workers:1` shares the Sequelize pool across specs; closing it stalls every later spec._

---

## 14. Known Limitations & Technical Debt

| Area                          | Issue                                                                                                                                            | Destination               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Tests below E2E               | Playwright + a thin unit layer; no integration tier (the API suite hits the real stack against a real DB, so the gap is mostly philosophical)    | future                    |
| Pick types                    | winner-only; no spread/over-under/score (draws now pay partial credit, but the pick stays home/away)                                             | future (post-4b)          |
| Match minute                  | client-estimated (TIER_ONE plan doesn't expose `minute`/`injuryTime`); soft ~5 min around HT                                                     | provider swap             |
| Upstream filter staleness     | `?status=` can lag `?ids=` 90+ min; mitigated by the 3-min reconcile (≤3 min stuck); both-stale → admin override                                 | provider swap             |
| Audit before-state            | records `after` only; no per-entity pre-fetch; auth-failures not audited                                                                         | future                    |
| Real-time                     | HTTP polling only (30 s); reaction counts don't propagate live                                                                                   | Tier 7 / C5 (needs Redis) |
| Notification spam             | bulk-setResult + live finalization fan out per-pick, no batching                                                                                 | Tier 7                    |
| In-process caches             | rate-limit/lockout/leaderboard/football caches per-process (single-instance-coherent); per-IP budget leaks at multi-replica                      | Tier 10.4 Redis           |
| Metrics                       | no `/metrics`; App Insights SDK not wired into app code                                                                                          | Tier 10.3/10.6            |
| Multi-device sessions         | `refresh_tokens.userAgent` captured but no "active sessions" / "sign out all" UI                                                                 | future                    |
| Reused-recovery-code          | second use returns generic 400; no alert (dormant 2FA)                                                                                           | future                    |
| TypeScript / Storybook        | parked at end of roadmap                                                                                                                         | 9.10 / 9.11               |
| Token-rule lint               | "design tokens not literals" is review-only (no ESLint plugin)                                                                                   | future                    |
| Friends' picks privacy        | `/picks/friends` exposes unresolved picks to friends; only lever is `profileVisibility=friends` (masks leaderboards, not picks)                  | future                    |
| Terms version global          | bumping `CURRENT_TERMS_VERSION` re-prompts everyone; no targeted re-prompt                                                                       | future                    |
| ML single-league              | PL + INT only; more leagues need CSV + reconcile-map + seeder + training                                                                         | future                    |
| ML calibration / monotonicity | dropped for a zero-dep runtime; probabilities slightly miscalibrated >70%; small non-monotonic kinks possible (~30 LOC / one-line config to add) | future                    |

---

## 15. Roadmap Status

**Shipped:** Tiers 1–3, 4a, 4b, 5(core)+5.4b+5.5+5.5b, 6, 8(+8.6), 9(less 9.10/9.11), 11, 13, 17, 18, 19, 20, 22, 24, 25 (Phase 1+2), 30 (Phase 0/1/2/3 A1–A5+C1 / Phase 5 Chunk 5.1), plus standalone tiers: draw-scoring, security-hardening batch, per-endpoint API suite, leaderboard filters, intl-model, beta→launch reset.

**Next up:** **Tier 23** (~6 hr operational hardening — HSTS preload submission, audit-log weekly digest, secrets-rotation drill, Postgres restore drill).

**Parked:** Tier 7 (SSE realtime + email digests + prefs UI); Tier 25 Phase 3 levers (C1 Redis / C2 Postgres B2s / C3 GP / C5 SSE — all trigger-driven); Tier 9.10 TypeScript; Tier 9.11 Storybook; Tiers 12/14/15/16. Tier 10 mostly absorbed by Tier 20 Chunk 7 + Tier 25. Operational defense-in-depth (Cloudflare WAF/Bot-Fight/edge-limits, Sentry alert routing) parked from the Tier 22 plan.

Live forward roadmap: `C:\Users\vinde\.claude\plans\ROADMAP.md`.

---

## 16. Glossary

- **Pick** — a user's `'home'|'away'` prediction for a game; unique per `(userId, gameId)`. Winner-only.
- **Result** — actual outcome `'home'|'away'|'draw'|null` (null = unresolved); admin-set or cron-derived.
- **Probability** — implied win-chance for a team in `[0,1]`; home + draw + away sum to 1.0.
- **Upset bonus** — `round((1−probability)×100)`: underdogs pay more. The core mechanic.
- **Draw scoring** — partial credit on a drawn match for a winner-only pick, weighted by `drawProbability`.
- **Elo** — relative skill rating; zero-sum updates; a 400-pt gap predicts ~91% for the stronger side. K-factor sets magnitude (K=20 base; ×3.0 for WC via the K-multiplier).
- **HFA** — home-field advantage (0 here; the model learns it from data; forced 0 on neutral venues).
- **Snapshot / appliedResult matrix** — Tier 17 idempotency + reversibility: the immutable pre-match Elo pair on the game row lets a result correction (X→Y→X) round-trip bit-identically.
- **Cascade** — the chain triggered by a captured result: update both teams' Elo (in-tx), then re-predict all their upcoming fixtures (post-commit).
- **Symmetrization** — averaging `predict(A,B)` with swapped `predict(B,A)` for order-independent neutral-venue output.
- **Meta-pool** — one league row hosting many competitions' teams (the `WC` row for all nations).
- **Materialized scores** — `user_scores`/`user_scores_overall`, the incrementally-maintained leaderboard tables (Tier 24 dual-writer).
- **Dual-writer** — `UserScoreService` updating the materialized tables inside every score-affecting transaction (8-arm idempotency matrix).
- **Kickoff lock** — Tier 19: overwriting all picks' probability snapshots at kickoff so same-team picks pay the same.
- **Group / Season / League** — composition primitives over games; `sourceLeagueId` (e.g. `PL`/`WC`) is the shareable URL code.
- **Sentinel probabilities** — `(0.50,0.00,0.50)`, the "untouched" tuple a fresh game carries; the cascade nudges off it.
- **`sc_access` / `sc_refresh` / `sc_csrf` / `sc_challenge`** — auth cookies (15-min access JWT / 30-day rotating refresh, Path=/api/auth / JS-readable CSRF / dormant 2FA challenge).
- **Refresh-then-retry** — `useRequest`'s single-flight 401 handling that makes 15-min tokens invisible (session lives 30 days from one login).
- **Reconcile pass** — the `?ids=` sweep catching upstream `?status=` filter staleness.
- **Discriminator** — a group's server-set 6-hex tag; rendered "Name #ABCDEF".
- **Tier** — roadmap grouping (see §15). "Tier N Chunk M" is a sub-deliverable.
- **Cost-gate** — a cheap `Game.count` that lets a cron tick return early before any upstream call (Container Apps bills per vCPU-second).

---

## 17. First-Day Checklist

1. **Read this file top to bottom once.** It is the territory, not a map — everything you need is here.
2. **Run it locally** (§12.2): `createdb scorecast_db`, set `JWT_SECRET` in `.env`, `node server.js` + `npm run dev`, open `:5173`, log in as `vo123/password123`.
3. **Trace one flow end-to-end in the source.** Backend: `routes/picks.js` → `services/PickService.js` → `models/Pick.js` → `lib/scoring.js`. Frontend: `src/components/GameCard.jsx` → `usePicks` → `useRequest` → `DataContext`.
4. **Run the tests:** `npm run test:unit` (fast, no DB); `npm run test:e2e` (needs a `scorecast_test` DB — `createdb scorecast_test` first, §12.2); for the Python tests, set up the venv once — `cd ml && python -m venv .venv && .venv/Scripts/Activate.ps1` (or `.venv/bin/activate`) `&& pip install -r requirements.txt` — then `pytest`.
5. **Before any schema change** (§7.3): `npx sequelize-cli migration:generate`; raw SQL with `IF NOT EXISTS`; test up → undo:all → up.
6. **Before any scoring/leaderboard change:** remember the duplicated `scorePick` (§8.1) and the Tier 24 dual-writer (§8.13).
7. **Before deploying:** a push to `main` auto-deploys via `deploy.yml`; CI must be green first. If CD fails on image pull, it's the AcrPull MI-rotation issue (§12.7, invariant 68).
8. **Before touching the ML cascade or Elo:** §9 + invariants 9–14. Run `tests/eloMath.test.js` + `pytest ml/tests/` after any change.
9. **When you hit a "why is it like this?"** — it's almost certainly an invariant in §13 (each records the _why_, not just the _what_).
10. **When you change anything load-bearing,** update §13 here so the next engineer inherits the reasoning.

---

_This document is the complete, standalone companion to the ScoreCast / Bantryx codebase. Keep it current as the system evolves — when you ship a change that introduces a non-obvious constraint, it belongs in §13._
