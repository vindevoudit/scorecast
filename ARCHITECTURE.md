# ScoreCast — System Architecture

> **Audience**: future engineers picking up this codebase cold. This document is the source-of-truth handover. It assumes you can read JavaScript and SQL but not that you know anything about ScoreCast.
>
> **Companion docs**: [CLAUDE.md](CLAUDE.md) is the quick-reference for day-to-day work; [README.md](README.md) is the marketing-style intro; [DATABASE_SETUP.md](DATABASE_SETUP.md) covers local Postgres setup. This file is the architectural deep-dive.

## Table of Contents

1. [Purpose](#1-purpose)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Tech Stack & Rationale](#3-tech-stack--rationale)
4. [Repository Layout](#4-repository-layout)
5. [Backend Architecture](#5-backend-architecture)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Database Architecture](#7-database-architecture)
8. [Domain Subsystems](#8-domain-subsystems)
9. [End-to-End Data Flows](#9-end-to-end-data-flows)
10. [Cross-Cutting Concerns](#10-cross-cutting-concerns)
11. [Operational Notes](#11-operational-notes)
12. [Known Limitations & Technical Debt](#12-known-limitations--technical-debt)
13. [Roadmap](#13-roadmap)
14. [Glossary](#14-glossary)

---

## 1. Purpose

ScoreCast is a social football-prediction web app. The product loop is:

1. An admin creates fixtures (individually or in bulk) with home/away probabilities (the implied odds).
2. Users sign up, pick the winner of upcoming games, lock in their pick before kickoff (and can undo a pick before kickoff).
3. After a game's result is set, correct picks earn `round((1 − probability) × 100)` points — picking the underdog pays more.
4. Users compete on an overall leaderboard and inside private/public groups (sortable + paginated), send friend requests, comment and react on games, customise their profile (display name, bio, deterministic avatar), search across users/groups/games, and collect badges for milestones.

The codebase is mid-sized (~4k lines of JavaScript split roughly evenly between server and client). It is monorepo-style: one Express server serves both the JSON API at `/api/*` and the static React bundle for everything else.

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                            Browser (Client)                           │
│                                                                       │
│   React SPA  ─── fetch('/api/...') ───▶  request() helper            │
│   Cookies (no localStorage):           (credentials: include,         │
│     sc_access   (HttpOnly, 15min)        X-CSRF-Token on mutations)   │
│     sc_refresh  (HttpOnly, 30d,                                       │
│                  Path=/api/auth)                                      │
│     sc_csrf     (readable)                                            │
│                                                                       │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ HTTPS (production) / HTTP (dev)
                         │ /api/* + static assets
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Express server (server.js)                     │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ requestId → pino-http → compression → helmet → cors          │   │
│  │ → bodyParser → cookieParser → csrfMiddleware                 │   │
│  │ → express.static(dist/)                                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ rate-limit   │  │ authMiddleware│ │ validate(zodSchema)       │  │
│  │ (per-route)  │  │ requireAdmin │ │                            │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                       │
│  routes/*.js ─── services/*.js ─── Sequelize models                   │
│   (thin parse/auth │  (domain logic — PickService, GameService,        │
│    + service call) │   GroupService, UserService, CommentService,      │
│                    │   LeaderboardService, NotificationService,        │
│                    │   BadgeService — own cache + notify + cascade)    │
│                                                                       │
│  lib/ cross-cutting infra:                                            │
│    scoring, users, groups, friends, auth (cookies/tokens), errors,    │
│    response, errorMiddleware, leaderboardCache, email, logger         │
│  ┌──────────────────────┴──────────────────────────────────────┐   │
│  │ lib/leaderboardCache (in-process Map, 30s TTL)              │   │
│  │ lib/email (Resend transport — log-only fallback)            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────┬────────────────────────────────────────────┘
                          │ Sequelize (TCP, transactional for cascades)
                          ▼
            ┌─────────────────────────────────────┐
            │       PostgreSQL                    │
            │  users, games, picks, groups,       │
            │  group_members, group_invites,      │
            │  badges, friendships, comments,     │
            │  comment_reactions, notifications,  │
            │  email_verification_tokens,         │
            │  password_reset_tokens,             │
            │  refresh_tokens,                    │
            │  SequelizeMeta (umzug bookkeeping)  │
            └─────────────────────────────────────┘
```

There is **one server process**, **one database**, **no message queue**, **no worker**, **no CDN**. A small in-process leaderboard cache lives in the Node heap (Tier 5.2). Notifications and badges are fired synchronously inside the same request that triggers them (in a `.catch(() => {})` to keep the user-facing response from failing if a side-effect errors), and they fire **outside** any transaction so a rollback never produces ghost messages.

---

## 3. Tech Stack & Rationale

| Layer              | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend framework | **React 18** with hooks-only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Familiar, easy hiring, no SSR needs                                                                                                                                                                                                                                                                                                                                                                                                              |
| Build tool         | **Vite 5**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Fastest DX for vanilla React; dev proxy avoids CORS in development                                                                                                                                                                                                                                                                                                                                                                               |
| Styling            | **Tailwind CSS 3**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Utility classes keep components self-contained; no design-token sprawl                                                                                                                                                                                                                                                                                                                                                                           |
| HTTP client        | **`fetch`** (no axios)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Standard; the wrapper handles JSON + auth header + 401                                                                                                                                                                                                                                                                                                                                                                                           |
| State              | **React Context + custom hooks** (Tier 13.6/13.7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Four providers: `NotificationContext` (toast banner), `AuthContext` (user + auth flow + `browseAsGuest` flag), `AuthGateContext` (anonymous-action sign-in gate — SignInModal + InlineGatePanel), `DataContext` (games/picks/groups/leaderboard/friends/profile/`gameFilters`/`leaderboardFilters` + every mutation). Selector hooks (`useGames`/`usePicks`/`useGroups`/`useLeaderboard`/`useFriends`) keep components narrow. No Redux/Zustand. |
| Backend            | **Node 18+ / Express 4**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Tiny surface, no router framework, easy to read                                                                                                                                                                                                                                                                                                                                                                                                  |
| ORM                | **Sequelize 6**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Predictable, supports raw SQL escape hatches                                                                                                                                                                                                                                                                                                                                                                                                     |
| Migrations         | **sequelize-cli + umzug** (Tier 5.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | sequelize-cli for `npm run db:*` scripts; umzug for programmatic dev-boot execution. Versioned files under `migrations/`. See §7.3                                                                                                                                                                                                                                                                                                               |
| DB                 | **PostgreSQL**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Need ENUMs, partial unique indexes, and `LEAST/GREATEST` functional indexes — all Postgres-specific                                                                                                                                                                                                                                                                                                                                              |
| Auth               | **HttpOnly cookie auth** (Tier 6.8): 15-min access JWT (HS256) + 30-day rotating refresh token, both via `res.cookie()`. Refresh tokens are SHA-256 hashed in `refresh_tokens` table. Bearer-header auth was removed in the same tier — there is **no token in the body** of login/register/refresh responses.                                                                                                                                                                                                                                                                                                                        |
| 2FA                | **TOTP** (Tier 6.9) via `speakeasy` + `qrcode`. Opt-in per user. 10 single-use recovery codes (bcrypt-hashed, rounds 8). 5-min `sc_challenge` cookie issued between password-OK and code-OK.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Password hashing   | **bcryptjs** (cost 10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Pure-JS, no native build step needed on Windows                                                                                                                                                                                                                                                                                                                                                                                                  |
| CSRF               | **Double-submit cookie** (Tier 6.7) via [middleware/csrf.js](middleware/csrf.js). `sc_csrf` cookie (readable) must match `X-CSRF-Token` header on POST/PUT/PATCH/DELETE; constant-time compare. Exempt list for unauthenticated mutation endpoints (login, register, password-reset, etc.). See §5.3 + §10.x.                                                                                                                                                                                                                                                                                                                         |
| Security headers   | **helmet** (Tier 6.2) — CSP tuned for Vite/Tailwind (inline styles allowed; `data:` URIs for Avatars and fonts; Sentry endpoints in `connectSrc`; HMR `ws://localhost:5173` in dev only), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. COEP/COOP/CORP disabled to avoid breaking third-party assets.                                                                                                                                                                                                                                                                             |
| CORS               | **Env allowlist** (Tier 6.1) via `CORS_ORIGINS` (comma-separated). Server **throws on boot** when unset in production. Dev falls back to `origin: true` if unset. `credentials: true` always.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Email              | **Resend SaaS** behind a pluggable abstraction at [lib/email.js](lib/email.js) (Tier 6.3). When `RESEND_API_KEY` is unset, `send()` logs the rendered payload to stdout — dev users grab verify/reset links from the server log. `send()` **never throws** (failures only log).                                                                                                                                                                                                                                                                                                                                                       |
| Validation         | **zod**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Schema-first request validation; emits structured error JSON                                                                                                                                                                                                                                                                                                                                                                                     |
| Rate limiting      | **express-rate-limit**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Per-IP, in-memory. Limiters: `loginLimiter` (5/15min), `registerLimiter` (3/h), `clientErrorLimiter` (30/5min), `commentLimiter` (10/min), `friendRequestLimiter` (10/5min), `pickLimiter` (30/min), `forgotPasswordLimiter` (3/h). Account lockout (5 fails → 15-min lock) layered on top — see §8.x.                                                                                                                                           |
| Logging            | **pino + pino-http** (Tier 5.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Structured JSON in prod, `pino-pretty` in dev. Every request gets `req.id` (UUID or inbound `X-Request-Id`) and a `req.log` child logger                                                                                                                                                                                                                                                                                                         |
| HTTP compression   | **`compression`** (Tier 5.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Gzip middleware mounted before static + body parser; ~75% size reduction on the JS bundle                                                                                                                                                                                                                                                                                                                                                        |
| Leaderboard cache  | **In-memory Map** with 30 s TTL (Tier 5.2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | No Redis dependency; appropriate for the current single-process deployment. See §8.14                                                                                                                                                                                                                                                                                                                                                            |
| Error reporting    | **React `ErrorBoundary` + window listeners → `POST /api/client-errors`** (Tier 5.4b); **Sentry SDK** (`@sentry/node` + `@sentry/react`) gated behind `SENTRY_DSN` / `VITE_SENTRY_DSN` (lazy on both sides). See §6.7 + §10.1                                                                                                                                                                                                                                                                                                                                                                                                          |
| Design system      | **CSS-variable design tokens** (Tier 11 Chunk 1) defined in [src/index.css](src/index.css) — `:root` carries the dark palette, `:root[data-theme='light']` overrides for light mode. Tailwind config wires every semantic token through `rgb(var(--c-<name>) / <alpha-value>)` so utilities like `bg-base/80` keep working with theme switches. **All `src/components/**` MUST use tokenized utilities** (`bg-base`, `bg-elevated`, `text-fg`, `text-accent`, `border-default`, etc.) — raw `slate-_`/`cyan-_`/`text-white` literals are forbidden because they bypass the theme switch                                               |
| UI primitives      | **Radix UI** (`@radix-ui/react-dialog`, `-dropdown-menu`, `-popover`, `-select`, `-switch`, `-tabs`, `-toast`, `-tooltip`, etc.) wrapped under [src/components/ui/](src/components/ui/) (`Button`, `Card`, `Dialog`, `DropdownMenu`, `Input`, `PasswordInput`, `Radio`, `Select`, `Spinner`, `Tabs`, `Toast`, `Tooltip`, `Switch`, `Textarea`, `Popover`, `Avatar`, `Badge`, `Checkbox`, `Skeleton`). Keyboard interaction + ARIA semantics live in the primitive; ScoreCast components consume the wrapper, never raw `<button>`s for interactive surfaces                                                                           |
| Theming            | **Binary light/dark** (Tier 11 Chunk 3 — `system` mode removed); managed by [src/lib/theme.js](src/lib/theme.js) `applyTheme` / `getStoredTheme` / `setStoredTheme`. Theme is applied **synchronously in [main.jsx](src/main.jsx) before React mounts** so no FOUC. Persisted to `localStorage.sc_theme`; legacy `'system'` values normalize to `'dark'` on read. Toggle UI: [src/components/ThemeToggle.jsx](src/components/ThemeToggle.jsx) in the top utility bar                                                                                                                                                                  |
| Anonymous browse   | First-class read-only mode (no account required) — see §8.18. Gate UX via [src/contexts/AuthGateContext.jsx](src/contexts/AuthGateContext.jsx) (`gate(label)` helper), [src/components/SignInModal.jsx](src/components/SignInModal.jsx) (button-style actions), [src/components/InlineGatePanel.jsx](src/components/InlineGatePanel.jsx) (replaces composer surfaces)                                                                                                                                                                                                                                                                 |
| Background jobs    | **node-cron** ([lib/scheduler.js](lib/scheduler.js)) with `pg_try_advisory_lock(crc32(jobName))` for multi-replica safety. Four scheduled jobs ([lib/jobs/syncFixtures.js](lib/jobs/syncFixtures.js): daily 03:00 UTC; [lib/jobs/syncLiveScores.js](lib/jobs/syncLiveScores.js): every 30 s — Tier 18; [lib/jobs/reconcileInProgressGames.js](lib/jobs/reconcileInProgressGames.js): every 3 min — Tier 18 defensive `?ids=` sweep against upstream `?status=` filter staleness, added 2026-05-19; [lib/jobs/sendKickoffReminders.js](lib/jobs/sendKickoffReminders.js): every 15 min). No-op when `NODE_ENV=test`. See §8.16 + §8.22 |
| External data      | **football-data.org v4** TIER_ONE plan (20 req/min, paid since 2026-05-23) behind a provider-agnostic surface at [lib/footballApi.js](lib/footballApi.js); rate-limit budget env-driven via `FOOTBALL_DATA_RATE_LIMIT`. Status/result normalization in [lib/fixtureStatus.js](lib/fixtureStatus.js); response cache in [lib/cache.js](lib/cache.js). See §8.16                                                                                                                                                                                                                                                                        |
| Audit log          | **`auditMutation(action, entityType)` middleware** (Tier 4b Chunk 3) wraps every `/api/admin/*` mutation; records via `res.on('finish')` through [services/AuditLogService.js](services/AuditLogService.js) with 4KB payload truncation; never throws back into the request lifecycle. See §8.16                                                                                                                                                                                                                                                                                                                                      |
| ML pipeline        | **Python project under [ml/](ml/)**, deployed as a separate Azure Container Apps Job (`scorecast-ml-job`, daily cron 02:30 UTC). XGBoost `multi:softprob` + Elo + isotonic calibration → writes `(homeProbability, drawProbability, awayProbability)` via `PUT /api/admin/games/:id`. See §8.17                                                                                                                                                                                                                                                                                                                                       |
| Tests              | **Playwright** (`@playwright/test`) — 22 specs, **270 tests** total. UI/flow specs at [tests/e2e/](tests/e2e/); per-endpoint boundary specs at [tests/e2e/api/](tests/e2e/api/) (one file per route file). See §10.6                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Container          | **Multi-stage Dockerfile** (`node:20-alpine`, non-root uid 1001, `tini`, `HEALTHCHECK /healthz`) — Tier 9.4. `docker-compose.yml` for local Postgres 16 + Redis 7 stack                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CI / CD            | **GitHub Actions** ([.github/workflows/ci.yml](.github/workflows/ci.yml): lint + format-check + `npm audit` + build + migrations smoke + Playwright; [deploy.yml](.github/workflows/deploy.yml): build → migrate → roll out on push to main, OIDC-authed; [ml-deploy.yml](.github/workflows/ml-deploy.yml): rebuilds the ML image on `ml/**` changes). Dependabot opens weekly grouped PRs for npm / pip / github-actions / docker                                                                                                                                                                                                    |
| Cloud              | **Azure** — Container Apps (Consumption) + Container Apps Jobs (migrate + ml) + Azure DB for PostgreSQL Flexible Server (B1ms) + Container Registry + Key Vault (RBAC) + Log Analytics + App Insights. Bicep IaC under [infra/](infra/). Cloudflare DNS + Azure managed TLS                                                                                                                                                                                                                                                                                                                                                           |

Notable **non-choices**: no TypeScript yet (parked at end of roadmap — Tier 9.10), no Storybook (9.11), no Redux/Zustand, no React Router (fake routing via context `view` slot), no WebSocket/SSE (Tier 7), no managed Redis in prod yet (Tier 10.4 — leaderboard cache + rate-limit counters live in the Node heap, so the app is currently single-instance). Build-once-deploy-anywhere is still the philosophy — secrets are resolved at boot via Key Vault references, not at build time.

---

## 4. Repository Layout

```
ScoreCast/
├── server.js                            # Express composition shell (~157 LOC; Tier 13 — handlers live under routes/, business logic under services/)
├── package.json                         # All deps; npm scripts: dev, build, start, preview, db:migrate*, db:seed*
├── db-config.js                         # Legacy stub — unused now that config/database.js exists
├── data.json                            # Seed: users, games, groups, picks
├── .env.example                         # Required env vars (JWT_SECRET, DATABASE_URL, LOG_LEVEL, MIGRATE_ON_BOOT, …)
├── vite.config.js                       # /api proxy → localhost:3000 in dev
├── tailwind.config.js
├── postcss.config.js
├── .sequelizerc                         # Tier 5.1: tells sequelize-cli where config/migrations/seeders live
│
├── config/
│   └── database.js                      # Tier 5.1: dev/test/production DB blocks (DATABASE_URL or local default)
│
├── migrations/                          # Tier 5.1: versioned schema migrations (sequelize-cli + umzug)
│   ├── 20260513000001-add-user-role.js
│   ├── 20260513000002-pick-unique-index.js
│   ├── 20260513000003-group-visibility-enum.js
│   ├── 20260513000004-friendship-pair-unique.js
│   ├── 20260513000005-user-displayname-bio.js
│   ├── 20260513000006-comment-edited-at.js
│   ├── 20260513000007-comment-reactions-table.js
│   ├── 20260513000008-user-login-attempts.js       # Tier 6.6: loginAttempts + lockedUntil columns
│   ├── 20260513000009-user-email-columns.js        # Tier 6.5: email + emailVerifiedAt (unique LOWER(email) index)
│   ├── 20260513000010-email-verification-tokens.js # Tier 6.5: token table (SHA-256 hash, 24h expiry)
│   ├── 20260513000011-password-reset-tokens.js     # Tier 6.4: token table (SHA-256 hash, 15min expiry)
│   ├── 20260513000012-refresh-tokens.js            # Tier 6.8: token table (SHA-256 hash, 30d expiry, revokedAt)
│   ├── 20260513000013-user-totp.js                 # Tier 6.9: totpSecret + totpEnabledAt + totpRecoveryCodes JSONB
│   ├── 20260514000001-disable-all-2fa.js           # ops: bulk-disable 2FA (one-off operational fix; see file header)
│   ├── 20260516000001-users-add-onboarding.js      # Tier 11 Chunk 4: users.onboardingCompletedAt
│   ├── 20260516000002-cascade-user-fks.js          # post-Tier-11: retrofit `ON DELETE CASCADE` on prod user FKs (see CLAUDE.md "Cascade-delete fix-up")
│   ├── 20260516000003-users-add-profile-visibility.js  # Tier 8.6: users.profileVisibility ENUM(public/friends/private)
│   ├── 20260518000001-create-leagues.js            # Tier 4b Chunk 1: leagues table + (sourceProvider, sourceLeagueId) unique
│   ├── 20260518000002-create-seasons.js            # Tier 4b Chunk 1: seasons table + (leagueId, year) unique
│   ├── 20260518000003-games-add-league-season-source.js  # Tier 4b Chunk 1: games.{leagueId,seasonId,sourceId,homeScore,awayScore,kickoffTz}
│   ├── 20260518000004-games-status-enum.js         # Tier 4b Chunk 1: games.status ENUM(scheduled|in-progress|finished|postponed|cancelled)
│   ├── 20260518000005-games-add-live-phase.js      # Tier 4b Chunk 2: games.halfTimeReached BOOLEAN + games.phase VARCHAR(20) for live-minute estimate
│   ├── 20260518000006-create-audit-log.js          # Tier 4b Chunk 3: audit_log table (`actorUserId` SET NULL on user delete)
│   ├── 20260518000007-games-tighten-league-not-null.js  # Tier 4b Chunk 3: games.leagueId NOT NULL (idempotent backfill into "Legacy / Imported" league)
│   ├── 20260518000008-games-add-draw-scoring.js    # draw-scoring tier: games.drawProbability DECIMAL(3,2) NOT NULL DEFAULT 0 + games.result enum extended to ('home','away','draw')
│   ├── 20260519000001-picks-add-probability-snapshot.js  # picks.{homeProbabilityAtPick,drawProbabilityAtPick,awayProbabilityAtPick} so payout reflects locked-in odds even when ML cascade rewrites the game's probabilities
│   ├── 20260520000001-create-push-subscriptions.js # PWA Chunk 4: push_subscriptions table (FK CASCADE; unique on (userId,endpoint)) + users.pushPreferences JSONB DEFAULT '{}'
│   ├── 20260520000002-games-add-kickoff-reminder-sent-at.js  # PWA Chunk 6: games.kickoffReminderSentAt idempotency flag for the 15-min cron
│   ├── 20260522000001-create-teams.js              # Tier 17: per-(name,leagueId) Elo state (NUMERIC(8,2)). Bootstrapped by seeders/20260522000001-seed-teams-from-elo-history.js
│   ├── 20260523000001-games-add-elo-snapshot.js    # Tier 17 PR F: games.{homeEloPre,awayEloPre,appliedResult} for idempotent + reversible Elo cascade
│   ├── 20260526000001-comments-add-group-scope.js  # Tier 18 Chunk 5: comments.gameId → NULLABLE, add comments.groupId UUID NULLABLE → groups(id) CASCADE, partial index comments_group_idx, CHECK comments_one_scope_chk ((gameId IS NOT NULL)::int + (groupId IS NOT NULL)::int = 1)
│   └── 20260526000002-users-add-terms-acceptance.js  # Tier 18 Chunk 6: users.{termsAcceptedAt TIMESTAMPTZ, termsAcceptedVersion INT} (both nullable). Existing users land on NULL/NULL → blocking modal on next sign-in
│
├── seeders/                             # Tier 5.1: idempotent seeders
│   └── 20260513000001-seed-password-backfill.js   # re-hashes any plaintext seed password matching data.json
│
├── lib/                                 # Process-local helpers + cross-cutting infra
│   ├── logger.js                        # Tier 5.4: pino instance (pretty in dev, JSON in prod, LOG_LEVEL env)
│   ├── leaderboardCache.js              # Tier 5.2: getOrBuild/invalidate/invalidatePrefix/stats; 30s TTL in-memory Map
│   ├── instrument.js                    # Tier 5.4b: Sentry.init() — MUST be the very first require() in server.js. Carries sendDefaultPii:false, maxBreadcrumbs:50, redacting beforeSend hook
│   ├── sentry.js                        # Tier 5.4b: captureException + setupExpressErrorHandler wrappers (no-ops if SENTRY_DSN unset)
│   ├── email.js                         # Tier 6.3: send({to, subject, html, text}) — Resend transport when RESEND_API_KEY set, log-only otherwise. NEVER throws.
│   ├── emailHelpers.js                  # Tier 13.1: sendVerificationEmail (wraps lib/email)
│   ├── auth.js                          # Tier 13.1: cookie + token helpers (JWT_SECRET, ACCESS/REFRESH/CHALLENGE cookies, setAuthCookies, clearAuthCookies, hashToken, generateRawToken, revokeAllUserRefreshTokens)
│   ├── scoring.js                       # Tier 13.1 + draw-scoring tier: scorePick (3-branch: home/away winners + draw partial credit) + sortLeaderboard
│   ├── users.js                         # Tier 13.1: getUserById, getUserByUsername, buildUserSummary (accepts {leagueId, seasonId} filters post-Tier 4b)
│   ├── groups.js                        # Tier 13.1: getGroupsForUser, getGroupById, getJoinedGroupIds, getPendingInvites, buildGroupLeaderboard (accepts {leagueId, seasonId} filters post-Tier 4b)
│   ├── friends.js                       # Tier 13.1: getFriendshipBetween, friendStatusFrom, getViewerFriendIdSet (Tier 8.6 masking layer)
│   ├── response.js                      # Tier 13.1: attachResponseHelpers middleware (res.ok / res.created / res.noContent)
│   ├── errors.js                        # Tier 13.1: AppError class + factories (notFound, forbidden, badRequest, conflict, …)
│   ├── errorMiddleware.js               # Tier 13.1: global Express error handler — translates AppError to JSON response shape
│   ├── openapi.js                       # Tier 9.3: OpenAPI 3.0 spec generator (zod → @asteasolutions/zod-to-openapi). Mounted at /api/openapi.json + /api/docs in dev only
│   ├── cache.js                         # Tier 4b: generic TTL Map cache (key, ms) used by lib/footballApi.js fixture + live-match caches
│   ├── footballApi.js                   # Tier 4b: football-data.org v4 client. getCompetitions / getFixtures / getLiveMatches / getMatchesByIds. Sliding-window rate-limit (Tier 18: 20 req/min default for TIER_ONE plan, env-driven via FOOTBALL_DATA_RATE_LIMIT). Provider-agnostic surface — swap by replacing this file
│   ├── fixtureStatus.js                 # Tier 4b: STATUS_MAP + mapUpstreamStatus(raw) → 'scheduled'/'in-progress'/'finished'/'postponed'/'cancelled'; deriveResultFromFixture(fixture, localStatus) → 'home'/'away'/'draw'/null. Single source of truth shared by manual sync + live-score job
│   ├── scheduler.js                     # Tier 4b Chunk 2: node-cron wrapper. register(name, cron, handler) → wraps handler in pg_try_advisory_lock(crc32(jobName)). start() is a no-op when NODE_ENV=test
│   ├── jobs/                            # Scheduled job handlers, each exporting {run}
│   │   ├── syncFixtures.js              # Daily 03:00 UTC. Iterates active leagues → LeagueService.syncFixtures(leagueId). Early-returns when FOOTBALL_DATA_API_KEY unset
│   │   ├── syncLiveScores.js            # Every 30 s (Tier 18). Cheap COUNT cost-gate early-returns when no local game is in-progress AND no scheduled kickoff falls in [now − 4h, now + 2h]; otherwise: global ?status=LIVE,IN_PLAY,PAUSED call → GameService.applyLiveUpdate per match + ?ids= reconcile pass for IN_PLAY → FINISHED + SCHEDULED → IN_PLAY missed kickoffs
│   │   └── reconcileInProgressGames.js  # Every 3 min (Tier 18; was 5 min on free tier; added 2026-05-19, §8.22). Self-gated — early-return when no local status='in-progress' rows. Otherwise: defensive ?ids= sweep regardless of LIVE-filter membership. Closes the upstream-?status=-filter-staleness gap. Idempotent — no-op when local state matches canonical
│   └── ml/                              # Tier 17: in-process ML inference. Replaces the Python Container Apps Job
│       ├── eloMath.js                   # Pure Elo math (K=20, INITIAL=1500, HFA=0). expectedHomeScore / actualScores / updateElos / eloDelta. JS port of ml/scorecast_ml/elo/engine.py (parity-tested)
│       ├── xgboostInference.js          # XGBoost native JSON tree walker + softmax. Zero deps. Handles multi:softprob via tree_info accumulation. parseBaseScore defaults to 0 (XGBoost 2.x hex-encoded base_score). Defensive non-finite probabilities guard
│       ├── normalize.js                 # toThreeWay(p_h, p_d, p_a) → DECIMAL(3,2) trio summing to 1.0. Clip [0.01, 0.99] → round → rebalance against largest-RAW class → nudge off (0.50, 0.00, 0.50) sentinel
│       └── models/                      # Trained model JSON dumps committed to git; consumed by xgboostInference.loadModel
│           └── PL_elo.json              # XGBoost native dump (615 trees, ~1.5 MB). Produced by `python -m scorecast_ml train --league PL`
│
├── middleware/
│   ├── requestId.js                     # Tier 5.4: assigns req.id + req.log child; echoes X-Request-Id header
│   ├── csrf.js                          # Tier 6.7: double-submit (sc_csrf cookie + X-CSRF-Token header). EXEMPT_PATHS for unauth mutations. timingSafeEqual compare.
│   ├── auth.js                          # Tier 13.1: authMiddleware + requireAdmin (sc_access cookie → req.user). HS256-pinned jwt.verify
│   ├── optionalAuth.js                  # Anonymous-browse variant: tries to decode sc_access; if valid, sets req.user; otherwise passes through with req.user=null. NEVER 401s. Used on every public-read GET route
│   ├── rateLimit.js                     # Tier 13.1: 8 express-rate-limit instances (login/register/clientError/comment/friendRequest/pick/forgotPassword/publicRead) + skipInTest predicate
│   ├── auditLog.js                      # Tier 4b Chunk 3: auditMutation(action, entityType) middleware factory. Wraps every /api/admin/* mutating route. Fires AuditLogService.record via res.on('finish'). NEVER throws back into the request lifecycle
│   └── asyncHandler.js                  # Tier 13.1: wraps async route handlers so thrown AppError flows to errorMiddleware
│
├── routes/                              # Tier 13.2: Express routers mounted at /api (each owns one domain)
│   ├── auth.js                          # /register, /login, /auth/{verify-email, forgot-password, reset-password, refresh, logout, 2fa/verify}
│   ├── client-errors.js                 # /client-errors (CSRF-exempt; logs frontend exceptions)
│   ├── me.js                            # /me, /me/onboarding-completed, /me/2fa/{setup, confirm, disable}, /me/email, /me/password
│   ├── games.js                         # /games (optionalAuth; ?leagueId=&seasonId= filters), /games/:id/result, /games/:id/comments (optionalAuth on GET)
│   ├── picks.js                         # /picks (CRUD)
│   ├── groups.js                        # /groups (CRUD + invite/accept/decline/transfer/visibility/discover/join/leave). /discover registered BEFORE /:groupId
│   ├── leaderboard.js                   # /leaderboard (optionalAuth; ?groupId=&leagueId=&seasonId=&orderBy=&offset=&limit= — query validated inline via leaderboardQuerySchema)
│   ├── friends.js                       # /friends + /friends/:id/{accept, decline}
│   ├── users.js                         # /search (optionalAuth), /users/:username/profile (optionalAuth; privacy gate in UserService)
│   ├── comments.js                      # /comments/:id (edit/delete) + reactions
│   ├── notifications.js                 # /notifications, /notifications/:id/read, /notifications/read-all
│   ├── leagues.js                       # Tier 4b Chunk 3: GET /api/leagues (public, optionalAuth + publicReadLimiter). Returns active leagues with seasons[]
│   ├── admin.js                         # /admin/{games, users, cache-stats, leagues, leagues/:id/sync, audit-log} + bulk endpoints. Every mutation wrapped by auditMutation()
│   ├── health.js                        # /healthz (root path; no /api prefix)
│   └── docs.js                          # /api/openapi.json + /api/docs Swagger UI (dev-only)
│
├── services/                            # Tier 13.4: pure domain logic (no req/res). Routes parse → call → respond.
│   ├── NotificationService.js           # notify (never throws), listForUser, markRead, markAllRead
│   ├── BadgeService.js                  # awardBadge, evaluateBadges (uses NotificationService for badge-earned toasts)
│   ├── LeaderboardService.js            # Wraps lib/leaderboardCache: buildKey(scope, {leagueId, seasonId}) → 'overall:l:<id|*>:s:<id|*>' or 'group:<groupId>:l:<id|*>:s:<id|*>'; getOverall/getOverallForViewer (Tier 8.6 masking) / getForGroup/getForGroupForViewer / invalidate('all' | key) / invalidatePrefix(prefix)
│   ├── CommentService.js                # listForGame, create, edit, remove, react, unreact (CommentReaction ops)
│   ├── PickService.js                   # createPick, listForUser, deletePick (calls Badge + Leaderboard hooks)
│   ├── GameService.js                   # CRUD + setResult/bulkSetResult/cascadeDelete/applyLiveUpdate (notify + badge eval + cache invalidate on result transitions). status ↔ result sync (set 'home/away/draw' → status='finished'; clear → status='scheduled')
│   ├── GroupService.js                  # CRUD + invite/accept/decline/join/leave/transfer/visibility + cascadeDelete + maskMembersForAnon (Tier 8.6) + discoverPublic/getVisible accept viewer=null for anon
│   ├── UserService.js                   # cascadeDelete + admin list/role/delete + bulkAction (filters self id → skipped[]) + getProfileByUsername (Tier 8.6 visibility gate)
│   ├── LeagueService.js                 # Tier 4b + Tier 17: CRUD + ensureSeason + upsertFixture (calls ensureTeamExists on both teams every upsert — newly-promoted clubs land in `teams` at MIN(elo)) + syncFixtures + ensureTeamExists helper
│   ├── PredictionService.js             # Tier 17: reactive ML cascade. onResultUpdated (idempotent + reversible via per-game snapshot) runs INSIDE the result-capture transaction; rePredictFutureFixtures runs AFTER commit and rewrites probabilities for upcoming fixtures involving either team. Per-league model cache. See §8.17
│   └── AuditLogService.js               # Tier 4b Chunk 3: record({action, entityType, entityId, actorUserId, before, after, requestId, statusCode}) with 4KB payload truncation (replaces oversize payloads with {_truncated, _bytes, preview}) + listPaginated(limit, offset)
│
├── models/                              # Sequelize models — one file per table
│   ├── index.js                         # Sequelize init + associations + initDatabase + umzug shim (runMigrations) + seedDatabase
│   ├── User.js                          # bcrypt beforeCreate/beforeUpdate hooks; displayName, bio, email, emailVerifiedAt, loginAttempts, lockedUntil, totpSecret, totpEnabledAt, totpRecoveryCodes, profileVisibility ENUM, onboardingCompletedAt
│   ├── Game.js                          # leagueId/seasonId/sourceId/status ENUM/homeScore/awayScore/kickoffTz/halfTimeReached/phase (Tier 4b); drawProbability DECIMAL(3,2) NOT NULL DEFAULT 0 + result ENUM extended to ('home','away','draw') (draw-scoring tier)
│   ├── Group.js                         # visibility ENUM('private'|'public')
│   ├── GroupMember.js                   # composite PK (groupId, userId)
│   ├── GroupInvite.js
│   ├── Pick.js                          # unique (userId, gameId)
│   ├── Badge.js                         # unique (userId, slug)
│   ├── Friendship.js                    # pending|accepted; unique pair via functional index
│   ├── Comment.js                       # indexed by gameId; editedAt (Tier 8)
│   ├── CommentReaction.js               # unique (commentId, userId, emoji); indexed by commentId (Tier 8)
│   ├── Notification.js                  # indexed by (userId, read, createdAt)
│   ├── EmailVerificationToken.js        # Tier 6.5: userId FK ON DELETE CASCADE, tokenHash unique, expiresAt, consumedAt
│   ├── PasswordResetToken.js            # Tier 6.4: same shape as EmailVerificationToken
│   ├── RefreshToken.js                  # Tier 6.8: userId FK ON DELETE CASCADE, tokenHash unique, expiresAt, revokedAt, userAgent
│   ├── League.js                        # Tier 4b: id, name, sourceProvider, sourceLeagueId, country, logoUrl, active, timestamps. Unique on (sourceProvider, sourceLeagueId)
│   ├── Season.js                        # Tier 4b: id, leagueId FK, year, startsAt, endsAt, current. Unique on (leagueId, year)
│   ├── Team.js                          # Tier 17: id, name (canonical football-data.org form), leagueId FK CASCADE, elo NUMERIC(8,2) DEFAULT 1500, gamesPlayed, lastMatchDate. Unique on (name, leagueId). Bootstrapped by seeders/20260522000001-seed-teams-from-elo-history.js; maintained by PredictionService.onResultUpdated + LeagueService.ensureTeamExists auto-insert at MIN(elo)
│   └── AuditLog.js                      # Tier 4b Chunk 3: actorUserId (SET NULL on user delete), action (e.g. 'admin.game.delete'), entityType, entityId, before JSONB, after JSONB, requestId, statusCode
│
├── badges/
│   └── catalog.js                       # Source of truth for badge slugs/names/emojis (server + frontend)
│
├── validation/
│   ├── schemas.js                       # All zod schemas, one per POST/PUT route
│   └── middleware.js                    # validate(schema) → 400 with structured issues on failure
│
├── src/                                 # React frontend
│   ├── main.jsx                         # React.createRoot bootstrap; provider stack: NotificationProvider → AuthProvider → AuthGateProvider → DataProvider → App (Tier 13.6 + Tier 11 gate); mounts ErrorBoundary, installs clientErrorReporter, calls initSentry(); SYNCHRONOUSLY applies stored theme before React mounts (no FOUC)
│   ├── App.jsx                          # ~71 LOC after Tier 13 Chunk 6 — pure layout shell: gradient chrome + skip-to-content link + status banner + 3-way switch (Skeleton/Auth/Dashboard view)
│   ├── views/                           # Tier 13 Chunk 6 — view-level components consumed by App.jsx
│   │   ├── SkeletonView.jsx             # placeholder shown while the initial dashboard fetch is in flight; carries <main id="main"> landmark
│   │   ├── AuthView.jsx                 # Landing (default) OR login/register/forgot/reset/2FA challenge grid (`showAuth=true`). Sets `localStorage.sc_visited` on first successful sign-in so returning users skip Landing
│   │   └── DashboardView.jsx            # the authenticated/anon UI: Sidebar + top utility bar (SearchBar, ThemeToggle, NotificationBell, UserMenu OR sign-in pill buttons) + view switch. Consumes useAuth/useData/useGames directly
│   ├── contexts/                        # Tier 13.6 React Context providers + Tier 11 gate
│   │   ├── NotificationContext.jsx      # status banner + scorecast:client-error subscription (3.5s toast on render-error / window-error)
│   │   ├── AuthContext.jsx              # user, authData, authView, 2FA flow, URL token consumption, `browseAsGuest` flag (persisted to localStorage.sc_browse_as_guest), `showAuth` flag, `clearSession` for useRequest 401 handler, handleChangeEmail, handleChangePassword
│   │   ├── AuthGateContext.jsx          # Tier 11: anonymous-action gate. `gate(label)` opens <SignInModal>; for textarea/composer surfaces use <InlineGatePanel /> directly
│   │   └── DataContext.jsx              # games/picks/groups/leaderboard/friends/discoverGroups/invites/profile + `gameFilters` (league+season for games view) + `leaderboardFilters` (league+season for stats — separate axis from games) + `profileError` for drawer "unavailable" sheet + loadAnonDashboard (parallel fetch of public endpoints) + every mutation handler. Watches user → null to clear its own slots
│   ├── hooks/                           # Tier 13.7 custom hooks
│   │   ├── useAuth.js, useData.js, useNotifications.js, useAuthGate.js   # re-exports of their context's hook
│   │   ├── useRequest.js                # CSRF + 401 refresh-retry + session-expired (depends on AuthContext)
│   │   ├── useGames.js                  # segmented upcoming/live/completed + refreshGames
│   │   ├── usePicks.js                  # pickMap memo (full pick object keyed by gameId — see §11.4 gotcha) + submit/remove
│   │   └── useGroups.js, useLeaderboard.js, useFriends.js   # selector hooks on useData
│   ├── index.css                        # @tailwind base/components/utilities + Tier 11 design tokens (`:root` dark + `:root[data-theme='light']` light) + brand glow shadows + iOS 16px form-input fix + scroll-bar styling
│   ├── lib/
│   │   ├── clientErrorReporter.js       # Tier 5.4b: window error + unhandledrejection listeners; throttled (5/60s) POST to /api/client-errors; dispatches scorecast:client-error DOM event
│   │   ├── sentry.js                    # Tier 5.4b: dynamic import('@sentry/react') gated on VITE_SENTRY_DSN (Vite tree-shakes when unset)
│   │   ├── apiClient.js                 # Tier 13.3: bare apiFetch helper used by AuthContext for /api/auth/* paths (no refresh-retry needed)
│   │   ├── cookies.js                   # Tier 6.7: getCookie(name) — reads document.cookie for X-CSRF-Token header injection
│   │   ├── theme.js                     # Tier 11 Chunk 1: applyTheme/getStoredTheme/setStoredTheme. localStorage.sc_theme; legacy 'system' normalizes to 'dark'
│   │   └── a11y.js                      # Tier 11 Chunk 4: useReducedMotion (prefers-reduced-motion media query) + useFocusOnRouteChange
│   ├── utils/
│   │   ├── scoring.js                   # MIRROR of server's scorePick; see §8.1. Plus pickStatus, expectedWinPoints, expectedDrawPoints (returns null for unconfigured games so PayoutMatrix renders +x/+y placeholders not misleading +0)
│   │   └── time.js                      # formatCountdown, useCountdown hook, timeAgo, matchMinute(kickoff, {halfTimeReached, phase}), useMatchMinute (live-minute estimate; Tier 4b Chunk 2)
│   └── components/
│       ├── ErrorBoundary.jsx            # Tier 5.4b: class component wrapping <App />; reports via reportClientError + Sentry captureException; raw message gated on import.meta.env.DEV
│       ├── Sidebar.jsx                  # Left-column dashboard nav. Desktop: 240px ↔ 64px collapsible (persisted localStorage.sc_sidebar_collapsed). Mobile (< md:): off-canvas drawer triggered by top-bar hamburger. Items render <button role="tab"> for Playwright compatibility
│       ├── UserMenu.jsx                 # Avatar + username in top utility bar; opens role="menu" dropdown with "View profile" + "Sign out" (latter pipes through setConfirmingLogout)
│       ├── ThemeToggle.jsx              # Tier 11 Chunk 1: Light/Dark switch. Reads/writes via lib/theme.js
│       ├── Landing.jsx                  # Marketing landing for first-time anonymous visitors (hero with glowing BANTRYX wordmark + dual CTAs + 3-card stat strip + 4-card feature grid + how-it-works + bottom CTA). 3rd CTA "Or just browse as a guest →" flips browseAsGuest=true
│       ├── SignInModal.jsx              # Tier 11: anon button-action gate (`<Dialog>` from ui/). Opens with label like "Sign in to pick"
│       ├── InlineGatePanel.jsx          # Tier 11: composer-surface gate. Replaces textareas + "Create group" form with a small "Sign in to …" card
│       ├── OnboardingTour.jsx           # Tier 11 Chunk 4: 4-step <Dialog> (picks → scoring → leaderboard → groups). Mounts when user && !browseAsGuest && !user.onboardingCompletedAt && view==='games' && games.length>0. Skip + Done both POST /api/me/onboarding-completed
│       ├── GameCard.jsx                 # Pick UI (3-branch outcomeBadge: Correct / Drew / Missed), countdown chip, live-minute pill (pulsing red "Live · 67'" when status='in-progress'), per-team tabular scores, undo-pick, CommentThread footer, PayoutMatrix preview
│       ├── GameFiltersBar.jsx           # Tier 4b Chunk 3: league + season picker for games view. Reads ?league=PL&season=2026 (sourceLeagueId code, not UUID — links shareable across DB rebuilds). Writes via history.replaceState. Mutates DataContext.gameFilters
│       ├── LeaderboardFiltersBar.jsx    # Same UX as GameFiltersBar but writes to ?lbLeague=&lbSeason= URL keys + DataContext.leaderboardFilters. Mounts on Leaderboard AND My Picks tabs (one global "stats scope" filter)
│       ├── PayoutMatrix.jsx             # 2×3 preview matrix on upcoming GameCards. Rows Home/Away picks × cols Win/Draw/Lose actual outcomes. Draw row shows +x/+y placeholders when drawProbability=0
│       ├── GroupCard.jsx                # Member grid + Avatars, invite form, Public/Private badge, leave/transfer/delete menu
│       ├── GroupLeaderboardCard.jsx     # Sort select + pagination + viewer-row anchor. Anon viewers see masked rows (privacy layer)
│       ├── LeaderboardCard.jsx          # Exports LeaderboardRow (Avatar + clickable for profile drawer; honors entry.isMasked → italic + private chip + click suppressed)
│       ├── InviteRow.jsx
│       ├── LoginForm.jsx                # Tier 6: 'Forgot password?' link + handoff to 2FA challenge on login response
│       ├── RegisterForm.jsx              # Tier 6.5: email field required
│       ├── ForgotPasswordForm.jsx        # Tier 6.4: email input → POST /api/auth/forgot-password → static success message (no enumeration)
│       ├── ResetPasswordForm.jsx         # Tier 6.4: new-password input + token from URL → POST /api/auth/reset-password
│       ├── TwoFactorSetup.jsx            # Tier 6.9: Profile section; idle → setup (QR + recovery codes + .txt download) → confirm; also handles disable flow
│       ├── TwoFactorChallenge.jsx        # Tier 6.9: login challenge UI; TOTP code OR recovery code toggle
│       ├── ChangeEmailPanel.jsx          # Profile Settings: current email + Verified/Not-verified badge + expand → new-email + currentPassword form → PATCH /api/me/email
│       ├── ChangePasswordPanel.jsx       # Security-hardening batch M5: current/new password + show-hide toggle → POST /api/me/password (server revokes all other refresh tokens + re-mints calling client's cookies)
│       ├── PicksHistory.jsx             # Filtered by leaderboardFilters (client-side: drops rows where game.leagueId/seasonId don't match). 3-branch statusBadge (Won/Drew/Missed)
│       ├── EmptyState.jsx
│       ├── Skeleton.jsx                 # SkeletonGameCard + SkeletonLeaderboardRow (also re-exported from ui/Skeleton.jsx)
│       ├── ConfirmModal.jsx             # Backdrop + Esc-close, used by logout + admin deletes + bulk confirm. z-50 stacking; sidebar drawer Escape handler defers when modal is open (see CLAUDE.md "Modal stacking")
│       ├── Avatar.jsx                   # Deterministic initial-on-color circle (FNV-1a hash of LOWERCASED username → HSL). displayName drives letter; username drives color (renames don't shuffle colors)
│       ├── SearchBar.jsx                # Debounced (250ms) /api/search, type-grouped dropdown
│       ├── ProfileView.jsx              # Header (Avatar + displayName + username), stats, BadgeWall, recent picks, friend button, Settings (Privacy radio + ChangeEmailPanel + ChangePasswordPanel + TwoFactorSetup + display-name/bio inline edit)
│       ├── ProfileDrawer.jsx            # Right-side drawer wrapping ProfileView; renders "This profile is unavailable" sheet when DataContext.profileError is set (Tier 8.6)
│       ├── BadgeWall.jsx
│       ├── FriendsList.jsx              # Returns null for anonymous viewers
│       ├── CommentThread.jsx            # Comments with edit, delete, 5-emoji reactions (per-viewer state). Anon: composer replaced with <InlineGatePanel>; reaction clicks open <SignInModal>
│       ├── NotificationBell.jsx         # 30s polling, dropdown. Hidden in anon mode
│       ├── ui/                          # Tier 11 design system primitives (Radix wrappers)
│       │   ├── Button.jsx, Card.jsx, Dialog.jsx, DropdownMenu.jsx, Popover.jsx, Select.jsx, Tabs.jsx, Toast.jsx, Tooltip.jsx, Switch.jsx, Checkbox.jsx, Radio.jsx
│       │   ├── Input.jsx, PasswordInput.jsx, Textarea.jsx, Badge.jsx, Avatar.jsx, Skeleton.jsx, Spinner.jsx
│       └── admin/
│           ├── AdminPanel.jsx           # Tab navigator: Games / Users / Leagues / Audit log / Cache stats
│           ├── GameManager.jsx          # Per-row + bulk-select with action bar. Create/edit form includes drawProbability + per-row Draw button (warning tone). Read-only row shows H% / D% / A%
│           ├── UserManager.jsx          # Per-row + bulk-select with action bar (self auto-skipped)
│           ├── LeagueManager.jsx        # Tier 4b Chunk 1: CRUD + per-league "Sync fixtures now" button → POST /api/admin/leagues/:id/sync
│           └── AuditLog.jsx             # Tier 4b Chunk 3: paginated newest-first; per-row collapsible <details> payload preview
│
├── tests/e2e/                           # Tier 5.5 + 5.5b + per-endpoint API suite — Playwright (~270 tests across 22 specs)
│   ├── playwright.config.js             # Runs against `npm run build && node server.js` on :3100 with NODE_ENV=test. workers:1 (shares Sequelize pool)
│   ├── pick-and-result.spec.js          # register → pick → admin set result → leaderboard updates
│   ├── group-lifecycle.spec.js          # create → invite → accept → transfer → delete
│   ├── comment-reaction.spec.js         # post → edit → react → delete
│   ├── auth-security.spec.js            # Tier 5.5b: lockout + password reset cascade + CSRF reject
│   ├── friend-system.spec.js, notifications-badges.spec.js, leaderboard-scoring.spec.js, admin-panel.spec.js  # Tier 5.5b
│   ├── profile-privacy.spec.js          # Tier 8.6: friends-only/private gates + leaderboard masking
│   ├── change-email-panel.spec.js, change-password-panel.spec.js  # security-hardening batch UI smokes
│   ├── api/                             # Per-endpoint boundary suite (security-hardening batch follow-on): one file per route file
│   │   ├── auth.spec.js, me.spec.js, games.spec.js, picks.spec.js, comments.spec.js, groups.spec.js
│   │   ├── friends.spec.js, leaderboard.spec.js, notifications.spec.js, users.spec.js, leagues.spec.js
│   │   ├── admin.spec.js (largest — 14 endpoints × ~5 cases), client-errors.spec.js, health.spec.js
│   ├── screenshots/mobile.spec.js       # Visual regression
│   ├── helpers/
│   │   ├── auth.js                      # UI register/login/logout + dismissLanding + dismissOnboardingTour
│   │   ├── selectors.js                 # closestCard etc.
│   │   ├── admin.js                     # openAdminTab
│   │   ├── api.js                       # apiLogin/apiAnon/stripCsrf + setGameResult/createPick/getLeaderboard + DB helpers (clearPicksAndBadges, clearFriendships, resetUserLockout, insertPasswordResetToken, clearComments, clearGroupsCreatedBy, clearLeaguesByName, clearAuditLog, getUserId, deleteUserByUsername, clear2faForUser, setUserPassword, updateUserFields, clearGameResults, clearNotifications)
│   │   └── apiAssertions.js             # assertOk/assertUnauthorized/assertForbiddenWithoutAdmin/assertCsrfRejected/assertValidationError/assertNotFound/assertNoContent/expectShape one-call helpers
│   └── fixtures/                        # data.js (USERS + GAMES constants), env.js (DB URL), seed.js (deterministic seed users + games + onboardingCompletedAt pre-set), global-setup.js (migrate + truncate + reseed)
│
├── ml/                                  # Tier 17 trim: training-only Python (deleted: Dockerfile + ml-job.bicep + ml-deploy.yml + Container Apps Job + ACR repo + inference/ + db/ + features/ + scripts/ subpackages). Runtime inference moved to lib/ml/ (in-process JS). See §8.17
│   ├── README.md                        # 1-page "how to retrain" doc. `cd ml && python -m scorecast_ml train --league PL` → ml/data/models/PL_elo_<date>.json → cp to lib/ml/models/PL_elo.json → commit
│   ├── requirements.txt                 # Slimmed: pandas, numpy, xgboost, scikit-learn, typer, pydantic-settings, structlog, python-dateutil (+ pytest, ruff). Dropped: httpx, tenacity, psycopg, rapidfuzz, joblib, pyarrow
│   ├── data/raw/PL_*.csv                # Public-domain Football-Data.co.uk corpus, ~3 MB, 32 seasons, committed via .gitignore negation `!ml/data/raw/*.csv`
│   ├── data/models/                     # Train output (gitignored). The production model lives at lib/ml/models/, committed by hand after each retrain
│   ├── scorecast_ml/
│   │   ├── cli.py                       # Single `train` subcommand. Inlines strict reconcile + 2-feature build + season split
│   │   ├── train/model.py               # XGBoost wrapper + save_as_json (native JSON export, no joblib)
│   │   ├── elo/engine.py                # Source of truth for Elo math. lib/ml/eloMath.js parity-tests against this
│   │   ├── ingest/football_data_uk.py   # FDCO CSV parser (tolerates ragged trailing columns)
│   │   └── reconcile/teams.json         # Per-league alias map. Mirrored to seeders/reconcileMap.json for the JS seeder
│   └── tests/test_elo_engine.py         # Python Elo determinism + min_rating strategy. Mirror of tests/eloMath.test.js
│
├── scripts/                             # Operator tools (committed to repo for ops reuse)
│   ├── query-teams.mjs                  # Tier 17: prod-safe Sequelize query helper. SSL-aware. Prints top 10 by Elo (no args) or specific teams by name
│   ├── find-game.mjs                    # Tier 17: look up a game by home + away team names; surfaces id + result + snapshot/appliedResult state
│   ├── repair-test-game-elo.mjs         # Tier 17: atomic transaction that clears a game's result + Elo snapshot + appliedResult AND deletes the involved team rows so the seeder restores at canonical Elo on next run
│   └── backfill-probabilities.mjs       # Tier 17: drives PredictionService's predict + toThreeWay flow over every upcoming fixture in a league (CLI version of the reactive cascade). Supports --dry-run + --league. Functionally identical to rePredictFutureFixtures; useful after retrain
│
├── seeders/                             # sequelize-cli seeders. Idempotent via ON CONFLICT
│   ├── 20260513000001-seed-password-backfill.js  # Tier 6: bcrypt-hash any plaintext passwords in users table
│   ├── 20260522000001-seed-teams-from-elo-history.js  # Tier 17: walks 32-season PL CSV history chronologically, applies seeder's identical-to-Python Elo math, upserts 51 teams (ON CONFLICT DO NOTHING preserves live Elo built by cascade)
│   └── reconcileMap.json                # Tier 17: alias map (CSV name → canonical football-data.org name). Mirror of ml/scorecast_ml/reconcile/teams.json
│
├── tests/                               # Tier 17: node:test unit tests (in addition to e2e under tests/e2e/)
│   ├── eloMath.test.js                  # 16 tests — symmetry, sum-to-1, zero-sum, monotonicity, draw split, delta+update parity
│   ├── normalize.test.js                # 10 tests — clip floor, sentinel nudge, residual on largest raw, sum-to-1
│   ├── xgboostInference.test.js         # 13 tests — tree walk, NaN default-left, malformed-tree throw, softmax stability, hex base_score, NaN guard
│   └── e2e/                             # Playwright (~270 tests)
│
└── dist/                                # `npm run build` output, served as static by server.js
```

---

## 5. Backend Architecture

### 5.1 Process Model

A single Node process listens on `PORT` (default `3000`). It does:

- **Static file serving** for the built frontend (`dist/`) via `express.static`, plus a catch-all `app.get('*')` that returns `dist/index.html` to support client-side routing.
- **JSON API** at `/api/*`.
- **In-process scheduler** (Tier 4b Chunk 2) — node-cron ticks the daily fixture sync (03:00 UTC) + 60-s live-score poll. Wrapped in `pg_try_advisory_lock(crc32(jobName))` so a future multi-replica deploy only runs each tick once.

There is **no separate worker process**, **no PM2 wrapper**. Restart = lose the in-memory rate-limit counters, lockout counters, leaderboard cache, fixture cache, and any pending in-flight cron tick (next tick recovers — fixture sync is idempotent, live-score self-recovers via the reconcile pass). **Graceful SIGTERM shutdown** is wired (Tier 20 Chunk 7): SIGTERM → `server.close()` (drain in-flight) → 25s race timeout → `scheduler.stop()` → `sequelize.close()` → `process.exit(0)`. `tini` forwards the signal correctly from the Dockerfile entrypoint. See §8.29.

**Trust proxy** — `app.set('trust proxy', 1)` is set in [server.js](server.js) so `req.ip` resolves to the real client IP through Cloudflare → Azure Container Apps ingress. Without this, every per-IP rate limiter would resolve to the proxy IP and effectively short-circuit. Set to `1` (single hop) deliberately, not `true`, so spoofed `X-Forwarded-For` headers from outside the trusted hop can't bypass limits.

### 5.2 Request Lifecycle

For every request:

```
1. requestId                                             // Tier 5.4: assigns req.id (UUID or inbound X-Request-Id),
                                                         //           attaches req.log = logger.child({reqId});
                                                         //           sets X-Request-Id response header.
2. pino-http                                             // Tier 5.4: one structured access-log line per request
                                                         //           (method, url, statusCode, responseTime, reqId).
3. compression()                                         // Tier 5.6: gzip when Accept-Encoding includes gzip
                                                         //           and the body exceeds the default 1 KB threshold.
4. helmet({ contentSecurityPolicy, frameguard:DENY, ...}) // Tier 6.2: CSP + HSTS + X-Frame-Options + nosniff.
5. cors({ origin: CORS_ORIGINS||true, credentials:true }) // Tier 6.1: env allowlist; throws on boot in prod when empty.
6. bodyParser.json()                                     // parses application/json
7. cookieParser()                                        // populates req.cookies
8. csrfMiddleware                                        // Tier 6.7: sets sc_csrf cookie if missing; enforces
                                                         //           X-CSRF-Token == sc_csrf on POST/PUT/PATCH/DELETE
                                                         //           unless path is in EXEMPT_PATHS.
9. express.static(dist/)                                 // serves built assets if path matches
10. (per-route) rate-limit | authMiddleware | requireAdmin | validate(schema)
11. Route handler                                        // typically async; uses Sequelize models + req.log
12. Response: res.json({...}) or res.status(N).json({error: '...'})
                                                         // pino-http logs the response with the same reqId
                                                         // and a level mapped from status (>=500 error, >=400 warn).
```

If the URL doesn't match any `/api/*` route, the catch-all `app.get('*')` returns `dist/index.html`. **The API routes must be registered before** the catch-all (they are).

### 5.3 Middleware

#### Request ID + Logger child — `requestId` (Tier 5.4)

Defined in [middleware/requestId.js](middleware/requestId.js). Runs **before every other middleware**. For each request:

- Reads inbound `X-Request-Id` if present and ≤200 chars; otherwise generates a UUID v4 via `crypto.randomUUID()`.
- Assigns `req.id` and echoes it back on the response (`X-Request-Id` header).
- Attaches `req.log = logger.child({ reqId: req.id })` — every handler uses this child logger so error lines are auto-tagged with the request ID.

Then `pino-http` runs to emit a single structured access log per request (`req: {id, method, url}`, `res: {statusCode}`, `responseTime`). Its `customLogLevel` maps `>=500` → `error`, `>=400` → `warn`, else `info`.

#### Authentication — `authMiddleware` (Tier 6.8: cookie-only)

Defined in [middleware/auth.js](middleware/auth.js) (extracted from server.js in Tier 13.1). Reads `req.cookies.sc_access` only — **Bearer-header auth was removed in Tier 6.8**.

Verifies the JWT with `jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })` — algorithm pinning added in the 2026-05-18 security batch (M4) as belt-and-braces against future jsonwebtoken vulnerabilities that might re-allow `alg:none`. On success, attaches the decoded payload `{id, username, role}` to `req.user`. On failure, returns `401 {error: 'Invalid token'}` or `401 {error: 'Authentication required'}`.

#### Optional authentication — `optionalAuth` (anonymous browse)

Defined in [middleware/optionalAuth.js](middleware/optionalAuth.js). Same JWT-decode logic as `authMiddleware` but **NEVER 401s** — on missing/invalid/expired token, sets `req.user = null` and calls `next()`. Used on every public-read GET route (`/api/games`, `/api/games/:id/comments`, `/api/leaderboard`, `/api/groups/discover`, `/api/groups/:id`, `/api/search`, `/api/users/:username/profile`, `/api/leagues`) so anonymous visitors can browse without an account. Service-layer code consults `req.user` to gate writes and apply per-viewer masking (Tier 8.6 profile privacy).

**Paired with `publicReadLimiter` (240 req/min/IP)** to keep an anonymous botnet from running up the read load. The authed code path on the same route is exempt from that limiter.

**Cookies issued by `setAuthCookies(res, user, {userAgent})`** (called by login, register, refresh, and 2FA verify):

| Cookie       | Type                         | Path        | HttpOnly                       | TTL     | Contents                                           |
| ------------ | ---------------------------- | ----------- | ------------------------------ | ------- | -------------------------------------------------- |
| `sc_access`  | JWT (HS256)                  | `/`         | yes                            | 15 min  | `{id, username, role}`                             |
| `sc_refresh` | opaque random (32 bytes hex) | `/api/auth` | yes                            | 30 days | raw value; SHA-256 hash stored in `refresh_tokens` |
| `sc_csrf`    | random 32-byte hex           | `/`         | **no** (frontend must read it) | 30 days | rotates only on explicit `clearCookie`             |

`Secure: true` is set on all three in production (`NODE_ENV === 'production'`); `false` in dev so HTTP works.

**Access JWT** is created by `createAccessToken(user)`:

```js
jwt.sign({ id, username, role }, JWT_SECRET, { expiresIn: 900 }); // 15 minutes
```

**Refresh token rotation**: every `POST /api/auth/refresh` revokes the inbound row (`refresh_tokens.revokedAt = NOW()`) and issues a fresh pair. Multiple concurrent sessions (different devices) each have their own active chain; logging in on a new device does **not** revoke other sessions.

**Force-logout-everywhere** uses `revokeAllUserRefreshTokens(userId)`, currently called only from password reset.

`JWT_SECRET` resolution:

- Read from `process.env.JWT_SECRET`.
- If absent **and** `NODE_ENV === 'production'` → server throws on startup (refuses to boot).
- If absent in dev → logs a warning and uses the literal `'scorecast-dev-only-do-not-use'`. Tokens issued under this secret are not portable across environments and are not safe in production.

#### Authorization — `requireAdmin`

Trivial: `if (req.user?.role !== 'admin') return 403`. Must always run **after** `authMiddleware`. Used by all `/api/admin/*` routes and by `POST /api/games/:gameId/result`.

#### Validation — `validate(schema)`

Factory in [validation/middleware.js](validation/middleware.js). Runs `schema.safeParse(req.body)`. On failure returns:

```json
{ "error": "Invalid request body", "issues": [{ "path": "homeProbability", "message": "..." }] }
```

On success it **replaces `req.body` with the parsed (sanitized, defaulted) value** so handlers can trust it. All input mutations from zod (`.trim()`, `.toLowerCase()`, coercions) take effect here.

Schemas live in [validation/schemas.js](validation/schemas.js): `registerSchema` (now includes `email`), `loginSchema`, `forgotPasswordSchema`, `resetPasswordSchema`, `setEmailSchema`, `totpConfirmSchema`, `totpVerifySchema`, `createGroupSchema` (with optional `visibility`), `inviteSchema`, `pickSchema`, `resultSchema`, `friendRequestSchema`, `visibilitySchema`, `commentSchema`, `createGameSchema`, `updateGameSchema`, `roleSchema`, `transferOwnerSchema`, `editProfileSchema`, `reactionSchema` (emoji ∈ `ALLOWED_EMOJIS`), `bulkGameSchema`, `bulkUserSchema`, `clientErrorSchema`.

#### Rate limiting (Tier 6.10 expanded the original three)

Seven limiters from `express-rate-limit`, all configured `standardHeaders: true, legacyHeaders: false`:

- `loginLimiter`: 5 / 15 min per IP. `POST /api/login`.
- `registerLimiter`: 3 / hour per IP. `POST /api/register`.
- `clientErrorLimiter` (Tier 5.4b): 30 / 5 min per IP. `POST /api/client-errors`. Tuned so a runaway client-side throw can't flood the server log.
- `commentLimiter` (Tier 6.10): 10 / min per IP. `POST /api/games/:gameId/comments`.
- `friendRequestLimiter` (Tier 6.10): 10 / 5 min per IP. `POST /api/friends/request`.
- `pickLimiter` (Tier 6.10): 30 / min per IP. `POST /api/picks`, `DELETE /api/picks/:id`.
- `forgotPasswordLimiter` (Tier 6.10): 3 / hour per IP. `POST /api/auth/forgot-password`.

In-memory store, so a server restart wipes the counters. Acceptable for a single-instance deployment; would need Redis-backed limits for horizontal scaling.

**Account lockout (Tier 6.6)** is layered on top of `loginLimiter`. After 5 failed password attempts against a single user, `users.lockedUntil` is set 15 min in the future. Subsequent attempts return the same generic 401 regardless of password correctness. Counter clears on successful login or password reset.

**`publicReadLimiter` (anonymous-browse follow-on)**: 240 req/min/IP. Applied to every `optionalAuth` GET route alongside `optionalAuth`. Caps the cost of anonymous browsing while still being generous enough that a real human dashboard refresh (~7 parallel fetches) doesn't trip it.

#### Audit log — `auditMutation(action, entityType)` (Tier 4b Chunk 3)

Factory in [middleware/auditLog.js](middleware/auditLog.js). Wrap every mutating `/api/admin/*` route:

```js
router.delete('/admin/games/:id',
  authMiddleware,
  requireAdmin,
  auditMutation('admin.game.delete', 'game'),  // ← here
  asyncHandler(async (req, res) => { ... }),
);
```

The middleware:

1. Captures `req.body` (or `req.params` for DELETE) BEFORE `validate()` runs, so the audit trail records the raw inbound payload not the zod-coerced version.
2. Subscribes to `res.on('finish')` so the final `res.statusCode` is recorded (200, 400, 409, 500 — the real outcome).
3. Calls `AuditLogService.record(...)` inside the finish handler. The service truncates payloads >4KB to `{_truncated, _bytes, preview: 'first 512 chars'}`.
4. **Never throws back into the request lifecycle** — an audit-log database outage cannot block a real admin action. Errors inside `record()` are caught and logged at `warn` level.

Auth-failed admin attempts (401/403 thrown before `auditMutation` runs) are **NOT audited** by design — `authMiddleware` runs first; if you want auth-failure audits you'd need to wire `auditMutation` earlier in the stack and accept that `req.user` won't be populated.

Action strings follow the dotted shape `admin.<entity>.<verb>` (e.g. `admin.game.delete`, `admin.league.sync`, `admin.user.bulk`) so the audit-log UI can filter cleanly.

#### CORS (Tier 6.1)

Allowlist driven by `CORS_ORIGINS` (comma-separated). Server **throws on boot** when `NODE_ENV=production` and the env is unset:

```js
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && corsOrigins.length === 0) {
  throw new Error('CORS_ORIGINS env var is required in production');
}
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true }));
```

Dev with `CORS_ORIGINS` unset falls back to `origin: true` so the Vite dev server (`:5173`) and direct curl both work without setup. `credentials: true` is always on — required so the browser sends `sc_access`/`sc_refresh` cookies on cross-origin XHRs.

#### Security headers — `helmet` (Tier 6.2)

Wired before `cors` in the middleware chain. CSP directives tuned for the current asset surface:

```
defaultSrc: 'self'
scriptSrc:  'self'
styleSrc:   'self', 'unsafe-inline'     // Tailwind injects inline <style>
imgSrc:     'self', data:               // Avatar.jsx generates data: SVG URIs
connectSrc: 'self', https://*.sentry.io, https://*.ingest.sentry.io
            (+ 'ws://localhost:5173', 'http://localhost:5173' in dev for Vite HMR)
fontSrc:    'self', data:
frameAncestors: 'none'
objectSrc:  'none'
```

`frameguard: 'deny'` overrides helmet's default `SAMEORIGIN` to `X-Frame-Options: DENY`. `crossOriginEmbedderPolicy` / `crossOriginOpenerPolicy` / `crossOriginResourcePolicy` are disabled because the strict defaults break embedded third-party assets (Sentry, future CDN images).

#### CSRF — `csrfMiddleware` (Tier 6.7)

Defined in [middleware/csrf.js](middleware/csrf.js). Implements **double-submit cookie**:

1. On every request, if `sc_csrf` cookie is absent, generate 32 random bytes (hex), set as a non-HttpOnly cookie (`Secure` in prod, `SameSite=Lax`, `Path=/`).
2. On state-changing methods (POST/PUT/PATCH/DELETE), require the cookie value to match the `X-CSRF-Token` header via `crypto.timingSafeEqual`. Mismatch → 403 `{error: 'CSRF token missing or invalid'}`.
3. Exempt routes (`EXEMPT_PATHS`):
   - `/api/login`, `/api/register` — pre-auth, set cookie on response.
   - `/api/auth/refresh` — same-site cookie path scoping is sufficient; no body.
   - `/api/auth/verify-email`, `/api/auth/forgot-password`, `/api/auth/reset-password` — pre-auth flows reached from an email link.
   - `/api/client-errors` — anonymous, append-only.

The CSRF cookie is intentionally readable by JavaScript (no `HttpOnly`) — the double-submit pattern relies on the same-origin policy preventing attackers from reading it cross-origin. `SameSite=Lax` already blocks the easy cross-origin POST attack vector; CSRF is the belt-and-braces.

Frontend reads the cookie via [src/lib/cookies.js](src/lib/cookies.js) `getCookie('sc_csrf')` and sends it as `X-CSRF-Token` on every state-changing `request()` call.

### 5.4 Route Catalogue

After Tier 13.2 each domain owns its own router file under [routes/](routes/); [server.js](server.js) mounts them at `/api` in this order:

1. **Auth (Tier 6 expanded + 2026-05-18 security batch)** — [routes/auth.js](routes/auth.js):
   - `POST /api/register` — accepts `{username, password, email, acceptedTerms: literal(true), acceptedTermsVersion: literal(CURRENT_TERMS_VERSION)}` (Tier 18 Chunk 6 added the last two — schema rejects with a missing-field error when a stale frontend bundle omits them). Stamps `termsAcceptedAt = NOW()` + `termsAcceptedVersion = <body value>` on create so new users never see the blocking `<TermsAcceptanceModal />`. Body response: `{user}` only (auth cookies set via `setAuthCookies`). Fires `sendVerificationEmail` fire-and-forget.
   - `POST /api/login` — accepts `{username, password}`. On lockout, on bad pw, and on unknown user, returns identical 401 `{error: 'Invalid credentials'}`. Lockout state mutates `users.loginAttempts` / `lockedUntil` (Tier 6.6). If `user.totpEnabledAt` is set, issues `sc_challenge` cookie and returns `{challenge: true}` instead of auth cookies (Tier 6.9). **Constant-time** (security batch H2) — always runs `bcrypt.compare` against either the real hash or `LOGIN_DUMMY_HASH` (generated once at module load), so response time is identical for nonexistent vs existing-wrong-password.
   - **`POST /api/auth/verify-email`** (Tier 6.5) — body `{token}`. Finds the matching `email_verification_tokens` row by SHA-256 hash; sets `users.emailVerifiedAt`; marks the token consumed.
   - **`POST /api/auth/forgot-password`** (Tier 6.4, rate-limited) — body `{email}`. **Always 204** regardless of whether the user exists or is verified. Token INSERT + email dispatch moved to `setImmediate(...)` (security batch M1) so 204 latency is dominated only by the user lookup that runs in all branches — closes the timing-based enumeration channel.
   - **`POST /api/auth/reset-password`** (Tier 6.4) — body `{token, password}`. Updates password (hook re-hashes), clears lockout state, **revokes all refresh tokens** for the user.
   - **`POST /api/auth/refresh`** (Tier 6.8) — reads `sc_refresh` cookie; revokes the row; issues a fresh pair. Returns 204 on success, 401 with cookies cleared on failure.
   - **`POST /api/auth/logout`** (Tier 6.8) — reads `sc_refresh`, marks the row revoked, clears both auth cookies. 204.
   - **`POST /api/auth/2fa/verify`** (Tier 6.9) — reads `sc_challenge` cookie (5-min JWT, HS256-pinned) + body `{code}` or `{recoveryCode}`. Recovery code verification uses `Promise.all(codes.map(bcrypt.compare))` (security batch L5) instead of early-exit loop, so latency is constant and the matched slot can't be inferred from response time. On success: clears `sc_challenge`, calls `setAuthCookies`, returns `{user}`. Used recovery codes are spliced out of `users.totpRecoveryCodes`.

2. **Client-error capture** — [routes/client-errors.js](routes/client-errors.js):
   - **`POST /api/client-errors`** (Tier 5.4b) — CSRF-exempt; soft-auth (logs `userId` if cookie token is valid, anonymous otherwise); structured-logs `clientError` payload at `error` or `warn` level per `level` field.

3. **Identity / account management** — [routes/me.js](routes/me.js):
   - `GET /api/me` — returns `{id, username, role, displayName, bio, email, emailVerifiedAt, twoFactorEnabled, profileVisibility, onboardingCompletedAt, termsAcceptedAt, termsAcceptedVersion, pushPreferences, joinedGroups, pendingInvites}`. Drives auth-state inference on the client. `termsAccepted*` fields (Tier 18 Chunk 6) gate the blocking `<TermsAcceptanceModal />` via `needsTermsAcceptance(user)` in [src/lib/terms.js](src/lib/terms.js).
   - `PUT /api/me` — `{displayName?, bio?, profileVisibility?}` edit. Body validated by `editProfileSchema` (display/bio reject bidi-override + zero-width + control codepoints — security batch L6 — while still allowing ZWJ for emoji like 👨‍💻). Invalidates leaderboard cache `'all'` when `displayName` OR `profileVisibility` actually changes (Tier 8.6 masking layer's view of stale visibility).
   - **`POST /api/me/onboarding-completed`** (Tier 11 Chunk 4) — sets `users.onboardingCompletedAt = NOW()` if null (idempotent). Called by both Skip and Done buttons in OnboardingTour.
   - **`POST /api/me/accept-terms`** (Tier 18 Chunk 6) — body `{version}`. Rejects with 400 if `version !== CURRENT_TERMS_VERSION` (stale-tab guard: a frontend bundle that's been open since before a terms bump can't silently accept an old version). Stamps `termsAcceptedAt = NOW()` + `termsAcceptedVersion = CURRENT_TERMS_VERSION`. Idempotent on the version match (each call refreshes the timestamp). Frontend `TermsAcceptanceModal.handleAccept` POSTs here, then merges the response into `user` so the modal unmounts.
   - **`PUT /api/me/push-preferences`** (PWA Chunk 4) — body `{prefs}`. Merges into `users.pushPreferences` JSONB (partial update — flipping one type's boolean doesn't clobber the others).
   - **`PATCH /api/me/email`** (Tier 6.5 + security batch H3) — body `{email, currentPassword}`. `currentPassword` required: bcrypt-compares before mutating, so a stolen access JWT alone can't pivot into account takeover. Sends "your email was changed" notification to the OLD address BEFORE overwriting, then updates `users.email`, clears `emailVerifiedAt`, fires fresh `sendVerificationEmail` to the NEW address.
   - **`POST /api/me/password`** (security batch M5) — body `{currentPassword, newPassword}`. Bcrypt-compares `currentPassword`, saves new password (Sequelize `beforeUpdate` re-hashes), calls `revokeAllUserRefreshTokens(userId)`, then `setAuthCookies` again so the calling client stays signed in while every OTHER refresh-bearing device is kicked out.
   - **`POST /api/me/2fa/setup`** (Tier 6.9 + security batch H3) — body `{currentPassword}`. Generates `speakeasy.generateSecret()`, returns `{qrCodeDataUrl, secret, recoveryCodes}`. Stores secret + bcrypt-hashed codes; `totpEnabledAt` stays null.
   - **`POST /api/me/2fa/confirm`** (Tier 6.9) — body `{code}`. Verifies against the pending secret; sets `totpEnabledAt`.
   - **`POST /api/me/2fa/disable`** (Tier 6.9) — body `{code}` or `{recoveryCode}`. Nulls all three `totp*` columns.

4. **Games** — [routes/games.js](routes/games.js):
   - `GET /api/games` — `optionalAuth` + `publicReadLimiter`. Query params `?leagueId=<uuid>&seasonId=<uuid>` (UUID-shape guard silently drops malformed values). Returns games ordered by date asc.
   - `POST /api/games/:gameId/result` — admin-only legacy result-set endpoint. `auditMutation('admin.game.set-result', 'game')`. Body `{result: 'home'|'away'|'draw'|null}` — `'draw'` added post-draw-scoring tier.
   - `GET /api/games/:gameId/comments` — `optionalAuth`; enriches each row with `editedAt`, `reactionCounts`, `yourReactions[]` (empty array for anon).
   - `POST /api/games/:gameId/comments` — authed + `commentLimiter`. Body validated by `commentSchema`.

5. **Picks** — [routes/picks.js](routes/picks.js): `POST /api/picks` + `GET /api/picks` + **`DELETE /api/picks/:id`** (Tier 8 — undo pick) + **`GET /api/picks/friends?gameId=<uuid>`** (Tier 18 Chunk 4 — every friend's picks within a ±30-day window, capped at 500 rows; optional `gameId` UUID-regex-validated; rows scored server-side via `scorePick` honoring Tier 17 pick-time probability snapshots; passed through Tier 8.6 `applyMasking` so a friend who has flipped to private still appears at their masked label).

6. **Groups** — [routes/groups.js](routes/groups.js), in this order:
   - `GET /api/groups` (authed: caller's joined groups; anon: 401)
   - **`GET /api/groups/discover`** (`optionalAuth` + `publicReadLimiter`) — **must come before `/:groupId`** so Express doesn't match `discover` as a path param. Anon sees all public groups; authed sees public groups they're not in.
   - `GET /api/groups/:groupId` (`optionalAuth`). Anon: 404 if private (avoids leaking existence); public: returns group with `maskMembersForAnon` projection.
   - `POST /api/groups` + invite/accept/decline endpoints + `POST /api/groups/:groupId/join` + `POST /api/groups/:groupId/leave` + `POST /api/groups/:groupId/transfer` + `DELETE /api/groups/:groupId` + `POST /api/groups/:groupId/visibility`.
   - **`GET /api/groups/:groupId/comments`** (Tier 18 Chunk 5; `optionalAuth` + `publicReadLimiter`) — anon-readable for public groups; **404** (not 403) for non-members of private groups to avoid leaking existence. Returns the same row shape as the game-scoped endpoint: `{id, gameId: null, groupId, userId, username, body, createdAt, editedAt, reactionCounts, yourReactions}`.
   - **`POST /api/groups/:groupId/comments`** (Tier 18 Chunk 5; authed + CSRF + `commentLimiter`). Membership enforced in `CommentService.create` (403 for non-members even on public groups — write is member-only by design). On success, fires `fanOutGroupComment` (Tier 18 Chunk 5) — every OTHER group member gets a `'group-comment'` push/bell notification with `link: '/?view=groups&groupId=<id>'`.

7. **Leaderboard** — [routes/leaderboard.js](routes/leaderboard.js): `GET /api/leaderboard?groupId=&leagueId=&seasonId=&orderBy=&offset=&limit=` — `optionalAuth` + `publicReadLimiter`. Query validated **inline** via `leaderboardQuerySchema.safeParse(req.query)` (the shared `validate()` middleware only handles `req.body`). Both `LeaderboardService.getOverallForViewer` and `getForGroupForViewer` apply Tier 8.6 masking before responding.

8. **Search** — [routes/users.js](routes/users.js): `GET /api/search?q=&type=` (`optionalAuth`). Min 2 chars; 5 results per type; iLike substring across `username`/`displayName`/group `name`/game `homeTeam`+`awayTeam`. Returns `profileVisibility` on each user row so the client can render appropriately even for friend-request flows (masking the username on the client side is the consumer's responsibility there).

9. **Profiles** — [routes/users.js](routes/users.js): `GET /api/users/:username/profile` (`optionalAuth`). Visibility gate in `UserService.getProfileByUsername` returns identical 404 for both friends-gated-out and private (no friend-graph probing through response codes). Admin override: admins always see unmasked.

10. **Friends** — [routes/friends.js](routes/friends.js): `POST /api/friends/request`, `/accept`, `/decline`, `DELETE`, `GET /api/friends`.

11. **Comments** — [routes/comments.js](routes/comments.js): `PUT /api/comments/:id` (edit), `DELETE /api/comments/:id`, `POST /api/comments/:id/reactions`, `DELETE /api/comments/:id/reactions/:emoji`.

12. **Notifications** — [routes/notifications.js](routes/notifications.js): `GET /api/notifications`, `POST /:id/read`, `POST /read-all`.

13. **Leagues (public)** — [routes/leagues.js](routes/leagues.js): `GET /api/leagues` — `optionalAuth` + `publicReadLimiter`. Returns active leagues with their `seasons[]` (id, year, current). Used by GameFiltersBar + LeaderboardFiltersBar.

14. **Admin** — [routes/admin.js](routes/admin.js). Every mutation route wrapped by `auditMutation(...)`:
    - **Games**: `POST/PUT/DELETE /api/admin/games`, `POST /api/admin/games/bulk` (cap 500 ids; actions `delete` and `setResult`).
    - **Users**: `GET /api/admin/users`, `POST /api/admin/users/:id/role`, `DELETE /api/admin/users/:id`, `POST /api/admin/users/bulk` (cap 100 ids; actions `promote`/`demote`/`delete`; self-id filtered to `skipped[]`).
    - **Leagues** (Tier 4b Chunk 1): `GET/POST/PUT/DELETE /api/admin/leagues`, `POST /api/admin/leagues/:id/sync` (manual fixture sync; respects the 60-s sliding rate-limit window).
    - **Audit log** (Tier 4b Chunk 3): `GET /api/admin/audit-log?limit=&offset=` (cap 200/page).
    - **Cache stats**: `GET /api/admin/cache-stats` — returns `LeaderboardService.stats()` snapshot for development verification.

15. **Health** — [routes/health.js](routes/health.js): `GET /healthz` (mounted at root, no `/api` prefix). Liveness only (no DB ping) — used by Container Apps Liveness probe + Docker HEALTHCHECK. `GET /readyz` (Tier 20 Chunk 7) pings the DB via `SELECT 1` and returns 503 on failure — used by Container Apps Readiness probe. Distinct on purpose: transient DB outage should pull the replica out of rotation (`/readyz` fails → no traffic) but NOT restart the container (`/healthz` still 200).

16. **API docs (dev only)** — [routes/docs.js](routes/docs.js): `GET /api/openapi.json` + `GET /api/docs` (Swagger UI). Mounted ONLY when `NODE_ENV !== 'production'`.

17. **API 404 sentinel** — `app.use('/api', (req, res) => res.status(404).json({error: 'Not found'}))` so unknown `/api/*` paths return JSON 404 instead of falling through to the SPA HTML catch-all.

18. **Catch-all**: `app.get('*')` → `dist/index.html` (client-side routing).

**⚠ Route ordering matters for path-param shadowing.** `/api/groups/discover` is registered before `/api/groups/:groupId`. Any future sibling route under `/api/groups/*` must follow the same convention.

**⚠ OpenAPI dev-gating** — the `/api/openapi.json` + `/api/docs` mounts are gated on `NODE_ENV !== 'production'` so the public API surface isn't published from the live site (attack-surface reduction). The `app.use('/api', 404)` sentinel sits between those routes and the SPA catch-all so unknown `/api/*` paths never resolve to the SPA HTML.

### 5.5 Side-Effect Helpers (lib/ + services/ after Tier 13)

Tier 13 extracted every cross-handler helper out of `server.js` into `lib/` (pure infra) or `services/` (domain logic). The table below tracks the canonical home of each helper today plus where it's invoked from. **Side-effects always fire OUTSIDE owning transactions** so a rollback never produces ghost notifications or badges.

| Helper                                                                              | Home                                                               | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Called from                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scorePick(pick, game)`                                                             | [lib/scoring.js](lib/scoring.js)                                   | Authoritative scoring formula (home/away/draw branches per the draw-scoring tier)                                                                                                                                                                                                                                                                                                                                                                                                               | `lib/users.js buildUserSummary`, `lib/groups.js buildGroupLeaderboard`, `UserService.getProfileByUsername`, `GameService.setResult/bulkSetResult/applyLiveUpdate`                                                                                                                                                                         |
| `NotificationService.notify(userId, type, title, body?, link?)`                     | [services/NotificationService.js](services/NotificationService.js) | Creates a `Notification` row; swallows errors with a warn-log                                                                                                                                                                                                                                                                                                                                                                                                                                   | `PickService`, `GameService`, `GroupService`, `BadgeService.awardBadge` (badge-earned), friend-accept                                                                                                                                                                                                                                     |
| `BadgeService.awardBadge(userId, slug)`                                             | [services/BadgeService.js](services/BadgeService.js)               | Inserts a `Badge` row (unique-constrained); fires a `badge` notification                                                                                                                                                                                                                                                                                                                                                                                                                        | `BadgeService.evaluateBadges` only                                                                                                                                                                                                                                                                                                        |
| `BadgeService.evaluateBadges(userId, ctx?)`                                         | [services/BadgeService.js](services/BadgeService.js)               | Re-runs all badge unlock conditions for a user; idempotent                                                                                                                                                                                                                                                                                                                                                                                                                                      | `PickService.createPick`, `GroupService.create`, per-user inside `GameService.setResult/bulkSetResult/applyLiveUpdate`                                                                                                                                                                                                                    |
| `getFriendshipBetween(a, b)` / `friendStatusFrom(...)`                              | [lib/friends.js](lib/friends.js)                                   | Finds the single row (either direction); maps to `'self' \| 'none' \| 'pending-in' \| 'pending-out' \| 'friends'`                                                                                                                                                                                                                                                                                                                                                                               | `UserService.getProfileByUsername`, friend-request guards                                                                                                                                                                                                                                                                                 |
| `getViewerFriendIdSet(viewerId)`                                                    | [lib/friends.js](lib/friends.js)                                   | One-query lookup of accepted-friend ids for a viewer; Tier 8.6 masking input                                                                                                                                                                                                                                                                                                                                                                                                                    | `LeaderboardService.{getOverallForViewer,getForGroupForViewer}`                                                                                                                                                                                                                                                                           |
| `buildUserSummary({leagueId, seasonId})`                                            | [lib/users.js](lib/users.js)                                       | Overall leaderboard rows (includes displayName + profileVisibility + winRate). Optional filter args (post-Tier-4b) scope to picks on games in that league/season                                                                                                                                                                                                                                                                                                                                | `LeaderboardService.getOverall`                                                                                                                                                                                                                                                                                                           |
| `buildGroupLeaderboard(groupId, {leagueId, seasonId})`                              | [lib/groups.js](lib/groups.js)                                     | Group-scoped rows (same shape + scoped to group members)                                                                                                                                                                                                                                                                                                                                                                                                                                        | `LeaderboardService.getForGroup`                                                                                                                                                                                                                                                                                                          |
| `sortLeaderboard(rows, orderBy)`                                                    | [lib/scoring.js](lib/scoring.js)                                   | Sort by `points / winRate / username`, attach `rank`                                                                                                                                                                                                                                                                                                                                                                                                                                            | Group leaderboard pagination path inside the route handler                                                                                                                                                                                                                                                                                |
| `LeaderboardService.invalidate('all' \| key)` / `invalidatePrefix(prefix)`          | [services/LeaderboardService.js](services/LeaderboardService.js)   | Cache invalidation. `invalidatePrefix` is required for group scopes (one logical group spans many `(leagueId,seasonId)` filter variants)                                                                                                                                                                                                                                                                                                                                                        | `PickService.{create,delete}` ('all'), `GameService.{setResult,bulkSetResult,bulkDelete,deleteGame,applyLiveUpdate}` ('all'), `GroupService.{acceptInvite,joinPublic,leave,deleteGroup}` (`invalidatePrefix('group:<id>')`), `UserService.{deleteUserById,bulkAction}` ('all'), `PUT /api/me` if displayName or profileVisibility changes |
| `UserService.cascadeDelete(target, {transaction})`                                  | [services/UserService.js](services/UserService.js)                 | 9-step user cascade (groups owned, tokens, picks, comments, friendships, memberships, invites, notifications, badges, then user). Tier 5.3: tx-aware. Post-Tier-11 fix-up: also destroys verify/reset/refresh/notification/badge rows explicitly inside the tx (see CLAUDE.md "Cascade-delete fix-up")                                                                                                                                                                                          | `DELETE /api/admin/users/:id`, `POST /api/admin/users/bulk`                                                                                                                                                                                                                                                                               |
| `GameService.cascadeDelete(game, {transaction})`                                    | [services/GameService.js](services/GameService.js)                 | Pick + comment cleanup, then game. Tier 5.3: tx-aware                                                                                                                                                                                                                                                                                                                                                                                                                                           | `DELETE /api/admin/games/:id`, `POST /api/admin/games/bulk`                                                                                                                                                                                                                                                                               |
| `GroupService.cascadeDelete(group, {transaction})`                                  | [services/GroupService.js](services/GroupService.js)               | Members + invites + group                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `DELETE /api/groups/:groupId`                                                                                                                                                                                                                                                                                                             |
| `GameService.applyLiveUpdate(localGame, apiMatch)`                                  | [services/GameService.js](services/GameService.js)                 | Tier 4b Chunk 2 + 2026-05-19 hardening: transactional live-score writer with `SELECT ... FOR UPDATE` row lock (serializes the 1-min and 5-min jobs) + finished-status flip-back guard (rejects stale non-FINISHED upstream snapshots once locally settled). Computes `(status, score, result, halfTimeReached, phase)`; early-returns if unchanged. Notify + badge + cache fan-out fires OUTSIDE the tx. Result only DERIVED if `fresh.result === null` (admin-entered results never clobbered) | `lib/jobs/syncLiveScores.js`, `lib/jobs/reconcileInProgressGames.js`                                                                                                                                                                                                                                                                      |
| `LeagueService.upsertFixture(league, season, apiMatch)` / `.syncFixtures(leagueId)` | [services/LeagueService.js](services/LeagueService.js)             | Idempotent upsert by `(leagueId, sourceId)`; daily sync orchestrator                                                                                                                                                                                                                                                                                                                                                                                                                            | Manual admin endpoint + `lib/jobs/syncFixtures.js`                                                                                                                                                                                                                                                                                        |
| `AuditLogService.record({...})`                                                     | [services/AuditLogService.js](services/AuditLogService.js)         | Single audit-log row insert with 4KB payload truncation. NEVER throws back into caller                                                                                                                                                                                                                                                                                                                                                                                                          | `middleware/auditLog.js` `res.on('finish')` handler                                                                                                                                                                                                                                                                                       |
| `scheduler.register(name, cron, handler)` / `.start()`                              | [lib/scheduler.js](lib/scheduler.js)                               | Registers a node-cron tick. Each invocation acquires `pg_try_advisory_lock(crc32(jobName))`. No-op when `NODE_ENV=test`                                                                                                                                                                                                                                                                                                                                                                         | `server.js` boot (after route mount, before `app.listen`)                                                                                                                                                                                                                                                                                 |
| `createAccessToken(user)`                                                           | [lib/auth.js](lib/auth.js)                                         | 15-min HS256 JWT with `{id, username, role}`                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `setAuthCookies` only                                                                                                                                                                                                                                                                                                                     |
| `setAuthCookies(res, user, {userAgent})`                                            | [lib/auth.js](lib/auth.js)                                         | Signs access JWT, generates random refresh token, inserts a `RefreshToken` row, sets both cookies on `res`. Async                                                                                                                                                                                                                                                                                                                                                                               | `POST /api/login`, `/api/register`, `/api/auth/refresh`, `/api/auth/2fa/verify`, `POST /api/me/password`                                                                                                                                                                                                                                  |
| `clearAuthCookies(res)`                                                             | [lib/auth.js](lib/auth.js)                                         | `res.clearCookie` for `sc_access` + `sc_refresh` at their correct paths                                                                                                                                                                                                                                                                                                                                                                                                                         | `POST /api/auth/logout`, refresh-failure paths                                                                                                                                                                                                                                                                                            |
| `revokeAllUserRefreshTokens(userId)`                                                | [lib/auth.js](lib/auth.js)                                         | Sets `revokedAt = NOW()` on every non-revoked row for the user                                                                                                                                                                                                                                                                                                                                                                                                                                  | `POST /api/auth/reset-password`, `POST /api/me/password`                                                                                                                                                                                                                                                                                  |
| `generateRawToken()` / `hashToken(raw)`                                             | [lib/auth.js](lib/auth.js)                                         | 32 random hex bytes; SHA-256 hex digest                                                                                                                                                                                                                                                                                                                                                                                                                                                         | All three token issuers + verifiers (verify-email, password-reset, refresh)                                                                                                                                                                                                                                                               |
| `sendVerificationEmail(user)`                                                       | [lib/emailHelpers.js](lib/emailHelpers.js)                         | Generates a token row + dispatches verify email via `lib/email`. Fire-and-forget                                                                                                                                                                                                                                                                                                                                                                                                                | `POST /api/register`, `PATCH /api/me/email`                                                                                                                                                                                                                                                                                               |

`NotificationService.notify` and `BadgeService.evaluateBadges` are **fire-and-forget with `.catch(() => {})`** — a failure inside them never breaks the user-facing response. They also fire **outside** every cascade transaction so a rollback never produces ghost notifications. The structured `req.log.warn`/`logger.warn` calls inside the service implementations at least leave a trail for failed sends.

#### Transactional cascades (Tier 5.3)

All cascade helpers accept `{transaction}` and forward it to every internal Sequelize call. Callers wrap with:

```js
await sequelize.transaction(async (t) => {
  await cascadeDeleteUser(target, { transaction: t });
});
```

Per-entity transaction strategy in bulk endpoints — `POST /api/admin/users/bulk` and `POST /api/admin/games/bulk` start a **fresh transaction per iteration**, not one tx for the entire batch. Rationale: a single bad row should not roll back already-committed deletions; the existing `affected[]` / `skipped[]` response already implies per-row success. A handler-level abort on first failure still happens — but everything before the failure stays committed and orphan-free.

Verified property: a mid-cascade exception leaves the parent row + all child rows intact. See §11.4 gotcha #11 for the test recipe.

---

## 6. Frontend Architecture

### 6.1 Build Pipeline

```
src/main.jsx  →  applyTheme(getStoredTheme())     // Tier 11: SYNC, before React mount, no FOUC
              →  initSentry()                      // Tier 5.4b: dyn-import gated on VITE_SENTRY_DSN
              →  installClientErrorReporter()
              →  React.createRoot()
                   <ErrorBoundary>
                     <NotificationProvider>
                       <AuthProvider>
                         <AuthGateProvider>        // Tier 11: SignInModal mount + gate(label)
                           <DataProvider>
                             <App />               // Tier 13: layout shell only
                               → <SkeletonView>    // initial boot
                               → <AuthView>        // anon (Landing OR auth grid based on showAuth)
                               → <DashboardView>   // authenticated OR anon-browse

src/App.jsx + src/views/ + src/contexts/ + src/hooks/ + components/ + components/ui/
  →  Vite (esbuild + Rollup)  →  dist/index.html, dist/assets/*.js, *.css
```

`npm run dev` starts Vite's dev server on `localhost:5173` with HMR. The dev server proxies `/api/*` to `localhost:3000` (configured in [vite.config.js](vite.config.js)), so the frontend code can use relative URLs in both dev and prod with no env-var gymnastics.

`npm run build` produces a single-page bundle in `dist/`. **Code-splitting (Tier 9.2)** is enabled via `React.lazy` + `<Suspense>` around `AdminPanel`, `ProfileView`, `PicksHistory`, plus Vite `manualChunks` splitting `react`/`react-dom` (vendor) and `@sentry/*` (sentry) chunks. Hidden sourcemaps emit for Sentry release upload. No service worker; no preact compat.

### 6.2 State Management

Tier 13 (Chunks 6.x) moved client state out of `App.jsx` into React Context providers stacked in [src/main.jsx](src/main.jsx). Tier 11 added a fourth (`AuthGateProvider`) between Auth and Data so the SignInModal mounts at the app root. There is **no Redux, no Zustand, no React Router** — Context + `useState` is sufficient at this scale.

```
<NotificationProvider>     // status banner toast (Tier 13.6)
  <AuthProvider>           // user, authData, authView, 2FA flow, browseAsGuest, showAuth (Tier 13.6 + Tier 11)
    <AuthGateProvider>     // gate(label) → SignInModal; mounts at app root (Tier 11)
      <DataProvider>       // games, picks, groups, leaderboard, friends, profile + every mutation handler
        <App />            // ~71 LOC layout shell; routes between SkeletonView / AuthView / DashboardView
```

The state slots that used to live in `App.jsx` now live as `useState` inside the appropriate provider:

```
NotificationContext:  status                                              // single toast string + scorecast:client-error subscription

AuthContext:          user, authData, authView, forgotSent, confirmingLogout,
                      browseAsGuest (persisted: localStorage.sc_browse_as_guest),
                      showAuth (initial state reads localStorage.sc_visited)
                      // authView ∈ 'auth' | 'forgot' | 'reset' | 'twofa'
                      // performLogout resets browseAsGuest=false AND showAuth=false AND clears sc_visited
                      //  → explicit sign-out always lands on the marketing landing page

AuthGateContext:      gateLabel, isGateOpen, gate(label), closeGate

DataContext:          bootDone, loading, view, games, groups, picks, pendingInvites,
                      friendsPicks       (Tier 18 Chunk 4 — every friend's picks in a ±30d window;
                                          loaded in loadDashboard + revalidate; sliced per-game by
                                          GameCard's FriendPicksPanel, rendered flat by PicksHistory's
                                          Friends tab),
                      leaderboard, groupOrderBy, groupOffset, selectedGroupId,
                      friends, discoverGroups, ownProfile,
                      profileUsername, profile, profileLoading, profileError, profileBusy,
                      gameFilters        ({leagueId, seasonId} for games view URL ?league=&season=),
                      leaderboardFilters ({leagueId, seasonId} for stats — SEPARATE axis from games;
                                          URL ?lbLeague=&lbSeason=)
```

**Cross-context coordination is event-driven, not imperative.** Provider order matters:

- `AuthContext` only manages user state. When the user logs in / out, it flips `user` and calls `showStatus` from `NotificationContext`. It does **not** know about `DataContext`.
- `AuthGateContext` is anon-only — `gate(label)` opens the SignInModal pre-filled with a contextual label ("Sign in to pick", "Sign in to react", etc.). It depends on `AuthContext` to know if a viewer is anonymous, but doesn't reach into `DataContext`.
- `DataContext` watches `user` via `useEffect`. On user transitions:
  - **null → set (login)**: triggers `loadDashboard()` (authed parallel fetch of `/me`, `/games`, `/groups`, `/picks`, `/leaderboard`, `/friends`, `/groups/discover`).
  - **null + `browseAsGuest=true` on boot**: triggers `loadAnonDashboard()` (parallel fetch of just the public endpoints — games, leaderboard, discover, leagues).
  - **set → null (logout / session-expired)**: wipes its own slots in a single effect.
- `useRequest` ([src/hooks/useRequest.js](src/hooks/useRequest.js)) is the fetch wrapper consumed by every component that talks to `/api/*`. On a 401, it calls `clearSession` from `AuthContext`, which trips the user → null effect in `DataContext`, which wipes data. No component has to know about teardown.

**Boot decision tree** (in `DataProvider.useEffect` on mount):

```
try `loadDashboard()` (sends cookies)
  ├─ 200 → user set → render <DashboardView>
  ├─ 401 + browseAsGuest=true (read from localStorage) → loadAnonDashboard() → render <DashboardView> with user=null
  ├─ 401 + browseAsGuest=false → render <AuthView> (Landing OR auth grid based on showAuth)
  └─ other error → showStatus(error.message) + render whatever the user state implies
```

**Selector hooks** ([src/hooks/](src/hooks/)) let components import the narrow slice they need:

- `useAuth` / `useData` / `useNotifications` — direct re-exports of the context value
- `useGames` — `{ games, upcomingGames, liveGames, completedGames, byDay, refreshGames }`. The `byDay` Map (Tier 18 Chunk 3) keys games by `dayKey(date)` (en-CA `YYYY-MM-DD`) so `GamesCalendar` can index without re-walking the list per render. `dayKey` is exported from this hook so other components (DataContext's deep-link consumer) can write matching URL keys.
- `usePicks` — `{ picks, pickMap, submitPick, removePick }` (pickMap built here)
- `useFriendsPicks` (Tier 18 Chunk 4) — `{ friendsPicks, byGame }`. `byGame` is a `Map<gameId, FriendPick[]>` so `FriendPicksPanel` per-card lookups are O(1).
- `useGroups` / `useLeaderboard` / `useFriends` — projections on `useData()`

**Notification deep-link consumer** (Tier 18 Chunk 6a, extended in Tier 19 follow-up) — `DataContext.consumeDeepLinks(gamesList)` is the read-the-URL → mutate-app-state primitive. It runs ONCE on boot between the initial data load and `bootDone` flipping true (the original Chunk 6a use-case), AND it's re-invoked in-process by `DataContext.navigateToDeepLink(link)` whenever the in-app `NotificationBell` row click needs to navigate via a stored `link` (the Tier 19 follow-up). Recognizes three params:

- `?view=games|mypicks|groups|leaderboard|profile|admin` → `setView(...)`
- `?gameId=<uuid>` → resolves to the game's day via `dayKey(game.date)`, writes the synthetic `?date=YYYY-MM-DD` into the URL via `history.replaceState`, then `setView('games')`. The `?date=` lands BEFORE `GamesCalendar` reads it on its first mount, so the calendar selects the right chip without any inter-component event plumbing. Today's date deletes `?date=` instead of setting it (calendar treats absent `?date=` as today).
- `?groupId=<uuid>` → `setSelectedGroupId(...)` + `setView('groups')` if no view was supplied.

After consumption, all three params are stripped via `history.replaceState` so refresh / share-link doesn't re-fire side effects. UUIDs are regex-validated (`DEEP_LINK_UUID_RE` at module scope) so a garbage `?gameId=` is ignored without throwing.

**In-app navigator** (Tier 19 follow-up) — `navigateToDeepLink(link)` is the only sanctioned bell-click target. It parses `link` with `new URL(link, origin)` to tolerate absolute or relative shapes, `history.pushState`s the resolved URL (so Back works), and then calls `consumeDeepLinks(games)` to re-run the same param interpretation that boot uses. Malformed input bails silently — never throws. Closes the bell popover via `setOpen(false)` so the user lands on the destination with no lingering UI.

The matching server side: every `NotificationService.notify(userId, type, title, body, link)` call site now passes a `link` string. Convention:

| Type                         | Link                         | Producer                                                         |
| ---------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `pick-scored`                | `/?gameId=<id>`              | `GameService.{setResult,bulkSetResult,applyLiveUpdate}`          |
| `odds-shifted`               | `/?gameId=<id>`              | `GameService.fireOddsShiftedFor`                                 |
| `kickoff-reminder`           | `/?gameId=<id>`              | `lib/jobs/sendKickoffReminders.js`                               |
| `badge`                      | `/?view=profile`             | `BadgeService.awardBadge`                                        |
| `invite`                     | `/?view=groups&groupId=<id>` | `GroupService.invite`                                            |
| `group-join`                 | `/?view=groups&groupId=<id>` | `GroupService.{acceptInvite,joinPublic,leave,transferOwnership}` |
| `group-join` (group deleted) | `/?view=groups`              | `GroupService.deleteGroup` (group is gone, no groupId)           |
| `group-comment`              | `/?view=groups&groupId=<id>` | `CommentService.fanOutGroupComment`                              |
| `friend-request`             | `/?view=groups`              | `routes/friends.js` (request + accept)                           |

`src/sw.js`'s `notificationclick` handler reads the link from `data.link` and calls `clients.openWindow(targetUrl)` — no SW change was needed for Chunk 6 since the link plumbing was already wired. The in-app `NotificationBell` click handler ([src/components/NotificationBell.jsx](src/components/NotificationBell.jsx), Tier 19 follow-up) wires the third consumer: clicking a row calls `markRead(n.id)` (if unread) AND `navigateToDeepLink(n.link)` (if present) AND closes the popover. Before this wiring, bell rows only marked-read and the `link` field was dead in-app — only push clicks routed users via deep-link. The `odds-shifted` producer was the regression target (had been emitting `/games/<id>` — a non-route path — instead of the documented `/?gameId=<id>`; fixed alongside the bell wiring).

> **Note on `pickMap`**: it stores the **full pick object** keyed by `gameId`, not just the choice. This was changed in Tier 8.2 so `GameCard` can pass `existingPickId` to the undo-pick handler. Tier 13 moved this `useMemo` into [src/hooks/usePicks.js](src/hooks/usePicks.js).

**localStorage is used only for non-secret UI state** (Tier 6.8 retired the access-token storage). Current keys:

| Key                    | Purpose                                                                            | Writer                                                          |
| ---------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `sc_visited`           | "Has this browser successfully authed before?" — skips Landing for returning users | `AuthView` after login/register/2FA, cleared by `performLogout` |
| `sc_browse_as_guest`   | "Is this browser in anonymous-browse mode?"                                        | Landing "Browse as guest" CTA + `performLogout` post-login      |
| `sc_theme`             | `'dark' \| 'light'` (legacy `'system'` reads as `'dark'`)                          | `lib/theme.js setStoredTheme`                                   |
| `sc_sidebar_collapsed` | Desktop sidebar collapse state                                                     | `Sidebar` toggle                                                |

Auth state is inferred from `user` (set by a successful `/api/me` boot fetch); the cookies that actually authenticate the user are HttpOnly and invisible to JS. `bootDone` tracks whether the initial `/api/me` round-trip completed so the UI shows the skeleton view until then (instead of briefly flashing the login form to an authenticated user).

### 6.3 The `useRequest()` Hook

The heart of frontend-backend communication. Originally an inline `useCallback` in `App.jsx`; Tier 13 Chunk 3 extracted it into [src/hooks/useRequest.js](src/hooks/useRequest.js) so any component or context can call it without prop-drilling. It handles cookie auth, CSRF, and transparent token refresh:

```js
export function useRequest() {
  const { user, clearSession } = useAuth();
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

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
      let reqId = response.headers.get('X-Request-Id');
      if (reqId) setLastRequestId(reqId);

      // Refresh-then-retry: on 401, try POST /api/auth/refresh once and retry.
      // /api/auth/* are exempt to prevent recursion.
      if (response.status === 401 && !path.startsWith('/api/auth/')) {
        const refreshResp = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        if (refreshResp.status === 204) {
          response = await doFetch();
          const newReqId = response.headers.get('X-Request-Id');
          if (newReqId) {
            setLastRequestId(newReqId);
            reqId = newReqId;
          }
        }
      }

      if (response.status === 401) {
        if (userRef.current) {
          clearSession();
          throw new Error('Session expired');
        }
        const err = new Error('Authentication required');
        err.reqId = reqId;
        err.status = 401;
        throw err;
      }
      // ... 204 / non-ok / JSON parsing as before
    },
    [clearSession],
  );
}
```

Important properties:

- **Always sends `credentials: 'include'`** so the browser attaches `sc_access`/`sc_refresh`/`sc_csrf` cookies. No `Authorization` header is ever set.
- **CSRF auto-injection**: state-changing methods read `sc_csrf` via [src/lib/cookies.js](src/lib/cookies.js) and send it as `X-CSRF-Token`. The cookie is set by the server's CSRF middleware on the first request of any session — so by the time the SPA needs to send a mutation, the cookie is already present.
- **Refresh-then-retry**: a 401 on a non-`/api/auth/*` path triggers one `POST /api/auth/refresh`. On success (204 + new cookies), the original request is retried. On failure, the original 401 is surfaced. This is what lets the user keep using the app for 30 days without re-logging-in, even though access tokens expire every 15 minutes.
- **No retry loop**: `/api/auth/refresh` itself is exempted from refresh-retry; if refresh returns 401, we drop straight to the session-expired path.
- **Auto-handles 401**: when the (possibly-retried) response is still 401 **and** there is a `user` in state (`userRef.current`), it calls `clearSession` from `AuthContext` (which flips `user` to null and shows a toast) and throws `'Session expired'`. `DataContext` watches `user` and wipes its slots when it sees the null. Without a user (first boot, no cookies), it throws `'Authentication required'` instead — used by the boot flow to silently fall to the login screen.
- **Tolerates empty responses** (`204` and zero-length bodies).
- **Tier 5.4b**: every response's `X-Request-Id` header is captured and pushed into `setLastRequestId()` ([src/lib/clientErrorReporter.js](src/lib/clientErrorReporter.js)) so any subsequent client-error report carries the most recent server reqId. Thrown error objects also get a `.reqId` property attached, so handler `.catch()` sites can include it in their own error reports.

**Bypass for `/api/auth/*` endpoints**: `AuthContext` itself can't use `useRequest` (chicken-and-egg — useRequest reads from AuthContext). Login/register/forgot/reset/2fa-verify call `apiFetch` from [src/lib/apiClient.js](src/lib/apiClient.js) instead, a bare wrapper that does CSRF + fetch + JSON parse without the refresh-retry path (which would be meaningless for these endpoints anyway — they are themselves the path).

**Boot flow** lives inside `DataProvider`:

```js
useEffect(() => {
  loadDashboard()
    .catch((error) => {
      // 401 or "Authentication required" → no session, silently show login
      if (
        error.status === 401 ||
        error.message === 'Session expired' ||
        error.message === 'Authentication required'
      )
        return;
      showStatus(error.message);
    })
    .finally(() => setBootDone(true));
}, []);
```

The first paint is always `<SkeletonView />`; once `bootDone` flips, `App.jsx` resolves to `<DashboardView />` (if `user` got set) or `<AuthView />` (if not). Post-login dashboard fetch composition lives in `AuthView` — it awaits `authLogin()` / `authRegister()` / `auth2faVerify()`, then calls `loadDashboard()` from `useData`.

### 6.4 Tab Routing

Routing is **fake**: the URL never changes for tab switches. The `view` state on `DataContext` determines which top-level block renders. Five base tabs (Games, My Picks, Groups, Leaderboards, Profile) plus a conditional Admin tab when `user.role === 'admin'`.

**Two URL state slots DO sync via `history.replaceState`** (no router needed):

- `?league=<code>&season=<year>` — games-view filters. Code is the football-data.org `sourceLeagueId` (e.g. `PL`), not the internal UUID, so links are shareable + stable across DB rebuilds. Owned by [GameFiltersBar](src/components/GameFiltersBar.jsx) → `DataContext.gameFilters`.
- `?lbLeague=<code>&lbSeason=<year>` — leaderboard scope filters. Distinct keys from `?league=&season=` so picking a league for stats doesn't also scope the games view. Owned by [LeaderboardFiltersBar](src/components/LeaderboardFiltersBar.jsx) → `DataContext.leaderboardFilters`.

Deep-link routes still consumed by AuthContext on mount: `?verifyToken=...` (Tier 6.5 email verify), `?resetToken=...` (Tier 6.4 password reset). Both are stripped from the URL via `history.replaceState` once read.

For Sidebar tabs and browser back/forward: still unsupported (Sidebar buttons just flip `DataContext.view`).

### 6.5 Polling Patterns

Three timers run inside the app:

- **`NotificationBell`**: `setInterval` calling `GET /api/notifications` every 30 s. Started on mount, cleared on unmount. Hidden entirely in anonymous-browse mode.
- **`useCountdown(date)`** in `time.js`: per-`GameCard` interval that re-formats the countdown label every 30 s. Cheap; the hook returns a string label.
- **`useMatchMinute(kickoff, isLive, {halfTimeReached, phase})`** (Tier 4b Chunk 2): per-live-`GameCard` 30-s tick computing the estimated match minute. No-ops when `isLive` is false. Free tier of football-data.org doesn't expose `minute`/`injuryTime`, so this is wall-clock-since-kickoff refined by two persisted signals: `halfTimeReached` and `phase`. See [src/utils/time.js](src/utils/time.js).

There is **no client-side polling for game state** — live-score updates land via the **server-side 60-s cron** (Tier 4b Chunk 2) into the DB; the next client-side `refreshGames` picks them up. The client just polls notifications. Leaderboards are computed on each `GET /api/leaderboard` call (hits the 30-s server cache) and refetched on user actions, not on a timer.

### 6.6 Component Hierarchy

```
<ErrorBoundary>                            // Tier 5.4b — render-error fallback wrapping the whole tree
└── <NotificationProvider>                 // Tier 13.6: status banner state + scorecast:client-error listener
    <AuthProvider>                         // Tier 13.6 + Tier 11: user, auth flow, browseAsGuest, showAuth
      <AuthGateProvider>                   // Tier 11: anon-action gate (SignInModal mounted here)
        <DataProvider>                     // Tier 13.6: games/picks/groups/leaderboard/friends/filters + handlers
          <App>                            // Tier 13 Chunk 6 + Tier 18 Chunk 6c: layout shell only
          ├── pathname short-circuit (Tier 18 Chunk 6c) — /terms, /privacy,
          │   /copyright, /cookies render the matching <LegalLayout> page
          │   fullscreen, BYPASSING the rest of the App tree. Anon + authed
          │   users see the same content; no auth gate, no skeleton wait.
          ├── skip-to-content link (a11y, Tier 11 Chunk 4)
          ├── radial gradient + global status banner
          └── body:
              ├── <SkeletonView>           // boot / loading state — <main id="main">
              │
              ├── <AuthView>               // unauthenticated. switches on showAuth + authView
              │     showAuth === false:    <Landing> (default for first-time anon visitors;
              │                             "Get started" / "Sign in" / "Browse as guest" CTAs)
              │     showAuth === true:
              │       authView === 'auth':   <LoginForm> / <RegisterForm>
              │       authView === 'forgot': <ForgotPasswordForm>
              │       authView === 'reset':  <ResetPasswordForm>  (entered via ?resetToken=)
              │       authView === 'twofa':  <TwoFactorChallenge> (Tier 6.9; login returned {challenge: true})
              │
              └── <DashboardView>          // authenticated OR anon-browse mode
                  ├── <Sidebar>                  // left column nav (collapsible desktop / off-canvas mobile)
                  │     Items filtered to Games/Groups/Rankings for anon viewers
                  ├── <main id="main">           // a11y landmark
                  │   ├── top utility bar:
                  │   │   ├── BANTRYX wordmark (decorative; aria-hidden)
                  │   │   ├── <SearchBar>        // debounced /api/search, type-grouped dropdown
                  │   │   ├── <ThemeToggle>      // Tier 11: light/dark
                  │   │   ├── authed:  <NotificationBell> + <UserMenu>
                  │   │   ├── anon:    [Sign in] [Sign up] [← Home] pills
                  │   │   └── (logout flow: UserMenu → "Sign out" → setConfirmingLogout → <ConfirmModal>)
                  │   │
                  │   ├── view === 'games':
                  │   │     <GameFiltersBar>     // ?league=&season= URL sync
                  │   │     <GamesCalendar>      // Tier 18 Chunk 3 — 7-day fixed window (today-3 → today+3)
                  │   │       chip strip + ±7-day arrow paging
                  │   │       URL ?date=YYYY-MM-DD sync via history.replaceState
                  │   │       "Back to today" pill (cyan w/ live red dot when in-progress today)
                  │   │       Selected day → list of <GameCard>* for that day only
                  │   │     <GameCard>*          // uses usePicks for submit/remove + pickMap
                  │   │       ├── live pill (status='in-progress'): "Live · 67'" (useMatchMinute)
                  │   │       ├── <PayoutMatrix> // 2×3 preview matrix on upcoming games
                  │   │       ├── <FriendPicksPanel game={game} />  // Tier 18 Chunk 4
                  │   │       │     Collapsed: "N friends picked" / "No friends picked yet"
                  │   │       │     Expanded: rows w/ Avatar + side chip + outcome badge
                  │   │       │       (won = green ✓+pts; draw = warning yellow; missed = "✗ Missed")
                  │   │       └── <CommentThread scope="game" scopeId={game.id} />  // Tier 18 Chunk 5 generalized
                  │   │             ├── authed: composer + reaction buttons
                  │   │             └── anon:   <InlineGatePanel> composer; reaction click → gate('Sign in to react')
                  │   │     sidebar: <LeaderboardRow>* (clickable → opens drawer; honors entry.isMasked)
                  │   │
                  │   ├── view === 'mypicks':
                  │   │     <LeaderboardFiltersBar>   // ?lbLeague=&lbSeason= URL sync
                  │   │     mode toggle [Mine] / [Friends] (Tier 18 Chunk 4)
                  │   │     friend dropdown (Tier 18 Chunk 4 — visible in Friends mode; positioned LEFT of LeaderboardFiltersBar)
                  │   │     <PicksHistory>           // filtered client-side by leaderboardFilters
                  │   │       Mine: own picks, sorted via comparePicksByPendingThenRecent
                  │   │       Friends: friendsPicks (from useFriendsPicks), same sort comparator
                  │   │       Section heading "Friends' Picks" keeps the apostrophe
                  │   │       (pill label drops it: "Friends")
                  │   │
                  │   ├── view === 'groups':
                  │   │     create form (with visibility radio)
                  │   │       anon: replaced by <InlineGatePanel label="Sign in to create a group">
                  │   │     Discover list
                  │   │       anon: row "Join" button → gate(...)
                  │   │     <FriendsList>             // returns null for anon viewers
                  │   │     pending invites           // authed only
                  │   │     <GroupCard>*
                  │   │       ├── (header / members / invite row / leave|transfer|delete actions)
                  │   │       └── <CommentThread scope="group" scopeId={group.id} />  // Tier 18 Chunk 5
                  │   │             only for members + owner (group-comments are member-only by design)
                  │   │
                  │   ├── view === 'leaderboard':
                  │   │     <LeaderboardFiltersBar>
                  │   │     <LeaderboardCard>  <GroupLeaderboardCard>
                  │   │
                  │   ├── view === 'profile' (self):
                  │   │     <ProfileView editable />  // consumes useAuth + useData
                  │   │       Avatar header,
                  │   │       Settings:
                  │   │         Privacy radio (public/friends/private — Tier 8.6),
                  │   │         <ChangeEmailPanel> (PATCH /api/me/email; requires currentPassword),
                  │   │         <ChangePasswordPanel> (POST /api/me/password; revokes other devices),
                  │   │         <TwoFactorSetup> (Tier 6.9; QR + recovery codes + .txt download),
                  │   │         displayName/bio inline edit
                  │   │
                  │   └── view === 'admin' (admin only): <AdminPanel>
                  │         ├── <GameManager>          // includes drawProbability + Draw button
                  │         ├── <UserManager>          // bulk + self auto-skipped
                  │         ├── <LeagueManager>        // Tier 4b Chunk 1
                  │         └── <AuditLog>             // Tier 4b Chunk 3
                  │
                  └── overlays (rendered inside DashboardView):
                      ├── <SignInModal>             // mounted by AuthGateProvider
                      ├── <ConfirmModal>            // logout, deletions, bulk confirmations
                      ├── <TermsAcceptanceModal>    // Tier 18 Chunk 6c — BLOCKING dialog when
                      │                              //   user && !browseAsGuest && needsTermsAcceptance(user).
                      │                              //   Cannot be dismissed via Escape, overlay click,
                      │                              //   or refresh. Actions: "I accept" (POSTs
                      │                              //   /api/me/accept-terms) or "Sign out". Suppresses
                      │                              //   OnboardingTour while open (no dialog stacking).
                      ├── <OnboardingTour>          // Tier 11 Chunk 4; gated on !onboardingCompletedAt && !showTermsGate
                      ├── <Footer>                  // Tier 18 Chunk 6c — bottom of <main>:
                      │                              //   © 2026 Bantryx · Trinidad & Tobago
                      │                              //   · [Terms] [Privacy] [Copyright] [Cookies]
                      └── <ProfileDrawer>
                            └── <ProfileView>
                                  ├── <Avatar>
                                  └── <BadgeWall>

<CommentThread scope="game"|"group" scopeId={...}> renders:                     // Tier 18 Chunk 5 generalized
  <CommentRow>* — each with <Avatar>, edit form (author only), 5-emoji reaction strip
  baseUrl: scope==='group' ? `/api/groups/${id}/comments` : `/api/games/${id}/comments`
  Backwards-compat shim: a caller that still passes `gameId={...}` (no scope prop) is
  treated as `{scope: 'game', scopeId: gameId}`.
```

**Legal pages** (Tier 18 Chunk 6c) live under [src/components/legal/](src/components/legal/):

- `LegalLayout.jsx` — shared chrome (BANTRYX wordmark + "Back to app" link + centered prose container).
- `Terms.jsx` / `Privacy.jsx` / `Copyright.jsx` / `CookiePolicy.jsx` — each exports a single React component rendered when `App.jsx` matches the corresponding pathname. Operator details (name, email, jurisdiction) live in a `LEGAL_CONTACT` constant at the top of each file for easy maintenance.
- Copy is **deliberately plain-English** — no cookie-name tables, no exact retention windows, no specific security-mechanism names (bcrypt / SHA-256 / CSP), no named sub-processors. Covers DPA Chapter 22:04 (2011) disclosure requirements without publishing an attacker-friendly inventory of the auth surface.

**Modal z-stacking** (Tier 11): ConfirmModal + SignInModal + ProfileDrawer all `z-50`; toast viewport `z-[100]`; sidebar mobile drawer + NotificationBell dropdown `z-40`; OnboardingTour uses the `<Dialog>` primitive so `z-50` too. When a modal opens on top of the mobile drawer, the drawer's Escape handler is guarded by `drawerRef.contains(document.activeElement)` so Escape closes the modal first; the drawer stays open until focus returns.

**Tier 13 prop-drilling status**: every component above either (a) takes only data props (`game`, `group`, `profile`, etc.) or (b) consumes contexts via hooks directly. The legacy `request` / `currentUserId` / `onError` / `onSaveProfile` prop chains are gone. Three exceptions: `GroupCard` / `LeaderboardCard` / `GroupLeaderboardCard` still receive `currentUserId` as a prop because they're pure presentation components used in multiple contexts; migrating them buys nothing.

### 6.7 Error Reporting (Tier 5.4b)

Three failure modes, three UX paths, one logging sink.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Browser                                         │
│                                                                              │
│  1. React render throws ──▶ <ErrorBoundary>                                  │
│     (component crash)          ├─ renders fallback (slate/rose card)         │
│                                ├─ reportClientError(...)  ─┐                 │
│                                └─ captureException(...)  ──┼─▶ Sentry        │
│                                                            │  (if DSN set)   │
│  2. window 'error' /        ──▶ clientErrorReporter        │                 │
│     'unhandledrejection'        ├─ throttle (5 / min)      │                 │
│     (uncaught async,            ├─ dispatch custom event ──┼──▶ App listener │
│      raw throws, etc.)          │   'scorecast:client-error'      ▼          │
│                                 │                            showStatus()    │
│                                 └─ reportClientError() ─────┘  (cyan toast)  │
│                                                                              │
│  3. useRequest() throws     ──▶ caller .catch() (DataContext mutation       │
│     (handled API error)         handler or view component)                   │
│                                 └─ showStatus(error.message) via             │
│                                    useNotifications  (cyan toast)            │
│                                                                              │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │ POST /api/client-errors
                          │ (paths 1 + 2)
                          ▼
            ┌─────────────────────────────────────┐
            │   server.js                          │
            │   clientErrorLimiter (30 / 5min)     │
            │   validate(clientErrorSchema)        │
            │   soft-decode JWT → userId           │
            │   req.log.error({clientError,        │
            │                  userId},            │
            │                 'client error')      │
            │   → 204                              │
            └─────────────────────────────────────┘
                          │
                          ▼ (Sentry server SDK also catches Express errors
                                   via setupExpressErrorHandler if SENTRY_DSN set)
```

**Files touched**:

- [src/components/ErrorBoundary.jsx](src/components/ErrorBoundary.jsx): class component (React requires class for error boundaries). `getDerivedStateFromError` sets `hasError = true`; `componentDidCatch` calls `reportClientError` and Sentry `captureException`. Fallback UI matches the slate/cyan/rose theme, offers **Reload page** and **Try again**. Raw error message rendered **only when `import.meta.env.DEV` is true** — Vite strips the branch from the prod bundle so users never see `Cannot read properties of undefined…` style messages.
- [src/lib/clientErrorReporter.js](src/lib/clientErrorReporter.js): installs `window.error` and `unhandledrejection` listeners. Hard-throttled to **5 reports per 60 s window** (the rest are dropped silently — prevents runaway-error storms). `reportClientError` posts via `fetch({keepalive: true})` so reports complete even if the page is unloading. Clips `stack` and `componentStack` to **8 KB** each and `message` to 500 chars, matching the server's zod ceilings. Failures inside the reporter are swallowed (never re-feed the listener). Also dispatches a `scorecast:client-error` DOM event so `NotificationContext` can show a toast.
- [src/lib/sentry.js](src/lib/sentry.js): `initSentry()` is `async` — reads `import.meta.env.VITE_SENTRY_DSN` and, if set, does a dynamic `await import('@sentry/react')` then calls `init({dsn, environment, tracesSampleRate: 0})`. If unset, **the entire dynamic-import branch is dead-code-eliminated by Vite** — zero `@sentry/react` bytes in the bundle (verified: 0 occurrences of "sentry" in `dist/assets/*.js` when DSN unset).
- [src/main.jsx](src/main.jsx): bootstrap order — `initSentry()` (fire-and-forget async), `installClientErrorReporter()` (synchronous), then `createRoot().render(<StrictMode><ErrorBoundary><NotificationProvider><AuthProvider><DataProvider><App/></...></StrictMode>)` (Tier 13 added the provider stack).
- [src/contexts/NotificationContext.jsx](src/contexts/NotificationContext.jsx): owns the `scorecast:client-error` listener (Tier 13 moved this out of App.jsx). When fired, it sets the status banner to _"Something went wrong — refresh if things look off."_ for 3.5 s.

**Server-side wiring**:

- [lib/instrument.js](lib/instrument.js): MUST be the **very first `require()`** in [server.js](server.js) (currently line 1). Loads `dotenv` then conditionally `require('@sentry/node').init({dsn, …})`. Required this early because `@sentry/node` v8+ uses OpenTelemetry, which needs to instrument Express/Sequelize/etc. **before** they're imported.
- [lib/sentry.js](lib/sentry.js): exports `captureException` and `setupExpressErrorHandler(app)`. Both no-op if `SENTRY_DSN` is unset. `setupExpressErrorHandler(app)` is mounted **after** all routes including the catch-all `app.get('*')` so it sees errors propagated via `next(err)`.

**Why three paths and not one**:

- Render errors need the React tree to swap in a fallback — that's what `componentDidCatch` does and a window listener cannot.
- Window errors / unhandled rejections happen outside React's render cycle — boundary doesn't see them; they need their own listener.
- Handled API errors (`request()` throw) are caught by app code (e.g., `submitPick`) which already shows a contextual toast; piping them through the boundary or reporter would double-toast and lose context.

**What's logged**:

- Backend: every report becomes one structured `client error` log line with `reqId` (the server's own request id for the POST), `userId` (from soft-decoded token if present), and the full `clientError` object (`message`, `stack`, `componentStack`, `url`, the **client-side** `reqId` of the most recent server interaction, `userAgent`, `level`). Pino-formatted JSON in prod, pretty-printed in dev.

**Sentry activation** (when ready): paste the project DSN(s) into `.env` as `SENTRY_DSN` (server) and `VITE_SENTRY_DSN` (browser); restart the server; rebuild the frontend (`VITE_SENTRY_DSN` is read at Vite build time). Verification trick: throw via `setTimeout(() => { throw new Error('test') }, 0)` — direct console throws are filtered by Sentry as "developer-intentional" in some browser builds.

### 6.8 Design Tokens & Theming (Tier 11 Chunk 1 + Chunk 3)

Every color, shadow, radius, and font family is a CSS custom property defined in [src/index.css](src/index.css). Two themes ship:

- **Dark** (default) — color tokens on `:root`. `color-scheme: dark`. Brand glow shadows at full intensity.
- **Light** — color tokens overridden on `:root[data-theme='light']`. `color-scheme: light`. Brand glow dialed down so the cyan bloom doesn't dominate a white background.

Tailwind's [tailwind.config.js](tailwind.config.js) maps every semantic token via `rgb(var(--c-<name>) / <alpha-value>)` so utilities like `bg-base/80` keep working when the theme switches. Token names are semantic, not literal:

```
Surface:    bg-base, bg-elevated, bg-overlay
Foreground: text-fg, text-fg-muted, text-fg-subtle
Borders:    border-default, border-strong
Accent:     bg-accent / text-accent / ring-accent (+ -strong, -soft, -fg)
Status:     text-success / text-warning / text-danger / text-info
Radii:      rounded-xl, rounded-2xl, rounded-3xl
```

**The hardest invariant**: every component under `src/components/**` MUST use the tokenized utilities. Raw `slate-*` / `cyan-*` / `text-white` literals are **forbidden** because they bypass the light-mode override and look broken in the inverse theme. This is enforced by code review (no lint rule yet). The `tokenized utilities` rule does not extend to the marketing landing's BANTRYX wordmark glow, which intentionally uses literal cyan rgba so the brand colour doesn't shift between themes.

**Switching theme**: [src/lib/theme.js](src/lib/theme.js) `applyTheme(t)` mutates `<html data-theme='...'>` and sets `color-scheme`. `getStoredTheme()` reads `localStorage.sc_theme`; legacy `'system'` values (from before Tier 11 Chunk 3 removed system mode) normalize to `'dark'` on read. Theme is applied **synchronously in [main.jsx](src/main.jsx) before React mounts** so the user never sees a flash of the wrong palette.

**Toggle UI**: [src/components/ThemeToggle.jsx](src/components/ThemeToggle.jsx) sits in the top utility bar between SearchBar and NotificationBell.

### 6.9 Anonymous Browse Mode (standalone feature, pre-Tier 11)

Anonymous visitors can explore Games / Rankings / Public Groups / comments / public profiles / search **without an account**. Only actions (pick / undo / react / friend-request / public-group join / comment / create group) require sign-in.

**Backend surface** — see §8.18 for full detail. Public-read endpoints use `optionalAuth` instead of `authMiddleware`, paired with `publicReadLimiter`. Service-layer code branches on `req.user === null` to apply per-viewer masking and gate writes.

**Frontend gate UX**:

1. **`AuthGateContext.gate(label)`** — opens [src/components/SignInModal.jsx](src/components/SignInModal.jsx) with a contextual label ("Sign in to pick", "Sign in to react", "Sign in to send a friend request"). Used wherever an anon viewer clicks a button-style action.
2. **`<InlineGatePanel label="..." />`** — replaces large composer surfaces (the comment textarea, the "Create a new group" form) with a small "Sign in to …" card. Inline replacement reads more naturally than a modal pop-up for composer surfaces.

Both helpers are wired through `AuthGateContext`, which is the third provider in the stack ([src/main.jsx](src/main.jsx)).

**Component branches** for anon viewers:

| Component                          | Authed                                                 | Anonymous                                           |
| ---------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| `GameCard` pick / undo buttons     | Normal handlers                                        | `gate('Sign in to pick')`                           |
| `CommentThread` composer           | `<textarea>` + submit                                  | `<InlineGatePanel label="Sign in to comment">`      |
| `CommentThread` reaction buttons   | Toggle reaction                                        | `gate('Sign in to react')`                          |
| `FriendsList`                      | Full list + handlers                                   | Returns `null` (component bails)                    |
| Group create form                  | Visible                                                | `<InlineGatePanel>`                                 |
| Group "Join" button (discover row) | Normal handler                                         | `gate('Sign in to join this group')`                |
| `NotificationBell`, `UserMenu`     | Visible                                                | Hidden                                              |
| Top utility bar                    | UserMenu                                               | `[Sign in]` + `[Sign up]` + `[← Home]` pill buttons |
| `Sidebar` items                    | Games / My Picks / Groups / Rankings / Profile / Admin | Games / Groups / Rankings only                      |
| `ProfileDrawer` friend button      | Friend handlers                                        | `gate('Sign in to send a friend request')`          |

**Entry into anon-browse mode** is the [Landing](src/components/Landing.jsx) page's third CTA ("Or just browse as a guest →") which flips `AuthContext.browseAsGuest = true` (persisted to `localStorage.sc_browse_as_guest`).

**Exit**: clicking `[← Home]` in the top bar resets `browseAsGuest=false` + `showAuth=false` → back to Landing. Successful sign-up / sign-in from the auth grid also clears `browseAsGuest` (the user is now authed).

**`performLogout` post-Tier 11**: explicit sign-out is treated as a fresh visit, not a return to anon mode. It clears `browseAsGuest=false`, `showAuth=false`, AND `localStorage.sc_visited` so the user lands on the marketing Landing page after logout — even on refresh.

---

## 7. Database Architecture

### 7.1 Connection

A single Sequelize instance is configured in [models/index.js](models/index.js):

```js
new Sequelize(
  process.env.DATABASE_URL || {
    host: 'localhost',
    database: 'scorecast_db',
    username: 'postgres',
    password: 'postgres',
    dialect: 'postgres',
  },
);
```

If `DATABASE_URL` is set, it overrides everything else. Otherwise the local defaults apply. Connection pooling is left at Sequelize defaults (max 5).

### 7.2 Schema Initialization

On every server boot, `initDatabase()` runs (in order):

1. **`sequelize.authenticate()`** — fail fast if Postgres is unreachable.
2. **`sequelize.sync({ alter: false })`** — creates tables that don't exist yet. Does **not** modify existing tables. `alter: false` is deliberate: we don't trust Sequelize's auto-alter logic. Treat this as a dev safety net for brand-new tables; migrations are the source of truth.
3. **`runMigrations()`** — Tier 5.1: now a thin programmatic umzug invocation against `migrations/`. In production it's a no-op unless `MIGRATE_ON_BOOT=true` (production deploys should run `npm run db:migrate` explicitly).
4. **`seedDatabase()`** — only runs if the `users` table is empty; populates from [data.json](data.json) via `User.bulkCreate({individualHooks: true})` so the bcrypt hook fires per row.

### 7.3 Migrations Framework (Tier 5.1)

Schema evolution is managed by **sequelize-cli** (CLI for engineers + production deploys) and **umzug** (programmatic API used by the dev-mode boot path). Both read from the same `migrations/` directory and share the `SequelizeMeta` bookkeeping table, so either entry point applies the same set of versioned migrations exactly once.

**Layout**:

```
.sequelizerc                 → points sequelize-cli at the directories below
config/database.js           → dev/test/production blocks; reads DATABASE_URL or falls back to local Postgres
migrations/                  → versioned files (NNN-name.js), one per schema change
seeders/                     → idempotent seeders (e.g. password backfill)
```

**Scripts** (in [package.json](package.json)):
| Script | Effect |
| --- | --- |
| `npm run db:migrate` | Apply all pending migrations |
| `npm run db:migrate:undo` | Roll back the most recent migration |
| `npm run db:migrate:status` | Show `up` / `down` state per migration |
| `npm run db:seed` | Run all seeders (idempotent) |
| `npm run db:seed:undo` | Roll back all seeders (rarely useful) |

**Boot behavior**:

- **Development** (`NODE_ENV !== 'production'`): `runMigrations()` calls `umzug.up()` so the dev server is always on the latest schema with no manual step.
- **Production**: boot-time auto-migrate is **off** by default. Run `npm run db:migrate` as part of the deploy pipeline. Set `MIGRATE_ON_BOOT=true` to override (useful for single-node deploys where you accept the risk of a long boot pause).

**Full migration set** (all idempotent — they're no-ops against DBs that were upgraded by the old boot-time SQL):

| File                                               | Effect                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260513000001-add-user-role.js`                  | ENUM `enum_users_role` + `users.role` column                                                                                                                                                                                                                                                 |
| `20260513000002-pick-unique-index.js`              | `picks_user_game_unique (userId, gameId)`                                                                                                                                                                                                                                                    |
| `20260513000003-group-visibility-enum.js`          | ENUM `enum_groups_visibility` + `groups.visibility` column                                                                                                                                                                                                                                   |
| `20260513000004-friendship-pair-unique.js`         | Functional unique index on `LEAST/GREATEST(requesterId, addresseeId)`                                                                                                                                                                                                                        |
| `20260513000005-user-displayname-bio.js`           | `users.displayName VARCHAR(60)` + `users.bio TEXT`                                                                                                                                                                                                                                           |
| `20260513000006-comment-edited-at.js`              | `comments.editedAt TIMESTAMPTZ`                                                                                                                                                                                                                                                              |
| `20260513000007-comment-reactions-table.js`        | `CREATE TABLE comment_reactions IF NOT EXISTS` (existing DBs already had it from `sync({alter:false})`)                                                                                                                                                                                      |
| `20260513000008-user-login-attempts.js`            | Tier 6.6: `users.loginAttempts` + `users.lockedUntil`                                                                                                                                                                                                                                        |
| `20260513000009-user-email-columns.js`             | Tier 6.5: `users.email` + `users.emailVerifiedAt` + functional unique index `users_email_lower_unique` on `LOWER(email)`                                                                                                                                                                     |
| `20260513000010-email-verification-tokens.js`      | Tier 6.5: `CREATE TABLE email_verification_tokens`                                                                                                                                                                                                                                           |
| `20260513000011-password-reset-tokens.js`          | Tier 6.4: `CREATE TABLE password_reset_tokens`                                                                                                                                                                                                                                               |
| `20260513000012-refresh-tokens.js`                 | Tier 6.8: `CREATE TABLE refresh_tokens` + partial active-rows index                                                                                                                                                                                                                          |
| `20260513000013-user-totp.js`                      | Tier 6.9: `users.totpSecret`, `users.totpEnabledAt`, `users.totpRecoveryCodes` JSONB                                                                                                                                                                                                         |
| `20260514000001-disable-all-2fa.js`                | One-off operational fix: bulk-disable 2FA across all rows. Idempotent (no-op if already disabled). See file header for context                                                                                                                                                               |
| `20260516000001-users-add-onboarding.js`           | Tier 11 Chunk 4: `users.onboardingCompletedAt TIMESTAMPTZ NULLABLE` (NULL ⇒ first-run tour should fire)                                                                                                                                                                                      |
| `20260516000002-cascade-user-fks.js`               | Post-Tier-11 fix-up: retrofits `ON DELETE CASCADE` on prod user-owned FKs that were stuck at `NO ACTION` (see CLAUDE.md "Cascade-delete fix-up"). `DROP CONSTRAINT IF EXISTS` + re-`ADD CONSTRAINT … ON DELETE CASCADE` on every user-FK child table                                         |
| `20260516000003-users-add-profile-visibility.js`   | Tier 8.6: ENUM `enum_users_profileVisibility` + `users.profileVisibility` column (default `'public'`)                                                                                                                                                                                        |
| `20260518000001-create-leagues.js`                 | Tier 4b Chunk 1: `CREATE TABLE leagues` + unique `(sourceProvider, sourceLeagueId)`                                                                                                                                                                                                          |
| `20260518000002-create-seasons.js`                 | Tier 4b Chunk 1: `CREATE TABLE seasons` + unique `(leagueId, year)`                                                                                                                                                                                                                          |
| `20260518000003-games-add-league-season-source.js` | Tier 4b Chunk 1: `games.leagueId` (FK SET NULL initially), `games.seasonId`, `games.sourceId`, `games.homeScore`, `games.awayScore`, `games.kickoffTz`. Partial unique index `(leagueId, sourceId) WHERE sourceId IS NOT NULL`                                                               |
| `20260518000004-games-status-enum.js`              | Tier 4b Chunk 1: ENUM `enum_games_status` (`scheduled`, `in-progress`, `finished`, `postponed`, `cancelled`) + `games.status`                                                                                                                                                                |
| `20260518000005-games-add-live-phase.js`           | Tier 4b Chunk 2: `games.halfTimeReached BOOLEAN NOT NULL DEFAULT false` + `games.phase VARCHAR(20) DEFAULT 'regular'` for live-minute estimate                                                                                                                                               |
| `20260518000006-create-audit-log.js`               | Tier 4b Chunk 3: `CREATE TABLE audit_log` with `actorUserId ON DELETE SET NULL` (history survives admin removal). Index on `(createdAt DESC)`                                                                                                                                                |
| `20260518000007-games-tighten-league-not-null.js`  | Tier 4b Chunk 3: `games.leagueId NOT NULL`. Idempotent backfill: pre-tier orphan games are migrated into a synthetic `Legacy / Imported` league (`sourceProvider='legacy'`, `sourceLeagueId='LEGACY'`, `active=false`) + a current-year season BEFORE the `ALTER COLUMN ... SET NOT NULL`    |
| `20260518000008-games-add-draw-scoring.js`         | Draw-scoring tier: `games.drawProbability DECIMAL(3,2) NOT NULL DEFAULT 0` + `games.result` enum extended via `ALTER TYPE enum_games_result ADD VALUE IF NOT EXISTS 'draw'`. **Does not backfill** legacy `result=null + status='finished'` rows to `'draw'` (preserves leaderboard history) |

**Seeder set**:
| File | Effect |
| --- | --- |
| `seeders/20260513000001-seed-password-backfill.js` | Re-hashes any plaintext password that still matches a `data.json` entry. Skips already-bcrypt rows. |

**Rules for adding new migrations**:

- `npx sequelize-cli migration:generate --name <short-description>`, edit the generated `up` and `down`.
- Every `up` statement should be **safely re-runnable**: `IF NOT EXISTS` for columns/indexes/tables, and `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;` blocks for `CREATE TYPE`. This isn't required by sequelize-cli (which tracks applied migrations in `SequelizeMeta`), but matches our existing migrations and is friendly against DBs that pre-existed the migration framework.
- `down` paths are best-effort, intended for local rollback only. `DROP COLUMN IF EXISTS`, `DROP INDEX IF EXISTS`, etc.
- **Never** add raw DDL back into `runMigrations()` — that function is now a thin umzug shim.
- `migrations/` and `seeders/` are **versioned source code, not generated artifacts** — always commit them. The `.gitignore` carries a note to the same effect.
- See [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) for the full how-to and examples.

### 7.4 Tables

UUIDs are the universal primary-key type. All `id` columns are `UUID` with `defaultValue: DataTypes.UUIDV4`.

#### `users`

| Column                  | Type                                                         | Notes                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | UUID PK                                                      |                                                                                                                                                                                                                                              |
| `username`              | STRING UNIQUE NOT NULL                                       | Case-insensitive lookup via `iLike`. Regex `^[A-Za-z0-9_]+$` (validation/schemas.js — **underscores yes, hyphens no**; affects ML pipeline service account name)                                                                             |
| `password`              | STRING NOT NULL                                              | bcrypt hash (cost 10); the model's `beforeCreate`/`beforeUpdate` hooks auto-hash anything not already matching `^\$2[aby]\$`                                                                                                                 |
| `role`                  | ENUM('user','admin') NOT NULL DEFAULT 'user'                 | Added via migration                                                                                                                                                                                                                          |
| `displayName`           | VARCHAR(60) NULLABLE                                         | Tier 8. Used in place of username everywhere when set                                                                                                                                                                                        |
| `bio`                   | TEXT NULLABLE                                                | Tier 8. Length-capped at 280 by zod, no DB-level constraint                                                                                                                                                                                  |
| `email`                 | VARCHAR(254) NULLABLE                                        | Tier 6.5. Private (not exposed except on `GET /api/me`). Functional unique index `users_email_lower_unique` on `LOWER(email) WHERE email IS NOT NULL` for case-insensitive uniqueness that tolerates legacy null rows                        |
| `emailVerifiedAt`       | TIMESTAMPTZ NULLABLE                                         | Tier 6.5. Required to be non-null before `/api/auth/forgot-password` will dispatch a reset link                                                                                                                                              |
| `loginAttempts`         | INTEGER NOT NULL DEFAULT 0                                   | Tier 6.6. Incremented per bad password; cleared on success or password reset                                                                                                                                                                 |
| `lockedUntil`           | TIMESTAMPTZ NULLABLE                                         | Tier 6.6. When `> NOW()`, login returns generic 401                                                                                                                                                                                          |
| `totpSecret`            | TEXT NULLABLE                                                | Tier 6.9. base32-encoded TOTP secret. Populated by `/api/me/2fa/setup` but enabled only after `/api/me/2fa/confirm`                                                                                                                          |
| `totpEnabledAt`         | TIMESTAMPTZ NULLABLE                                         | Tier 6.9. `IS NOT NULL` ⇔ 2FA is required for this user's logins                                                                                                                                                                             |
| `totpRecoveryCodes`     | JSONB NULLABLE                                               | Tier 6.9. Array of bcrypt-hashed (rounds 8) single-use recovery codes. Used codes are spliced out                                                                                                                                            |
| `profileVisibility`     | ENUM('public','friends','private') NOT NULL DEFAULT 'public' | Tier 8.6. Gates `GET /api/users/:username/profile` (identical 404 for friends-gated-out and private — no friend-graph probing). Drives leaderboard masking via `LeaderboardService.getOverallForViewer`                                      |
| `onboardingCompletedAt` | TIMESTAMPTZ NULLABLE                                         | Tier 11 Chunk 4. NULL ⇒ first-run OnboardingTour fires on first valid render condition. Skip + Done both POST `/api/me/onboarding-completed` (idempotent — preserves existing timestamp)                                                     |
| `pushPreferences`       | JSONB NOT NULL DEFAULT '{}'                                  | PWA Chunk 4. Map of notification-type → boolean. Absent or `true` ⇒ deliver; only explicit `false` opts out. Empty `{}` = "deliver everything" implicit default                                                                              |
| `termsAcceptedAt`       | TIMESTAMPTZ NULLABLE                                         | Tier 18 Chunk 6. New registrations stamp this on create. Existing users at upgrade time land on NULL → blocking `<TermsAcceptanceModal />` on next sign-in                                                                                   |
| `termsAcceptedVersion`  | INTEGER NULLABLE                                             | Tier 18 Chunk 6. Compared against `CURRENT_TERMS_VERSION` in [validation/schemas.js](validation/schemas.js) (mirrored in [src/lib/terms.js](src/lib/terms.js)). Bumping the constant re-prompts every user with an older value on next visit |
| `createdAt`             | TIMESTAMPTZ NOT NULL DEFAULT NOW                             |                                                                                                                                                                                                                                              |

**Cascade behavior**: `users` → `badges`, `notifications`, `email_verification_tokens`, `password_reset_tokens`, `refresh_tokens` are `ON DELETE CASCADE` at the DB level. Post-Tier-11 [migration 20260516000002-cascade-user-fks.js](migrations/20260516000002-cascade-user-fks.js) retrofits this on prod DBs where the FKs were stuck at `NO ACTION` due to the original `sync({alter:false})` bootstrap path running before migrations (see CLAUDE.md "Cascade-delete fix-up"). Group ownership (`groups.ownerId`), picks, comments, friendships, group_members, and invites (by username) are **app-level cleanup** in `UserService.cascadeDelete` because they need ordering / disambiguation logic the DB can't express.

#### `games`

| Column                                                    | Type                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                      | UUID PK                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                               |
| `homeTeam` / `awayTeam`                                   | STRING NOT NULL                                                             |                                                                                                                                                                                                                                                                                                                                                                                                               |
| `date`                                                    | TIMESTAMPTZ NOT NULL                                                        | UTC; the kickoff time                                                                                                                                                                                                                                                                                                                                                                                         |
| `homeProbability` / `drawProbability` / `awayProbability` | DECIMAL(3,2) NOT NULL                                                       | All three required; `drawProbability` defaults to 0 for backward compat. Validator enforces `home + draw + away = 1.0 ± 0.01`. Default for fresh fixtures: `(0.50, 0.00, 0.50)` (ML pipeline sentinel)                                                                                                                                                                                                        |
| `result`                                                  | ENUM('home','away','draw') NULLABLE                                         | `NULL` = not yet resolved; `'draw'` (post-draw-scoring tier) awards partial credit via `scorePick`'s draw branch                                                                                                                                                                                                                                                                                              |
| `leagueId`                                                | UUID NOT NULL → `leagues(id)` (Tier 4b Chunk 1; tightened NOT NULL Chunk 3) | Backfilled to a synthetic `Legacy / Imported` league for pre-tier rows                                                                                                                                                                                                                                                                                                                                        |
| `seasonId`                                                | UUID NULLABLE → `seasons(id)`                                               | Tier 4b Chunk 1. Created on demand by `LeagueService.ensureSeason` during sync                                                                                                                                                                                                                                                                                                                                |
| `sourceId`                                                | VARCHAR NULLABLE                                                            | Tier 4b Chunk 1. football-data.org's internal match id. Used by `applyLiveUpdate` to look up local rows. Partial unique index `(leagueId, sourceId) WHERE sourceId IS NOT NULL` — hand-entered rows skip the constraint                                                                                                                                                                                       |
| `status`                                                  | ENUM('scheduled','in-progress','finished','postponed','cancelled') NOT NULL | Tier 4b Chunk 1. Set by `LeagueService.upsertFixture` (manual + daily sync) and `GameService.applyLiveUpdate` (60-s live poll). `GameService.setResult` flips `status` alongside `result` so manual admin entries stay consistent                                                                                                                                                                             |
| `homeScore` / `awayScore`                                 | INTEGER NULLABLE                                                            | Tier 4b Chunk 1. Final score on `status='finished'`; live score on `status='in-progress'`                                                                                                                                                                                                                                                                                                                     |
| `kickoffTz`                                               | VARCHAR(64) NULLABLE                                                        | Tier 4b Chunk 1. Stadium-local timezone string (informational only; UI renders in user's local TZ)                                                                                                                                                                                                                                                                                                            |
| `halfTimeReached`                                         | BOOLEAN NOT NULL DEFAULT false                                              | Tier 4b Chunk 2. Flips to true once upstream populates `score.halfTime`. **Monotonic** in `applyLiveUpdate` (never reverts on upstream blip)                                                                                                                                                                                                                                                                  |
| `phase`                                                   | VARCHAR(20) NULLABLE                                                        | Tier 4b Chunk 2. `regular` / `extra-time` / `penalty-shootout` (from upstream `score.duration`). Drives `matchMinute`'s ET/PEN display branches                                                                                                                                                                                                                                                               |
| `homeEloPre`                                              | NUMERIC(8,2) NULLABLE                                                       | Tier 17 PR F. Home team's Elo at FIRST result capture. Immutable after first store — reverse + reapply on result change uses this as the reference snapshot                                                                                                                                                                                                                                                   |
| `awayEloPre`                                              | NUMERIC(8,2) NULLABLE                                                       | Tier 17 PR F. Away team's Elo at first result capture. Same immutability contract as `homeEloPre`                                                                                                                                                                                                                                                                                                             |
| `appliedResult`                                           | VARCHAR(10) NULLABLE                                                        | Tier 17 PR F. The result value the cascade has Elo-applied. Mirrors the `result` enum. When `result === appliedResult` the cascade short-circuits as a no-op; when they differ, the cascade reverses + reapplies against the snapshot                                                                                                                                                                         |
| `kickoffReminderSentAt`                                   | TIMESTAMPTZ NULLABLE                                                        | PWA Chunk 6. Stamped after the 15-min-before-kickoff push fan-out lands. Dedups across cron ticks. Indexed via the `sendKickoffReminders` job's WHERE clause                                                                                                                                                                                                                                                  |
| `pickProbabilitiesLockedAt`                               | TIMESTAMPTZ NULLABLE                                                        | Tier 19 Chunk 5. Stamped at the moment every Pick on this game has its three `picked*Probability` snapshots overwritten with the game's then-current probabilities. After this stamp, every pick on the game scores identically for a given choice. Partial index `games_unlocked_scheduled_idx` on `(status, date) WHERE pickProbabilitiesLockedAt IS NULL` keeps the lock cron's hot query cheap. See §8.28 |

**Result derivation invariant**: `result` is only set automatically (by `applyLiveUpdate` or `upsertFixture`) when `localGame.result === null`. Admin-entered results are never clobbered by upstream updates. See `lib/fixtureStatus.js deriveResultFromFixture` for the upstream → local mapping (prefers `score.winner` over score comparison so penalty-shootout knockouts resolve correctly).

**Tier 17 cascade invariants** (see §8.17 for the full mechanism):

- `appliedResult` starts NULL on every fresh `games` row. The cascade's first call stamps it. Idempotent re-saves with the same `result` short-circuit on the equality check.
- `homeEloPre` + `awayEloPre` snapshot at first apply only — they're the pre-match Elo reference for reverse + reapply, never refreshed from live team Elo.
- On result clear (NULL): cascade reverses the prior delta against the snapshot, nulls all three columns. A subsequent re-set re-snapshots from then-current live Elo.

#### `groups`

| Column       | Type                                                | Notes                                        |
| ------------ | --------------------------------------------------- | -------------------------------------------- |
| `id`         | UUID PK                                             |                                              |
| `name`       | STRING NOT NULL                                     |                                              |
| `ownerId`    | UUID NOT NULL                                       | FK loose (no DB constraint); enforced in app |
| `visibility` | ENUM('private','public') NOT NULL DEFAULT 'private' |                                              |
| `createdAt`  | TIMESTAMPTZ NOT NULL DEFAULT NOW                    |                                              |

#### `group_members`

Composite primary key `(groupId, userId)`. No additional columns.

#### `group_invites`

| Column      | Type                    | Notes                                                                              |
| ----------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `id`        | UUID PK                 |                                                                                    |
| `groupId`   | UUID NOT NULL           |                                                                                    |
| `username`  | STRING NOT NULL         | Stored as username, not userId, so case-insensitive invites resolve at accept-time |
| `createdAt` | TIMESTAMPTZ DEFAULT NOW |                                                                                    |

#### `picks`

| Column        | Type                         | Notes                            |
| ------------- | ---------------------------- | -------------------------------- |
| `id`          | UUID PK                      |                                  |
| `userId`      | UUID NOT NULL                |                                  |
| `gameId`      | UUID NOT NULL                |                                  |
| `choice`      | ENUM('home','away') NOT NULL |                                  |
| `submittedAt` | TIMESTAMPTZ DEFAULT NOW      | Updated on edit, not just create |

**Unique index**: `picks_user_game_unique (userId, gameId)`. App-level upsert is in `POST /api/picks`.

#### `badges`

| Column      | Type                                        | Notes                                                |
| ----------- | ------------------------------------------- | ---------------------------------------------------- |
| `id`        | UUID PK                                     |                                                      |
| `userId`    | UUID NOT NULL → users(id) ON DELETE CASCADE |                                                      |
| `slug`      | STRING NOT NULL                             | Must exist in [badges/catalog.js](badges/catalog.js) |
| `awardedAt` | TIMESTAMPTZ DEFAULT NOW                     |                                                      |

**Unique index**: `badges_user_slug_unique (userId, slug)`. `awardBadge()` relies on the constraint to make repeated calls idempotent (catches the conflict).

#### `friendships`

| Column                        | Type                                                  | Notes                                                                                                |
| ----------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                          | UUID PK                                               |                                                                                                      |
| `requesterId` / `addresseeId` | UUID NOT NULL → users(id)                             | `ON DELETE NO ACTION` (Sequelize default); the user-delete admin endpoint cleans these up explicitly |
| `status`                      | ENUM('pending','accepted') NOT NULL DEFAULT 'pending' |                                                                                                      |
| `createdAt`                   | TIMESTAMPTZ DEFAULT NOW                               |                                                                                                      |
| `acceptedAt`                  | TIMESTAMPTZ NULLABLE                                  | Set on accept                                                                                        |

**Unique functional index**: `friendships_pair_unique (LEAST(requesterId, addresseeId), GREATEST(requesterId, addresseeId))`. This prevents both `(A, B)` and `(B, A)` from existing simultaneously, regardless of who sent the request. Postgres-only feature.

#### `comments`

| Column      | Type                                          | Notes                                                                                                                                                            |
| ----------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | UUID PK                                       |                                                                                                                                                                  |
| `gameId`    | UUID NULLABLE → games(id) ON DELETE CASCADE   | Tier 18 Chunk 5: dropped from NOT NULL to NULLABLE. Either `gameId` OR `groupId` must be set (CHECK constraint below); both-set / both-null fail at the DB level |
| `groupId`   | UUID NULLABLE → groups(id) ON DELETE CASCADE  | Tier 18 Chunk 5. Adds the second comment scope ("group running comments"). One of `gameId` / `groupId` is set per row                                            |
| `userId`    | UUID NOT NULL → users(id) ON DELETE NO ACTION | Cleaned up in admin user-delete                                                                                                                                  |
| `body`      | TEXT NOT NULL                                 | Validation: trim, 1–500 chars                                                                                                                                    |
| `createdAt` | TIMESTAMPTZ DEFAULT NOW                       |                                                                                                                                                                  |
| `editedAt`  | TIMESTAMPTZ NULLABLE                          | Tier 8. Set on every successful `PUT /api/comments/:id`. Frontend renders `(edited)` in the row                                                                  |

**Indexes**: `comments_game_idx (gameId)` for fast game-thread fetch; `comments_group_idx (groupId) WHERE groupId IS NOT NULL` (Tier 18 Chunk 5) for fast group-thread fetch.

**CHECK constraint** (Tier 18 Chunk 5): `comments_one_scope_chk` enforces `(gameId IS NOT NULL)::int + (groupId IS NOT NULL)::int = 1` — exactly one scope per row. Both `CommentService.list` and `CommentService.create` re-assert this at the service layer (`assertSingleScope({gameId, groupId})`) so a programmer error surfaces as a recognizable 400 instead of a Postgres CHECK violation.

#### `comment_reactions` (Tier 8)

| Column      | Type                                           | Notes                                                                          |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `id`        | UUID PK                                        |                                                                                |
| `commentId` | UUID NOT NULL → comments(id) ON DELETE CASCADE |                                                                                |
| `userId`    | UUID NOT NULL                                  | Cleaned up in admin user-delete (best-effort)                                  |
| `emoji`     | STRING NOT NULL                                | Free-form at the DB layer, gated by `ALLOWED_EMOJIS` zod enum at the API layer |
| `createdAt` | TIMESTAMPTZ DEFAULT NOW                        |                                                                                |

**Unique index**: `comment_reactions_unique (commentId, userId, emoji)` — `POST /api/comments/:id/reactions` relies on the constraint for idempotency (catches the duplicate-insert error).
**Index**: `comment_reactions_comment_idx (commentId)` for fast thread fetch.

#### `notifications`

| Column      | Type                                        | Notes                                                                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`        | UUID PK                                     |                                                                                                                                                                                                                                                                                |
| `userId`    | UUID NOT NULL → users(id) ON DELETE CASCADE |                                                                                                                                                                                                                                                                                |
| `type`      | STRING NOT NULL                             | Free-form: `invite`, `pick-scored`, `friend-request`, `group-join`, `badge`. **Not an ENUM** so adding new types doesn't require a migration                                                                                                                                   |
| `title`     | STRING NOT NULL                             |                                                                                                                                                                                                                                                                                |
| `body`      | TEXT NULLABLE                               |                                                                                                                                                                                                                                                                                |
| `link`      | STRING NULLABLE                             | Deep-link URL (e.g. `/?view=profile`, `/?gameId=<id>`). Populated by every `notify()` call site (Tier 18 Chunk 6a). Consumed by three surfaces: boot `consumeDeepLinks`, SW `notificationclick`, in-app `NotificationBell` click via `navigateToDeepLink` (Tier 19 follow-up). |
| `read`      | BOOLEAN NOT NULL DEFAULT false              |                                                                                                                                                                                                                                                                                |
| `createdAt` | TIMESTAMPTZ DEFAULT NOW                     |                                                                                                                                                                                                                                                                                |

**Index**: `notifications_user_read_idx (userId, read, createdAt)`.

#### `email_verification_tokens` (Tier 6.5)

| Column       | Type                                        | Notes                                                                 |
| ------------ | ------------------------------------------- | --------------------------------------------------------------------- |
| `id`         | UUID PK                                     |                                                                       |
| `userId`     | UUID NOT NULL → users(id) ON DELETE CASCADE |                                                                       |
| `tokenHash`  | VARCHAR(64) UNIQUE NOT NULL                 | SHA-256 hex of the raw token. Raw value only exists in the email link |
| `expiresAt`  | TIMESTAMPTZ NOT NULL                        | 24h after issue                                                       |
| `consumedAt` | TIMESTAMPTZ NULLABLE                        | Set on first successful verify. Single-use semantics                  |
| `createdAt`  | TIMESTAMPTZ NOT NULL DEFAULT NOW            |                                                                       |

**Index**: `email_verification_tokens_user_idx (userId)`.

#### `password_reset_tokens` (Tier 6.4)

Same shape as `email_verification_tokens` — `id`, `userId` FK cascade, `tokenHash` unique, `expiresAt` (15-min), `consumedAt`, `createdAt`. Indexed by `userId`.

#### `refresh_tokens` (Tier 6.8)

| Column      | Type                                        | Notes                                                                                                                   |
| ----------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`        | UUID PK                                     |                                                                                                                         |
| `userId`    | UUID NOT NULL → users(id) ON DELETE CASCADE |                                                                                                                         |
| `tokenHash` | VARCHAR(64) UNIQUE NOT NULL                 | SHA-256 hex of the raw refresh token (sent only via `sc_refresh` cookie)                                                |
| `expiresAt` | TIMESTAMPTZ NOT NULL                        | 30 days after issue                                                                                                     |
| `revokedAt` | TIMESTAMPTZ NULLABLE                        | Set by `/api/auth/refresh` rotation, `/api/auth/logout`, and `/api/auth/reset-password` (revokes all rows for the user) |
| `userAgent` | TEXT NULLABLE                               | Truncated to 500 chars; informational only                                                                              |
| `createdAt` | TIMESTAMPTZ NOT NULL DEFAULT NOW            |                                                                                                                         |

**Indexes**: `refresh_tokens_user_idx (userId)`, partial `refresh_tokens_active_idx (userId) WHERE revokedAt IS NULL`.

#### `leagues` (Tier 4b Chunk 1)

| Column                    | Type                             | Notes                                                                                                              |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                      | UUID PK                          |                                                                                                                    |
| `name`                    | VARCHAR NOT NULL                 | Display name (e.g. "Premier League")                                                                               |
| `sourceProvider`          | VARCHAR NOT NULL                 | Provider key. Currently `'football-data.org'` + `'legacy'` (synthetic backfill league only). Future swap goes here |
| `sourceLeagueId`          | VARCHAR NOT NULL                 | Provider-side competition code (e.g. `PL`, `BSA`, `CL`). **Shareable across DB rebuilds** — frontend URL uses this |
| `country`                 | VARCHAR NULLABLE                 |                                                                                                                    |
| `logoUrl`                 | VARCHAR NULLABLE                 |                                                                                                                    |
| `active`                  | BOOLEAN NOT NULL DEFAULT true    | Daily sync + live-score poll iterate `active=true` only                                                            |
| `createdAt` / `updatedAt` | TIMESTAMPTZ NOT NULL DEFAULT NOW |                                                                                                                    |

**Unique index**: `leagues_provider_id_unique (sourceProvider, sourceLeagueId)`. Seeded with `Premier League / PL` (active) + `FIFA World Cup / WC` (inactive). `BSA` + `CLI` added manually during live-match QA.

#### `seasons` (Tier 4b Chunk 1)

| Column                    | Type                                            | Notes                                                                 |
| ------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| `id`                      | UUID PK                                         |                                                                       |
| `leagueId`                | UUID NOT NULL → `leagues(id)` ON DELETE CASCADE |                                                                       |
| `year`                    | INTEGER NOT NULL                                | Calendar year the season ENDS in (`2026` = 2025/26 season)            |
| `startsAt`                | TIMESTAMPTZ NULLABLE                            |                                                                       |
| `endsAt`                  | TIMESTAMPTZ NULLABLE                            |                                                                       |
| `current`                 | BOOLEAN NOT NULL DEFAULT false                  | Convenience flag; only one season per league should be true at a time |
| `createdAt` / `updatedAt` | TIMESTAMPTZ NOT NULL DEFAULT NOW                |                                                                       |

**Unique index**: `seasons_league_year_unique (leagueId, year)`. Created on demand by `LeagueService.ensureSeason(leagueId, year)`.

#### `teams` (Tier 17)

| Column                    | Type                                            | Notes                                                                                                                                                      |
| ------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | UUID PK                                         | `gen_random_uuid()` default                                                                                                                                |
| `name`                    | VARCHAR(128) NOT NULL                           | Canonical football-data.org form (e.g. `Manchester City FC`, NOT `Man City`). The seeder + `LeagueService.ensureTeamExists` both write this canonical form |
| `leagueId`                | UUID NOT NULL → `leagues(id)` ON DELETE CASCADE | Per-league Elo space. Same canonical name may appear in multiple leagues (e.g. a club in CL + PL) without collision                                        |
| `elo`                     | NUMERIC(8, 2) NOT NULL DEFAULT 1500             | Sequelize returns DECIMAL as STRING — services parseFloat before math. NUMERIC (not FLOAT) avoids drift over years of K=20 updates                         |
| `gamesPlayed`             | INTEGER NOT NULL DEFAULT 0                      | Increments on first result capture per game; decrements on result clear (PR F); unchanged on result change (net 0 across reverse + reapply)                |
| `lastMatchDate`           | DATE NULLABLE                                   | Date of the most recent match the team's Elo was updated for. Stamped by `PredictionService.onResultUpdated` on apply (not on reverse/clear)               |
| `createdAt` / `updatedAt` | TIMESTAMPTZ NOT NULL DEFAULT NOW                |                                                                                                                                                            |

**Indexes**: `teams_name_league_unique (name, "leagueId")` UNIQUE — load-bearing for the seeder's `ON CONFLICT DO NOTHING` + the runtime cascade's per-team lookup. `teams_league_idx ("leagueId")` non-unique for league-wide queries (e.g. backfill script's per-league fetch).

**Two write paths populate this table**:

- **Initial seed** — [seeders/20260522000001-seed-teams-from-elo-history.js](seeders/20260522000001-seed-teams-from-elo-history.js) walks the committed PL CSV history and writes every team's post-history Elo. Idempotent (re-runs preserve live Elo via ON CONFLICT). NOT auto-run by CD — operator invokes once after first prod deploy.
- **Runtime auto-insert** — [services/LeagueService.js](services/LeagueService.js) `ensureTeamExists` inserts new teams at the league's current `MIN(elo)` (falling back to 1500 when the league is empty). Fires on every `upsertFixture` call so newly-promoted clubs land in the table before their first cascade.

**Cascade write path**: `PredictionService.onResultUpdated` updates `elo` + `gamesPlayed` (+`lastMatchDate` on apply) under `SELECT ... FOR UPDATE` row locks. Concurrent result captures involving the same team serialize cleanly via the row locks.

#### `audit_log` (Tier 4b Chunk 3)

| Column        | Type                                               | Notes                                                                                                                                                                                          |
| ------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | UUID PK                                            |                                                                                                                                                                                                |
| `actorUserId` | UUID NULLABLE → `users(id)` ON DELETE **SET NULL** | History survives admin removal. SET NULL (not CASCADE) is deliberate — when an admin is deleted we want their actions still trail-able by `entityId` + `action` even if we lose their identity |
| `action`      | VARCHAR NOT NULL                                   | Dotted shape `admin.<entity>.<verb>` (e.g. `admin.game.delete`, `admin.user.bulk`, `admin.league.sync`)                                                                                        |
| `entityType`  | VARCHAR NOT NULL                                   | `'game'`, `'user'`, `'league'`, `'group'`, etc.                                                                                                                                                |
| `entityId`    | UUID NULLABLE                                      | For DELETE actions, the entity that no longer exists                                                                                                                                           |
| `before`      | JSONB NULLABLE                                     | Currently always NULL except for DELETE actions (no per-entity pre-fetch hooks yet — limitation listed in §12)                                                                                 |
| `after`       | JSONB NULLABLE                                     | The captured request body (truncated at 4 KB by `AuditLogService.truncatePayload` → `{_truncated, _bytes, preview: 'first 512 chars'}`)                                                        |
| `requestId`   | VARCHAR NULLABLE                                   | Mirrors `X-Request-Id` so an audit-log row joins to the matching server log line                                                                                                               |
| `statusCode`  | INTEGER NULLABLE                                   | The final `res.statusCode` (200, 400, 409, 500 — the actual outcome, since the middleware records via `res.on('finish')`)                                                                      |
| `createdAt`   | TIMESTAMPTZ NOT NULL DEFAULT NOW                   |                                                                                                                                                                                                |

**Index**: `audit_log_createdAt_idx (createdAt DESC)` for the paginated `GET /api/admin/audit-log` view.

### 7.5 Cascade Behavior Summary

| Parent → Child                                                                                               | On parent delete                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `games` → `picks`                                                                                            | App-level cleanup in `GameService.cascadeDelete()` (single + bulk admin paths)                                                                                                                                                                                        |
| `games` → `comments`                                                                                         | `ON DELETE CASCADE` at DB level **and** app-level cleanup in `GameService.cascadeDelete()` (belt-and-braces)                                                                                                                                                          |
| `comments` → `comment_reactions`                                                                             | `ON DELETE CASCADE` at DB level + explicit `CommentReaction.destroy({where: {commentId}})` in `DELETE /api/comments/:id`                                                                                                                                              |
| `users` → `badges`, `notifications`, `email_verification_tokens`, `password_reset_tokens`, `refresh_tokens`  | `ON DELETE CASCADE` at DB level (retrofitted by [migration 20260516000002-cascade-user-fks.js](migrations/20260516000002-cascade-user-fks.js)) **AND** explicit destroys in `UserService.cascadeDelete()` for belt-and-braces — see CLAUDE.md "Cascade-delete fix-up" |
| `users` → `picks`, `comments`, `friendships`, `group_members`, owned `groups`, `group_invites` (by username) | **App-level cleanup only** in `UserService.cascadeDelete()` (single + bulk admin paths). The user-delete handler is the most complex deletion path in the system; see §8.9                                                                                            |
| `users` → `audit_log` (`actorUserId`)                                                                        | **SET NULL** at DB level — history survives admin removal                                                                                                                                                                                                             |
| `groups` → `group_members`, `group_invites`                                                                  | App-level cleanup in `GroupService.cascadeDelete()` (Tier 8)                                                                                                                                                                                                          |
| `leagues` → `seasons`                                                                                        | `ON DELETE CASCADE` at DB level                                                                                                                                                                                                                                       |
| `leagues` → `teams` (Tier 17)                                                                                | `ON DELETE CASCADE` at DB level — deleting a league drops every Elo state for that league. Re-seeding required to bootstrap a re-created league                                                                                                                       |
| `leagues` → `games`                                                                                          | `SET NULL` historically; post-Tier-4b Chunk 3 `games.leagueId NOT NULL` — deletion of a league with active games requires admin-side migration first                                                                                                                  |
| `games` → `teams` (Tier 17 logical link, no FK)                                                              | None — `games.homeTeam` / `awayTeam` are STRING name references, not FK UUIDs. The cascade looks up by `(name, leagueId)` so deleting a `teams` row doesn't break anything except the next cascade for that team (it'll be auto-inserted at MIN(elo))                 |

---

## 8. Domain Subsystems

### 8.1 Scoring System

```
function scorePick(pick, game):
  if not game.result or not pick: return 0
  if game.result == 'draw':
    # Partial credit per the draw-scoring tier. Picks remain winner-only;
    # a 'draw' result just pays out by how "structurally close" the pick
    # was to the actual outcome, weighted by the draw's modeled probability.
    opposite = game.awayProbability if pick.choice == 'home' else game.homeProbability
    return round((game.drawProbability * opposite / (game.homeProbability + game.awayProbability)) * 100)
  winning = (pick.choice == game.result)
  if not winning: return 0
  probability = game.homeProbability if pick.choice == 'home' else game.awayProbability
  return round((1 - probability) * 100)
```

**The formula is intentionally duplicated** in two places:

- [lib/scoring.js](lib/scoring.js) — authoritative, used by `lib/users.js` `buildUserSummary` + `lib/groups.js` `buildGroupLeaderboard` to compute leaderboards and by `services/GameService.js` `setResult` / `bulkSetResult` / `applyLiveUpdate` to compute per-user notification points.
- [src/utils/scoring.js](src/utils/scoring.js) — client-side preview, used by `GameCard` to render the outcome badge (`✓ Correct +N pts` / `Drew +N pts`), by `PicksHistory` for per-pick points, and by `PayoutMatrix` (via `expectedWinPoints` + `expectedDrawPoints`) to show payout previews on upcoming game cards.

**Why duplicated**: there is no shared module strategy (no monorepo, no bundle of server-shared code). The cost is small (10 lines) and a comment in [CLAUDE.md](CLAUDE.md) flags the sync requirement.

**Why these two must stay in lockstep**: if they diverge, users will see "+N pts" on the frontend that doesn't match the leaderboard total. Any future change touches both files in the same commit.

`pickStatus(pick, game)` (frontend only) returns `'won' | 'lost' | 'pending' | 'live' | 'no-pick'` and is used for badge colors in `GameCard` and `PicksHistory`.

### 8.2 Picks Lifecycle

```
created (user submits)  ──┐
                          ├── pick.choice toggles → submittedAt updated
edited (user re-submits)  ──┘    pickedHomeProbability / pickedDrawProbability /
                          │      pickedAwayProbability snapshots written from
                          │      game.* (placeholder — overwritten at kickoff)
                          ▼
                  game.date passes
                          │
                          ▼
           ─── Tier 19 Chunk 5 kickoff lock fires ───
           Cron OR applyLiveUpdate bulk-UPDATEs every
           Pick on the game with game.{home,draw,away}Probability
           and stamps games.pickProbabilitiesLockedAt.
           After this, every pick on the game scores
           against IDENTICAL probabilities.
                          │
                          ▼
              admin sets game.result
                          │
                          ▼
              scorePick(pick, game) returns N (reads from the locked snapshot)
              evaluateBadges(userId) fires (correct counters update)
              notify(userId, 'pick-scored', ...) fires
```

**Lock rules** (enforced in `POST /api/picks` and `DELETE /api/picks/:id`):

- `game.date <= now` → 400 `Picks can only be created or changed for upcoming games` (POST) / `Picks can only be removed before kickoff` (DELETE)
- `game.result !== null` → same error in both directions

**Pick deletion** (Tier 8.2): `DELETE /api/picks/:id` lets a user **undo** their own pick before kickoff. The frontend [GameCard.jsx](src/components/GameCard.jsx) renders an "Undo pick" link only when the game is upcoming and the user has a pick. Admin user-delete still cascades picks for departed users.

**Kickoff-time lock** (Tier 19 Chunk 5): see §8.28 for the full subsystem walkthrough. Tl;dr — the three `pickedHomeProbability` / `pickedDrawProbability` / `pickedAwayProbability` snapshot columns on a Pick row are still WRITTEN at pick-create time (so any "what would I score right now" UI preview works), but the AUTHORITATIVE value is the kickoff-time overwrite. Every pick on the same game scores against identical numbers; the "pick early at long odds" loop is intentionally gone.

### 8.3 Groups Subsystem

Three primitives: **Group**, **GroupMember**, **GroupInvite**.

| Action            | Endpoint                                             | Effect                                                                                                                                       |
| ----------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Create            | `POST /api/groups`                                   | Inserts Group + GroupMember (creator). Fires `group-founder` badge eval. Body accepts `visibility: 'private' \| 'public'` (default private). |
| Invite            | `POST /api/groups/:groupId/invite`                   | Member-only. Stores `GroupInvite { groupId, username }`. Notifies invitee.                                                                   |
| Accept invite     | `POST /api/groups/:groupId/invite/:inviteId/accept`  | Username on JWT must match invite username. Inserts GroupMember, deletes the invite, notifies owner.                                         |
| Decline invite    | `POST /api/groups/:groupId/invite/:inviteId/decline` | Just deletes the invite row.                                                                                                                 |
| Discover          | `GET /api/groups/discover`                           | Returns up to 20 public groups the caller is **not** in, with member counts.                                                                 |
| Join (public)     | `POST /api/groups/:groupId/join`                     | Only succeeds if `visibility='public'`. Inserts GroupMember, notifies owner.                                                                 |
| Leave (Tier 8)    | `POST /api/groups/:groupId/leave`                    | Removes caller from `group_members`. **400 if owner** — must transfer first. Notifies owner.                                                 |
| Transfer (Tier 8) | `POST /api/groups/:groupId/transfer`                 | Owner-only. Body `{newOwnerId}`. Must be a current member. Updates `groups.ownerId`. Notifies new owner.                                     |
| Delete (Tier 8)   | `DELETE /api/groups/:groupId`                        | Owner-only. Cascades members + invites, then destroys the group. Notifies all (former) non-owner members.                                    |
| Toggle visibility | `POST /api/groups/:groupId/visibility`               | Owner-only.                                                                                                                                  |

**Invite storage choice**: invites are keyed by username (string), not userId. This means renaming a user (not currently possible) would orphan their invites. Acceptable trade-off for now.

### 8.4 Friendships Subsystem

A friendship is **one row** representing an unordered pair `{requesterId, addresseeId}`. The `friendships_pair_unique` functional index ensures only one row can exist per pair regardless of direction.

States:

- `pending` → only the `addressee` can accept or decline; either party can cancel (DELETE).
- `accepted` → either party can unfriend (DELETE).

`GET /api/users/:username/profile` includes `friendStatus`:

- `'self'` — viewer is the target
- `'friends'` — accepted row exists
- `'pending-out'` — viewer requested
- `'pending-in'` — viewer was requested
- `'none'` — no row

When `friendStatus === 'friends'`, the profile additionally includes `headToHead: { viewerWins, targetWins, ties }` computed over all completed games where **both** users picked. Ties = same point total (which under `winner`-only scoring means both right or both wrong).

### 8.5 Badges Subsystem

Two collaborating pieces:

**Catalog** — [badges/catalog.js](badges/catalog.js) is a flat array of `{slug, name, description, emoji}`. The frontend's `BadgeWall` renders one tile per catalog entry, gray-scaled if the user hasn't earned it. Adding a new badge means editing this file **and** adding an unlock condition.

**Evaluator** — `evaluateBadges(userId, ctx)` in [server.js](server.js) reads the user's current picks + the games' results, computes:

- total correct picks
- count of correct picks where the chosen team had probability < 0.4 (upset wins)
- whether `ctx.groupCreated` was set

…then calls `awardBadge(userId, slug)` for each newly-eligible badge. The DB's unique `(userId, slug)` constraint makes repeat calls idempotent: `awardBadge` catches the duplicate-insert error and returns `false`.

**Trigger points** (must all call `evaluateBadges` after their primary action):

- `POST /api/picks` — for first-pick.
- `POST /api/games/:gameId/result` — for every user with a pick on this game (so first-win, correct-N, upset-specialist can land).
- `POST /api/groups` — with `{ groupCreated: true }` for group-founder.

If you add a new endpoint that records a pick-shaped event, you must call `evaluateBadges` too — there is no event bus.

### 8.6 Notifications Subsystem

```
notify(userId, type, title, body=null, link=null)
  └─→ Notification.create({ userId, type, title, body, link, read: false })
       (errors swallowed with a warn-log)
```

`type` is a free-form string (not ENUM) for the in-app row but constrained to `PUSH_NOTIFICATION_TYPES` in [validation/schemas.js](validation/schemas.js) for the per-type push preferences UI. Current types: `invite`, `pick-scored`, `friend-request`, `group-join`, `badge`, `odds-shifted`, `kickoff-reminder`, `group-comment` (Tier 18 Chunk 5). Adding a new type for a push category requires editing BOTH `PUSH_NOTIFICATION_TYPES` AND `NOTIFICATION_TYPES` in [src/components/PushSettingsPanel.jsx](src/components/PushSettingsPanel.jsx) in the same commit.

**`link` field** (Tier 18 Chunk 6a, extended in Tier 19 follow-up) — every `notify()` call site passes a deep-link URL. Three consumers fire on a populated `link`: (1) boot — `DataContext.consumeDeepLinks` reads `?view=` / `?gameId=` / `?groupId=` ONCE inside `loadDashboard().then(...)`; (2) Web Push click — `src/sw.js`'s `notificationclick` handler calls `clients.openWindow(data.link)`, a cold load that lands on consumer (1); (3) **in-app `NotificationBell` row click** — `DataContext.navigateToDeepLink(n.link)` `history.pushState`s the URL and re-runs `consumeDeepLinks` in-process, then closes the popover. Convention table + consumer details in §6.2 above.

**Polling**: `NotificationBell` calls `GET /api/notifications` (which returns `{items, unreadCount}`) every 30 s. The unread count drives a red badge on the bell icon. Marking-as-read is local-then-remote: the UI optimistically dims the item and decrements the count, then fires `POST /api/notifications/:id/read`.

**`read-all`** clears every unread notification for the caller in a single `UPDATE notifications SET read=true WHERE userId=... AND read=false`.

### 8.7 Comments Subsystem

**Two scopes, one row shape** (Tier 18 Chunk 5):

| Scope                     | Mounted in                                                                               | Thread URL                               | Composer authz                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `game` (legacy default)   | `GameCard` via `<CommentThread scope="game" scopeId={game.id} />`                        | `GET/POST /api/games/:gameId/comments`   | Any authenticated user                                           |
| `group` (Tier 18 Chunk 5) | `GroupCard` for members + owner via `<CommentThread scope="group" scopeId={group.id} />` | `GET/POST /api/groups/:groupId/comments` | Group members only (non-member POST → 403 even on public groups) |

The `comments` row carries both `gameId` and `groupId` as NULLABLE columns, gated by a DB-level CHECK (`(gameId IS NOT NULL)::int + (groupId IS NOT NULL)::int = 1`). `CommentService.list({gameId, groupId}, viewerId)` and `CommentService.create({gameId, groupId, userId, body})` each call `assertSingleScope({gameId, groupId})` upfront so a programmer error surfaces as a 400 instead of a Postgres CHECK violation. Legacy `CommentService.listForGame(gameId, viewerId)` is kept as a thin shim so any external caller that imported the old signature keeps working.

**Lazy load**: the first open of a thread (collapsed by default) issues a `GET` (newest first, capped at 50). New comments are appended optimistically to the local state.

The `GET` endpoint enriches every comment row with the Tier 8 reaction summary:

- `gameId`, `groupId` — exactly one is non-null per row (the scope it was posted in)
- `editedAt` — nullable; frontend shows `(edited)` next to the timestamp when set
- `reactionCounts: {emoji: N}` — counts across all reactors
- `yourReactions: [emoji...]` — the _caller's_ reactions only, so the UI can highlight toggled buttons

Authorization (scope-independent, commentId-only at the API level):

- **Post (game)**: any authenticated user.
- **Post (group)**: group members + owner only. Owner counts as a member via the `GroupMember` row created on group create. Enforced in `CommentService.create` (403 with `'Only group members can post comments'`).
- **Edit** (Tier 8): author only via `PUT /api/comments/:id`. Sets `editedAt = NOW`.
- **Delete**: author **or** any admin. The frontend hides the edit/delete buttons unless `comment.userId === currentUserId`, but the server is the actual gate. Cascades comment_reactions.

**Anonymous read** (Tier 18 Chunk 5):

- Game scope: `GET /api/games/:gameId/comments` is anon-readable (already the case pre-Chunk 5).
- Group scope: `GET /api/groups/:groupId/comments` is anon-readable for **public** groups. For private groups, non-members get **404** (not 403) to avoid leaking the existence of private groups via response codes (consistent with `GroupService.getVisible` for the group resource itself).

**Group-comment fan-out** (Tier 18 Chunk 5):

`CommentService.fanOutGroupComment({comment, author, group})` runs as fire-and-forget after every successful `CommentService.create({groupId, ...})`. It loads every group member except the author, then `await Promise.all(NotificationService.notify(memberId, 'group-comment', title, body, link))` where:

- `title` = `<author username> commented in <group name>`
- `body` = the comment body (truncated to 160 chars with `…` to keep push payloads small)
- `link` = `/?view=groups&groupId=<id>` (consumed by `DataContext.consumeDeepLinks`)

Wrapped in try/catch so a notification outage can never break the comment create. Per-recipient failures are logged inside `NotificationService.notify` itself.

**Reactions** (Tier 8): a fixed palette of 5 emojis — 👍 ❤️ 😂 😮 🔥 — defined as `ALLOWED_EMOJIS` in [validation/schemas.js](validation/schemas.js) and `REACTION_EMOJIS` in [CommentThread.jsx](src/components/CommentThread.jsx). The two arrays must stay in sync.

- `POST /api/comments/:id/reactions` is idempotent: the unique `(commentId, userId, emoji)` constraint catches duplicate inserts and the handler returns 200.
- `DELETE /api/comments/:id/reactions/:emoji` is a no-op when no such row exists (still returns 200).
- The frontend [CommentThread.jsx](src/components/CommentThread.jsx) optimistically updates `reactionCounts` and `yourReactions` locally, then issues the request; on failure it calls `load()` to resync.
- Reaction routes (`/api/comments/:id/reactions`) operate on `commentId` directly — they don't care about scope, so the same routes service both game and group threads with no changes.

**Cascade behavior on group delete** (Tier 18 Chunk 5): `GroupService.cascadeDelete(group, {transaction})` explicitly destroys `Comment` rows (and their `CommentReaction` children) inside the same transaction that drops the group. The FK on `comments.groupId` declares `ON DELETE CASCADE` so SQL alone would handle it, but we follow the post-Tier-11 user-cascade pattern of explicit destroys to guard against any `sync({alter:false})` bootstrap path where the FK might have landed as `NO ACTION`. Same defensive pattern as `UserService.cascadeDelete`.

### 8.8 Profile Subsystem

`GET /api/users/:username/profile` is one of the heavier endpoints. It composes:

- The target user's basic fields (id, username, role, `displayName`, `bio`, joinedAt).
- All of the target's picks, joined with games to compute `totalPoints, picksMade, picksWon, picksScored, winRate`.
- A 10-row `recentPicks` array sorted by game date descending.
- The user's badge rows.
- The full badge catalog (so the BadgeWall has names + emojis for unearned badges too).
- `friendship` row + `friendStatus` between viewer and target.
- If `friendStatus === 'friends'`, the `headToHead` tally.

This endpoint is **not cached**. On a large dataset it would be a target for Tier 5 caching.

**Profile edit** (Tier 8.5): `PUT /api/me` accepts `{displayName?, bio?}` (both nullable; empty string clears, missing key leaves the field alone). Validation via `editProfileSchema` (trim, length caps 60 / 280). The hook `save({hooks: false})` is essential here — without it Sequelize's `beforeUpdate` would try to re-hash the password.

**displayName precedence**: every surface that shows a username (leaderboard rows, profile header, head-to-head string, search results) prefers `displayName` when set, falling back to `username`. Avatars however **always** hash on `username` so renaming doesn't shuffle colors.

Frontend rendering: two callers.

- **Drawer**: any leaderboard row click (overall, group, sidebar) opens `<ProfileDrawer>` with the target's username. The drawer mounts `<ProfileView>` and shows a friend-action button driven by `friendStatus`. **Not editable**.
- **Tab**: clicking the **Profile** tab opens a full-width `<ProfileView editable onSaveProfile>` for the current user (no drawer wrapper). The edit button reveals an inline form for `displayName` + `bio`. The `ownProfile` state is refetched whenever picks or games change (so newly-scored points appear immediately).

### 8.9 Admin Subsystem

Eight endpoints all gated by `authMiddleware + requireAdmin`. The Admin tab in the UI is conditionally added to the tabs array only when `user.role === 'admin'`.

**Game CRUD**:

- `POST /api/admin/games` — body validated by `createGameSchema` including a `.refine()` that ensures `homeProbability + awayProbability` sums to 1.0 ±0.01.
- `PUT /api/admin/games/:id` — `updateGameSchema` allows all fields optional; if **both** probabilities are sent they must sum to 1.0.
- `DELETE /api/admin/games/:id` — uses `cascadeDeleteGame()` helper to delete picks and comments before destroying the game. Doesn't preserve point totals; affected leaderboards will reflect the deletion on the next computation.
- `POST /api/admin/games/bulk` (Tier 8.9) — body `{ids, action, result?}`. Two actions:
  - `action: 'delete'` — calls `cascadeDeleteGame()` per id.
  - `action: 'setResult'` — sets `game.result` per id and runs the `pick-scored` notification + `evaluateBadges()` loop for every pick on every affected game.

**Result-setting** is **not** under `/api/admin/*` — it's the original `POST /api/games/:gameId/result` from Tier 1 and remains there for backward compatibility. The Admin UI calls it for the per-row "Home won / Away won / Clear" buttons. Bulk uses the bulk endpoint instead.

**User moderation**:

- `GET /api/admin/users` — returns every user enriched with `picksCount` and `groupsCount` (in-memory aggregation over a single Pick + GroupMember fetch).
- `POST /api/admin/users/:id/role` — body `{role}`. **Self-demote guard**: if `params.id === req.user.id && body.role !== 'admin'` → 400 `You cannot demote yourself`. Saves the user with `{hooks: false}` so the password isn't re-hashed.
- `DELETE /api/admin/users/:id` — **self-delete guard** (400 same as above). Calls `cascadeDeleteUser()` which performs cascading cleanup in a specific order (because some FKs are `ON DELETE NO ACTION`):
  1. Find groups owned by the target.
  2. Delete group_members + group_invites for those groups.
  3. Delete those groups.
  4. Delete the target's picks.
  5. Delete the target's comments.
  6. Delete friendships where the target is either party.
  7. Delete the target's group_members rows (in groups they didn't own).
  8. Delete the target's group_invites (by username string match).
  9. Destroy the user row (cascades badges + notifications via DB-level CASCADE).
- `POST /api/admin/users/bulk` (Tier 8.9) — body `{ids, action}`. Three actions: `promote`, `demote`, `delete`. **Self-protection** is automatic: any id matching `req.user.id` is filtered out and returned in `skipped: [{id, reason: 'self'}]` rather than erroring the whole batch. Each surviving id is processed via `User.save({hooks: false})` or `cascadeDeleteUser()` — the **delete** action wraps each iteration in its own transaction (Tier 5.3).

**Transactional cascades (Tier 5.3)**: `DELETE /api/admin/users/:id`, `DELETE /api/admin/games/:id`, and `DELETE /api/groups/:groupId` each wrap their cascade helper in `sequelize.transaction(async (t) => { ... })`. A mid-cascade exception rolls back the whole helper, leaving no orphan rows. Bulk endpoints (`/api/admin/users/bulk`, `/api/admin/games/bulk`) use **one transaction per entity** rather than one tx for the whole batch — a bad row aborts the batch, but everything already committed stays orphan-free.

### 8.10 Search Subsystem (Tier 8.4)

`GET /api/search?q=&type=` is a single endpoint that returns up to 5 matches per type. Implementation in [server.js](server.js):

- Minimum 2 characters; shorter queries short-circuit to empty arrays.
- Uses Postgres `iLike '%term%'` for case-insensitive substring matches across `username`, `displayName`, group `name`, and game `homeTeam` / `awayTeam`.
- Group results respect membership: returns groups where the caller is a member **or** the group is public. Private groups the caller isn't in are hidden.

Frontend [SearchBar.jsx](src/components/SearchBar.jsx) lives in the dashboard header, debounces input by 250 ms, and renders a type-grouped dropdown:

- **User result** → calls `openProfile(username)` which opens `<ProfileDrawer>`.
- **Group result** → if member, switches to the Groups tab; if public non-member, calls the join handler and then switches tabs.
- **Game result** → switches to the Games tab.

Click-outside + Esc close behaviour follows the same pattern as `<NotificationBell>`.

### 8.11 Avatar Subsystem (Tier 8.3)

`<Avatar username displayName size>` is a pure presentational component in [src/components/Avatar.jsx](src/components/Avatar.jsx). It:

- Hashes the **lowercased username** via FNV-1a → a 360° hue.
- Renders an inline `<span>` with `hsl(hue, 55%, 35%)` background, a slightly brighter border, and the username's first letter centered.
- Uses `displayName` for the displayed _letter_ when set; the **color is always derived from `username`** so renames don't shuffle the user's color identity.

The component is mounted in many places: profile header (size 64), leaderboard rows (size 28), group member chips (size 22), comment author headers (size 20). It's stateless and adds nothing to network traffic — no avatar upload story (deliberately out of scope per the roadmap).

### 8.12 Leaderboard Sort + Pagination (Tier 8.8)

`GET /api/leaderboard?groupId=&orderBy=&offset=&limit=` extends the v1 endpoint. The overall block is unchanged (still returns the full sorted-by-points list). The group block changes:

```
response = {
  overall: [...],          // unchanged
  group:  [{userId, username, displayName, points, winRate, rank}],   // current page only
  groupMeta: {
    rows, total, viewerRow, orderBy, offset, limit
  }
}
```

- `orderBy` ∈ `points` (default) / `winRate` / `username`. Implementation in `sortLeaderboard()` (see §5.5 helper table).
- `offset` + `limit` (capped at 50) slice the sorted set.
- `viewerRow` is the caller's full row from the sorted set, included even when offset/limit excludes them — so the UI can always show "your position".

Frontend [GroupLeaderboardCard.jsx](src/components/GroupLeaderboardCard.jsx) renders a sort `<select>`, Prev/Next buttons (no infinite scroll), and a separate `Your position` block when the viewer isn't on the current page.

### 8.13 Bulk Admin Endpoints (Tier 8.9)

Single-item and bulk admin paths share helpers — see §8.9. The bulk endpoints add:

- **Idempotent self-skipping** (only on user bulk actions): the caller's own id is silently filtered before the loop and returned in `skipped`. Game bulk has no self-protection because games are not user-owned.
- **Per-action loop**: there is no transaction wrapping the batch; a partial failure leaves earlier-affected rows committed and later rows untouched. The endpoint returns the affected list so the frontend can resync the table even on partial success.
- **Set-result side effects**: the bulk-game `setResult` path runs the full notification + badge eval loop per game per pick, just like the single-game version. For a large batch on a popular fixture this can produce many notification rows; future Tier 7 work should consider batching/deduplication.

### 8.14 Leaderboard Cache (Tier 5.2)

[lib/leaderboardCache.js](lib/leaderboardCache.js) is a small in-process cache that sits in front of `buildUserSummary()` and `buildGroupLeaderboard()`. Three operations:

```js
const value = await cache.getOrBuild(key, builder); // serve from cache or rebuild + store
cache.invalidate(key | 'all'); // drop one key (or everything)
cache.stats(); // { size, hits, misses, keys: [{key, ageMs, ttlRemainingMs}] }
```

**Shape**: `Map<string, { value, expiresAt }>` with a 30 s TTL (matches the frontend notification poll cadence so cache misses are bounded). The cached value is the **unsorted full array** of rows — sort, slice, and `viewerRow` computation happen per request **on top of** the cached array, so one cache entry serves all `orderBy` / `offset` / `limit` combinations.

**Keys**:

- `'overall'` — the global leaderboard
- `group:<groupId>` — per-group leaderboard

**Invalidation policy** is conservative: most mutations call `cache.invalidate('all')` because picks affect the overall standings and may cross group boundaries. Group-scoped mutations (`/join`, `/leave`, accept-invite, group delete) invalidate only their `group:<id>` key.

| Mutation endpoint                                   | Invalidation |
| --------------------------------------------------- | ------------ |
| `POST /api/picks`, `DELETE /api/picks/:id`          | `'all'`      |
| `POST /api/games/:gameId/result`                    | `'all'`      |
| `DELETE /api/admin/games/:id`                       | `'all'`      |
| `POST /api/admin/games/bulk` (any affected)         | `'all'`      |
| `DELETE /api/admin/users/:id`                       | `'all'`      |
| `POST /api/admin/users/bulk` (delete only)          | `'all'`      |
| `POST /api/groups/:groupId/invite/:inviteId/accept` | `group:<id>` |
| `POST /api/groups/:groupId/join`                    | `group:<id>` |
| `POST /api/groups/:groupId/leave`                   | `group:<id>` |
| `DELETE /api/groups/:groupId`                       | `group:<id>` |

**Promote / demote** (admin role change) don't invalidate — the cached rows hold username + displayName + points, not role.

**Observability**: `GET /api/admin/cache-stats` (admin-only) returns the live `stats()` snapshot. Useful for verifying invalidation during development.

**Limits**:

- **Single-process only**: the cache is process-local. A multi-instance deploy would see stale reads across replicas. Today the app is single-process so this is fine; a future move to Redis would be a small interface swap (the `lib/leaderboardCache.js` module already encapsulates the storage).
- **No background refresh**: invalidation is purely mutation-driven; expired entries are rebuilt lazily on the next read.
- **`viewerRow` is not cached** — it's per-caller, computed downstream of the cached array.

### 8.15 Auth & Account Security (Tier 6)

The full auth surface assembled in Tier 6. Each piece is independently optional but interlocks with the others.

**Session lifecycle**:

```
┌─────────────────┐     correct pw + (if 2FA) code      ┌──────────────────┐
│ unauthenticated │ ─────────────────────────────────▶  │   authenticated  │
│  (no cookies)   │                                      │  (sc_access +    │
│                 │ ◀── 401 → /api/auth/refresh ───────  │   sc_refresh)    │
└─────────────────┘                                      └──────────────────┘
        ▲                                                         │
        │                                                         │
        │            /api/auth/logout                              │
        └──────────────────────────────────────────────────────────┘
```

- The access JWT lives 15 minutes. Once it expires, the next API call returns 401 and the frontend transparently calls `POST /api/auth/refresh` (which only sees `sc_refresh` because of path scoping) to get a new pair, then retries the original request. The user sees nothing.
- The refresh token lives 30 days, rotates on every use, and is **revoked** on `/api/auth/logout` and on `/api/auth/reset-password` (the latter revokes **all** refresh rows for the user — a forced-logout-everywhere primitive that we can re-use later for "sign me out of all devices").
- Login on a new device does NOT revoke other sessions; each device has its own active refresh row. Listing/revoking-by-device is not implemented today but the `userAgent` column on `refresh_tokens` is there to support it.

**Login flow with and without 2FA**:

```
POST /api/login {username, password}
        │
        ▼
  bcrypt.compare(password, user.password)
        │
   ┌────┴────┐
   │ wrong   │── increment loginAttempts; if ≥5, set lockedUntil = NOW+15min ──▶ 401 (generic)
   │ correct │
   └────┬────┘
        │
        ▼
   loginAttempts/lockedUntil cleared
        │
   ┌────┴────────────────┐
   │ user.totpEnabledAt? │
   │  ┌─yes─▶ sign sc_challenge JWT (5min), Path=/api/auth, HttpOnly         │
   │  │                                                                       │
   │  │     return { challenge: true } (NO auth cookies)                      │
   │  │                                                                       │
   │  │     frontend renders <TwoFactorChallenge>                             │
   │  │     POST /api/auth/2fa/verify {code | recoveryCode}                   │
   │  │                                                                       │
   │  │     verify code (speakeasy.totp.verify, window=1) or bcrypt-compare   │
   │  │     each recoveryCode hash; if recovery, splice it out of the array  │
   │  │                                                                       │
   │  │     clearCookie(sc_challenge); setAuthCookies(); return { user }     │
   │  │                                                                       │
   │  └─no──▶ setAuthCookies(); return { user }                              │
   └─────────────────────────────────────────────────────────────────────────┘
```

**Token storage patterns** — used consistently across verify-email, password-reset, and refresh:

- 32 random bytes (hex) generated by `generateRawToken()` — that's the **raw value** sent to the user (in an email link or cookie).
- `crypto.createHash('sha256').update(raw).digest('hex')` is the **stored value** in `tokenHash`. The column has a `UNIQUE` index for O(1) lookup.
- We do **not** bcrypt these tokens: the entropy is already 256 bits (brute-force infeasible), and bcrypt-comparing every candidate row on every verify call would be a needless per-request cost.
- Recovery codes are the exception — they're human-typable 10-character strings, much lower entropy, so they go through `bcrypt.hash(code, 8)` and are looped through on verify. There are only 10 per user, so the loop cost is bounded.

**Email service** ([lib/email.js](lib/email.js)):

- Single export: `send({ to, subject, html, text })`. Resolves to `{delivered: bool, ...}` — **never throws**.
- When `process.env.RESEND_API_KEY` is set, the Resend SDK is loaded lazily and used as the transport. Failures log `email send failed` at error level but don't propagate.
- When unset, `send()` instead emits a structured info-level log (`email (dev log mode — no transport configured)`) carrying the rendered `text` body. Local dev users copy the verify/reset link from server logs to test the flow without setting up an email account.
- `EMAIL_FROM` defaults to `'ScoreCast <onboarding@resend.dev>'` (Resend's sandbox sender, deliverable only to your own signup email). For real-user delivery, point it at a domain you've verified in Resend.
- `PUBLIC_APP_URL` is baked into outbound links (`${PUBLIC_APP_URL}/?verifyToken=…` etc.). Must be the URL users actually load in their browser — Vite dev server (`http://localhost:5173`) in dev, your deployed URL in prod.

**Per-route rate limits + lockout** combine to bound brute force:

- 5/15min IP rate limit on `/api/login` is the first wall.
- After 5 wrong-password attempts against a single user, that user's account is locked for 15 min — a per-username brake that survives switching IPs.
- 3/hour IP rate limit on `/api/auth/forgot-password` is the email-flood brake; the always-204 response shape is the enumeration-defence.
- 30/5min on `/api/client-errors` keeps an infinite-loop client from filling the log.

---

### 8.16 Football Data Integration (Tier 4b)

Pluggable external-football-data integration. Three layers:

**Provider client** ([lib/footballApi.js](lib/footballApi.js))

Wraps [football-data.org v4](https://www.football-data.org/) behind a provider-agnostic surface so a future swap to API-Football Pro / SportMonks / another vendor is a one-file change:

- `getCompetitions()` — list of leagues the API key is entitled to.
- `getFixtures({code})` — full current-season schedule for one competition (no `dateFrom`/`dateTo` filter — daily sync re-upserts everything).
- `getLiveMatches()` — single global `GET /v4/matches?status=LIVE,IN_PLAY,PAUSED` call returns every in-progress match across every entitled competition. Caller filters to the active-league set.
- `getMatchesByIds(ids)` — batch fetch by upstream id (caps at 50 ids per call). Used by the live-score job's reconcile pass to catch the IN_PLAY → FINISHED transition window after a match drops off the LIVE filter.

Rate-limit budget on the TIER_ONE plan (paid since 2026-05-23) is **20 req/min, no daily cap** — verified by probing `x-requests-available-minute` header (`19` available after 1 call). Overridable via `FOOTBALL_DATA_RATE_LIMIT` env (drop to 10 if reverting to free; bump for higher tiers). The client keeps a 60-s sliding window of request timestamps and bails when only 1 slot remains, so admin manual syncs don't starve the cron jobs. Responses are cached via [lib/cache.js](lib/cache.js) — fixture lists 1h, live-match queries 30s. The 1h fixture cache means repeated admin "Sync" clicks within an hour read from cache; cache is per-process and cleared on restart.

The TIER_ONE plan still does NOT expose `minute` / `injuryTime` on `/matches` payloads (verified by inspecting a live Brasileiro match on 2026-05-23 — only `score.{winner,duration,fullTime,halfTime}` come back). The client surfaces what it can — `score.winner` (HOME_TEAM / AWAY_TEAM / DRAW), `score.halfTime` presence, `score.duration` (REGULAR / EXTRA_TIME / PENALTY_SHOOTOUT) — and the frontend estimates the match minute from those plus wall-clock-since-kickoff. The client-side `useMatchMinute()` estimate is here to stay until a higher tier (or a provider swap) exposes the field.

**Status / result mapping** ([lib/fixtureStatus.js](lib/fixtureStatus.js))

Single source of truth for two derivations. **Both** the manual/daily sync path (`LeagueService.upsertFixture`) and the live-score path (`GameService.applyLiveUpdate`) import from here so they can never drift.

- `mapUpstreamStatus(raw)` → local `games.status` enum. Upstream `LIVE`/`IN_PLAY`/`PAUSED`/`EXTRA_TIME`/`PENALTY_SHOOTOUT`/`SUSPENDED` all collapse to `'in-progress'`; `FINISHED`/`AWARDED` to `'finished'`; `POSTPONED` and `CANCELLED` stay distinct.
- `deriveResultFromFixture(fixture, localStatus)` → `'home'` / `'away'` / `'draw'` / `null`. Prefers upstream `winner` (handles penalty-shootout knockouts where fullTime is a draw but a winner exists); falls back to score comparison. Post-draw-scoring tier, upstream `DRAW` (and the score-equality fallback) maps to `'draw'`; the `result` enum is now `('home', 'away', 'draw')`. Returns `null` only when the localStatus isn't `'finished'` or when scores are unknown — never as the "this was a draw" sentinel.

**Jobs** ([lib/scheduler.js](lib/scheduler.js) + [lib/jobs/](lib/jobs/))

`lib/scheduler.js` is a thin node-cron wrapper that:

1. Registers handlers at module load (`scheduler.register(name, cronExpression, handler)`).
2. Acquires a Postgres advisory lock (`pg_try_advisory_lock(crc32(jobName))`) before running each tick. The lock id is deterministic across deploys so a multi-replica deploy (post Tier 10.4) only runs any given tick once.
3. Logs failures and continues — never crashes the host process.
4. No-ops entirely when `NODE_ENV=test` (Playwright doesn't want surprise jobs running).

Three jobs ship today, all skipped silently when `FOOTBALL_DATA_API_KEY` is unset:

- **[syncFixtures.js](lib/jobs/syncFixtures.js)** — daily `0 3 * * *` UTC. Iterates active leagues (`active=true` on `leagues` table), calls `LeagueService.syncFixtures(leagueId)` for each. One league failure does not stop the rest.
- **[syncLiveScores.js](lib/jobs/syncLiveScores.js)** — every 30 s (Tier 18 default `'*/30 * * * * *'`, 6-field; was `'* * * * *'` every minute on the free tier). Two phases:
  1. Single global `getLiveMatches()` call (`?status=LIVE,IN_PLAY,PAUSED`), filtered to active-league `competition.code`s. Each match routed through `GameService.applyLiveUpdate(localGame, apiMatch)`.
  2. **Reconcile pass**: find local games where `status='in-progress'` whose `sourceId` did **not** appear in the LIVE response — these likely transitioned to FINISHED between ticks (and so fell off the LIVE filter). Also catches local `status='scheduled'` rows with kickoff > 15 min ago (SCHEDULED → IN_PLAY missed during downtime). Batch-fetch via `getMatchesByIds(ids)` and apply the final state.
  - **Cost-gate (2026-05-26)** runs BEFORE either phase: a cheap `Game.count` against `{leagueId IN <active>, [(status='in-progress') OR (status='scheduled' AND date IN [now − 4h, now + 2h])]}`. When the count is 0, the whole tick returns `{skipped: true, reason: 'no-relevant-games'}` and no upstream call fires. Window sized so the lookahead picks up SCHEDULED → IN_PLAY the moment upstream flips, and the lookback recovers any kickoff that passed while the app was scaled to zero (longest realistic match ≈ 165 min: 90 + HT + injury + ET + pens). See §8.16 cost note below.
- **[reconcileInProgressGames.js](lib/jobs/reconcileInProgressGames.js)** (added 2026-05-19 — see §8.22 postmortem) — every 3 min (Tier 18 default; was every 5 min on the free tier). Defensive sweep over every local `status='in-progress'` game with a sourceId via `?ids=` regardless of LIVE-filter membership. Closes the gap when upstream's `?status=` filter goes stale while `?ids=` remains fresh (the canonical lookup is the source of truth). Idempotent — games whose canonical state matches the local row produce `changed=false` no-ops. **Has its own cost-gate built in** — the `Game.findAll` on `status='in-progress'` returns an empty array (and the job early-returns) when nothing is live; no upstream call fires.
- **[sendKickoffReminders.js](lib/jobs/sendKickoffReminders.js)** — every 15 min (PWA Chunk 6). DB-only, no API calls. **Also self-gated** — the `Game.findAll` on the 15-30 min kickoff window returns empty most of the time and the job exits at zero cost.

Steady-state API cost at TIER_ONE defaults **during match windows**: `syncLiveScores` ~2 req/min (1 LIVE poll + at most 1 reconcile per 30-s tick) + `reconcileInProgressGames` ~0.33 req/min averaged + daily fixture sync ~12 req in one minute = **~4 req/min vs 20 budget (20% utilization)**, leaving 16+ slots/min for admin syncs.

**Container Apps cost note (2026-05-26)**: Azure Container Apps Consumption bills per vCPU-second of active work, not just per-request. Pre-cost-gate, every 30-s `syncLiveScores` tick made an outbound football-data.org call + parsed the response + ran the reconcile pass regardless of local game presence. During the PL off-season (mid-May → mid-August) and overnight on match days, that was ~2880 wasted upstream calls/day + the CPU to handle them, and the Azure billing chart showed it — daily costs ramped from ~$0.10/day pre-2026-05-21 to ~$0.77/day after the 2026-05-19/20 cron additions, then climbed further after Tier 18 Chunk 2's 30-s tightening on 2026-05-23. With the gate in place, the cron is effectively a single cheap `COUNT` query when nothing's live or imminent, and the daily bar should drop back toward the pre-2026-05-21 baseline outside of actual match windows.

Override defaults via env: `FIXTURE_SYNC_CRON='*/2 * * * *'` for dev rapid iteration; `LIVE_SCORE_SYNC_CRON='* * * * *'` to drop back to 1-min polling (e.g. when reverting to the free tier); `IN_PROGRESS_RECONCILE_CRON='*/1 * * * *'` to crank the defensive sweep to every minute (only useful in incident-response mode); `FOOTBALL_DATA_RATE_LIMIT=10` to match a free-tier downgrade.

**Live update transactional flow** ([services/GameService.js](services/GameService.js) `applyLiveUpdate`)

Per the Tier 5.3 invariant, the write is transactional and the fan-out runs OUTSIDE the transaction so a rollback never produces ghost notifications. After the 2026-05-19 hardening, the transaction also row-locks the game and guards against stale-upstream regression:

```
applyLiveUpdate(localGame, apiMatch):
  BEGIN
    fresh = SELECT * FROM games WHERE id = localGame.id FOR UPDATE
         // serializes concurrent calls from the 1-min and 5-min jobs;
         // sees committed writes from any concurrent transaction,
         // NOT the stale `localGame` the caller passed in.

    if fresh.status == 'finished' && apiMatch.status not in ('FINISHED','AWARDED'):
      log "ignored stale non-FINISHED upstream snapshot for already-finished game"
      return changed=false  ← finished-status flip-back guard

    newStatus       = mapUpstreamStatus(apiMatch.status)
    newResult       = deriveResultFromFixture(apiMatch, newStatus)  // only if fresh.result was null
    changed?        = status / homeScore / awayScore / result / halfTimeReached / phase differ
    if !changed → return early

    UPDATE games SET status, homeScore, awayScore, result, halfTimeReached, phase
                 WHERE id = fresh.id
  COMMIT

  if transitioned to finished (fresh.result null → set):
    for each pick on this game:
      NotificationService.notify(pick.userId, 'pick-scored', ...)
      BadgeService.evaluateBadges(pick.userId)
    LeaderboardService.invalidate('all')
```

Result is only DERIVED if `fresh.result === null` — admin-entered results are never clobbered by upstream updates. The finished-status guard explicitly allows `apiMatch.status === 'FINISHED'` or `'AWARDED'` through so legitimate score corrections + replay re-finalizes propagate.

**Live-minute display** (frontend, [src/utils/time.js](src/utils/time.js))

Computed in `matchMinute(kickoff, {halfTimeReached, phase})`. Persisted signals on the `games` row:

- `halfTimeReached BOOLEAN` — flips to true once upstream populates `score.halfTime`. Monotonic in `applyLiveUpdate` (never reverts).
- `phase VARCHAR(20)` — `regular` / `extra-time` / `penalty-shootout`, mirroring upstream `score.duration`.

Display rules (priority order):

1. `phase === 'penalty-shootout'` → `"PEN"`.
2. `phase === 'extra-time'` → `"ET"`.
3. `halfTimeReached && raw elapsed in [46, 60]` → `"HT"` (catches the halftime window).
4. `!halfTimeReached && raw elapsed > 45` → `"45'"` (don't claim 2nd-half minutes without evidence HT happened).
5. Post-HT (`halfTimeReached && raw elapsed > 60`): displayed minute shifted down by 15 to compensate for the wall-clock HT break.
6. `displayed > 90` → `"90'+"` (regular-time stoppage).
7. Otherwise `"{n}'"`.

`useMatchMinute(kickoff, isLive, {halfTimeReached, phase})` ticks every 30 s while the match is live, no-ops otherwise.

**Schema additions**

| Table              | New columns                                                                                                                                                            | Notes                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leagues` (new)    | `id`, `name`, `sourceProvider`, `sourceLeagueId`, `country`, `logoUrl`, `active`, timestamps                                                                           | Unique on `(sourceProvider, sourceLeagueId)`. Seeded with PL (active) + WC (inactive); admin can add more via UI                                                              |
| `seasons` (new)    | `id`, `leagueId`, `year`, `startsAt`, `endsAt`, `current`, timestamps                                                                                                  | Unique on `(leagueId, year)`. Created on demand by `LeagueService.ensureSeason` during sync                                                                                   |
| `games` (extended) | `leagueId` (FK SET NULL → tightened NOT NULL after backfill), `seasonId`, `sourceId`, `status` ENUM, `homeScore`, `awayScore`, `kickoffTz`, `halfTimeReached`, `phase` | Partial unique index `(leagueId, sourceId) WHERE sourceId IS NOT NULL` so hand-entered games don't collide on NULL. `halfTimeReached` + `phase` feed the live-minute estimate |
| `audit_log` (new)  | `id`, `actorUserId` (SET NULL on user delete), `action`, `entityType`, `entityId`, `before` JSONB, `after` JSONB, `requestId`, `statusCode`, `createdAt`               | Index on `(createdAt DESC)`. Payloads truncated at 4KB by `AuditLogService.record`                                                                                            |

**Audit log** ([middleware/auditLog.js](middleware/auditLog.js) + [services/AuditLogService.js](services/AuditLogService.js))

`auditMutation(action, entityType)` middleware wraps every mutating `/api/admin/*` route. Records via `res.on('finish')` so the captured status code is the real outcome (200, 400, 409, 500…). The middleware never throws back into the request lifecycle — an audit-log outage cannot block a real admin action.

- Action strings follow `admin.<entity>.<verb>` (e.g. `admin.game.delete`, `admin.league.sync`, `admin.user.bulk`).
- `before` is currently always null (middleware doesn't fetch entity pre-state). `after` is the captured request body for non-DELETE methods; for DELETE it's null and the body lands in `before`.
- Payloads >4KB are replaced with `{_truncated: true, _bytes, preview: 'first 512 chars'}`.
- Failed-auth attempts (401/403 thrown before `auditMutation` runs) are NOT audited; this is by design — `authMiddleware` rejects pre-application-layer noise.
- `GET /api/admin/audit-log?limit=&offset=` reads paginated, capped at 200/page. The admin UI ([src/components/admin/AuditLog.jsx](src/components/admin/AuditLog.jsx)) shows newest-first with collapsible payload previews.

**League / season picker** (anon-safe)

Public endpoint `GET /api/leagues` returns active leagues with their `seasons[]` (id, year, current). Used by [src/components/GameFiltersBar.jsx](src/components/GameFiltersBar.jsx) which:

1. Fetches the leagues list once on mount.
2. Reads URL state (`?league=PL&season=2026`) — uses the `sourceLeagueId` code, not internal UUID, so links are shareable + stable across DB rebuilds.
3. Resolves code → UUID against the leagues list and calls `applyGameFilters({leagueId, seasonId})` on `DataContext`.
4. Pushes URL state on change via `history.replaceState` — no router, no navigation.

`GET /api/games` accepts `leagueId` + `seasonId` query params (UUID-shape guard silently drops malformed values). `GameService.listGames({leagueId, seasonId})` applies them as a Sequelize where-clause. `DataContext.gameFilters` holds the active filter so `refreshGames` (called after picks, admin mutations) preserves it.

### 8.17 ML Probability Pipeline (Tier 17 — in-process JS inference + reactive cascade)

#### Why it exists — the value to Bantryx

Bantryx's scoring formula is `round((1 − p_winning) × 100)`. Picking the team that wins pays `(1 - probability of that team winning) × 100`. **Without per-game probabilities, every pick pays a flat 50 pts** because `LeagueService.upsertFixture` writes the sentinel `(homeProbability=0.50, drawProbability=0.00, awayProbability=0.50)` to every fixture as it lands from football-data.org. A user picking heavy favorites and a user picking heavy underdogs both clear the same payout. The game has no edge to find.

The ML pipeline fills in real probabilities, which:

1. **Activates the upset bonus** — a 25%/75% underdog pick is worth 75 pts when it lands, while the corresponding favorite pick is worth 25. Skill at picking value emerges in the leaderboard standings.
2. **Activates draw scoring** — a pick where `pick.choice ∈ {'home', 'away'}` but the match ends as `result='draw'` now pays partial credit weighted by `drawProbability × opposite_team_prob / (homeProbability + awayProbability)`. Without `drawProbability > 0`, draws are a flat zero (the pre-tier behavior).
3. **Drives the `PayoutMatrix` preview UI** — each upcoming `GameCard` renders a 2×3 matrix showing what each pick would pay under each outcome (Home Win / Draw / Away Win). The preview is only meaningful when probabilities aren't all sentinel.

**Tier 17 architectural inversion** (shipped 2026-05-23): the daily Container Apps Job that scored every upcoming fixture and POSTed back through the admin API is **gone**. Inference now runs **in-process in Node** via `services/PredictionService.js` + `lib/ml/` and fires **reactively on every captured result** — Elo gets atomically updated, every upcoming fixture involving either team gets re-predicted, all within the same request lifecycle as the result-set. The Python side is reduced to a **training-only offline tool** that produces the XGBoost native JSON dump committed to `lib/ml/models/PL_elo.json`. No more cron, no more API roundtrip, no more service-account user, no more ACR repo, no more Bicep module.

The new shape:

- **Training (Python, offline)** — fit XGBoost on the committed PL CSV corpus, emit `booster.save_model(json_path)`. Lives in [ml/](ml/) (~300 LOC after Tier 17's aggressive trim). Run via `python -m scorecast_ml train --league PL` whenever a retrain is needed; commit the resulting JSON to `lib/ml/models/<code>_elo.json`.
- **Runtime inference (Node, in-process)** — [lib/ml/xgboostInference.js](lib/ml/xgboostInference.js) tree-walks the native JSON dump (zero deps); [lib/ml/eloMath.js](lib/ml/eloMath.js) holds the pure Elo update math; [lib/ml/normalize.js](lib/ml/normalize.js) rounds + clips + nudges the output trio. ~250 LOC total + 39 unit tests.
- **Reactive cascade (Node, in-process)** — [services/PredictionService.js](services/PredictionService.js) wires the inference into `GameService.setResult` / `bulkSetResult` / `applyLiveUpdate`. Every captured result atomically updates both teams' Elo (inside the result transaction) and asynchronously rewrites probabilities for every upcoming fixture involving either team (after commit).
- **Elo state in Postgres** — new `teams` table holds per-(team, league) Elo. Bootstrapped by a one-shot seeder that replays the committed PL CSV history; maintained by the runtime cascade.

**No new admin endpoints**. The pipeline used to authenticate as `ml_pipeline` and round-trip through `PUT /api/admin/games/:id` so every write was audit-logged. Tier 17 collapses that into in-process Sequelize writes inside the same transaction as the result commit — atomic + much faster (no HTTP, no cookie auth, no rate limiter). The trade-off: cascade writes aren't in `audit_log` (only admin-initiated mutations are). Result-set captures themselves ARE still audit-logged via the existing `auditMutation('admin.game.result', 'game')` on the PATCH route.

#### Architecture overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ OFFLINE (Python, run when retraining)                                         │
│                                                                               │
│  ml/data/raw/PL_*.csv         (32 seasons committed to git, ~3 MB)             │
│         │                                                                     │
│         ▼                                                                     │
│  ml/scorecast_ml/cli.py train                                                 │
│    1. parse CSVs (ingest/football_data_uk.py)                                 │
│    2. strict reconcile against reconcile/teams.json                           │
│    3. Elo walk (elo/engine.py) → home_elo_pre, away_elo_pre                  │
│    4. 2-feature matrix [home_elo, away_elo] + H/D/A labels                   │
│    5. XGBoost multi:softprob, early stopping on val (seed=42)                │
│    6. booster.save_model('ml/data/models/PL_elo_<date>.json')                │
│                                                                               │
│  Operator: cp ml/data/models/PL_elo_<date>.json                              │
│              lib/ml/models/PL_elo.json                                       │
│           git commit + push                                                  │
└──────────────────────────────────────────────────────────────────────────────┘
         │
         │ JSON committed to git → baked into the next Node image
         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ RUNTIME (Node, in-process — every captured result)                            │
│                                                                               │
│  Admin sets result OR live-score job sees FINISHED                            │
│         │                                                                     │
│         ▼                                                                     │
│  GameService.setResult / bulkSetResult / applyLiveUpdate                      │
│    └──── sequelize.transaction(t) ────────────────────────────┐               │
│           game.result = next                                   │               │
│           game.status = 'finished'                             │               │
│           await game.save({transaction: t})                    │               │
│           PredictionService.onResultUpdated(game, {t})         │               │
│             ├─ idempotent? (result === appliedResult) → no-op  │               │
│             ├─ Team.findOne(...).LOCK.UPDATE × 2 (home + away) │               │
│             ├─ reverse prior delta against game.homeEloPre/    │               │
│             │     awayEloPre snapshot if appliedResult was set │               │
│             ├─ apply new delta vs the SAME (locked) snapshot   │               │
│             ├─ team.elo += delta; round to DECIMAL(8,2)        │               │
│             ├─ game.{homeEloPre, awayEloPre, appliedResult}=…  │               │
│             └─ await game.save({transaction: t})               │               │
│    └──── COMMIT ──────────────────────────────────────────────┘               │
│                                                                               │
│  POST-COMMIT side effects (Tier 5.3 invariants):                              │
│    NotificationService.notify(pick.userId, 'pick-scored', ...)               │
│    BadgeService.evaluateBadges(pick.userId)                                  │
│    LeaderboardService.invalidate('all')                                      │
│    PredictionService.rePredictFutureFixtures({affectedTeams, leagueId})      │
│         ├─ loadModel('lib/ml/models/PL_elo.json') (cached after 1st load)    │
│         ├─ Game.findAll({status:'scheduled', homeTeam OR awayTeam in [...]}) │
│         ├─ Team.findAll({name in [...]}) → eloByName map                     │
│         ├─ for each fixture:                                                  │
│         │     probs = xgboost.predict(model, [homeElo, awayElo])             │
│         │     triple = normalize.toThreeWay(probs[0..2])                     │
│         │     await game.update({home/draw/awayProbability: ...})            │
│         └─ logger.info({rewritten, skipped}, 'cascade complete')             │
└──────────────────────────────────────────────────────────────────────────────┘
```

**File layout (Tier 17 trim)**:

Surviving Python (training-only):

| Path                                         | Responsibility                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ml/scorecast_ml/cli.py`                     | Single `train` subcommand. Inlined strict reconciliation + 2-feature build + season split.                                                                                  |
| `ml/scorecast_ml/train/model.py`             | XGBoost wrapper. `train()` returns booster; `save_as_json()` emits native JSON dump.                                                                                        |
| `ml/scorecast_ml/elo/engine.py`              | Source of truth for Elo math. `lib/ml/eloMath.js` parity-tests against this.                                                                                                |
| `ml/scorecast_ml/ingest/football_data_uk.py` | FDCO CSV parser. Tolerates ragged trailing columns (XPath: ~12k rows / 32 seasons).                                                                                         |
| `ml/scorecast_ml/reconcile/teams.json`       | Per-league alias map (FDCO short names → football-data.org canonical). Same data is mirrored into [seeders/reconcileMap.json](seeders/reconcileMap.json) for the JS seeder. |
| `ml/data/raw/PL_*.csv`                       | 32 seasons of FDCO history; committed via `.gitignore` negation `!ml/data/raw/*.csv`.                                                                                       |
| `ml/data/models/`                            | Train-output JSON (gitignored — the _production_ model lives at `lib/ml/models/`).                                                                                          |

Runtime JS (always loaded by the Node app):

| Path                            | Responsibility                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/ml/eloMath.js`             | Pure Elo math: `expectedHomeScore`, `actualScores`, `updateElos`, `eloDelta`. K=20, INITIAL=1500, HFA=0. JS port of `ml/scorecast_ml/elo/engine.py`.                                                         |
| `lib/ml/xgboostInference.js`    | Native XGBoost JSON tree walker + softmax. Zero deps. ~150 LOC. Handles `multi:softprob` via `tree_info` per-class accumulation. `parseBaseScore()` defaults to 0 when XGBoost emits the hex-encoded format. |
| `lib/ml/normalize.js`           | `toThreeWay(p_h, p_d, p_a)` → DECIMAL(3,2) triple summing to 1.0. Clip → round → rebalance against largest-RAW class → nudge off the `(0.50, 0.00, 0.50)` sentinel.                                          |
| `lib/ml/models/PL_elo.json`     | The production model (615 trees, ~1.5 MB). Committed by operator after each retrain. JS loader looks up by exact name.                                                                                       |
| `services/PredictionService.js` | The reactive cascade. `onResultUpdated` (idempotent + reversible) + `rePredictFutureFixtures`. Per-league model cache.                                                                                       |

Tests:

| Path                             | Coverage                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/eloMath.test.js`          | 16 unit tests — symmetry, sum-to-1, zero-sum, monotonicity, draw split, delta+update parity.                                                             |
| `tests/normalize.test.js`        | 10 unit tests — sum-to-1, clip floor, sentinel nudge, residual on largest raw.                                                                           |
| `tests/xgboostInference.test.js` | 13 unit tests — tree walk, NaN default-left, malformed-tree throw, softmax stability, hex-encoded base_score, NaN guard, end-to-end on hand-built model. |
| `ml/tests/test_elo_engine.py`    | Python Elo determinism + min_rating strategy. Mirror of the JS suite — drift means JS↔Python parity broke.                                               |

#### Pipeline stages — detailed

**1. Training — Python, offline** ([ml/scorecast_ml/cli.py](ml/scorecast_ml/cli.py) → [train/model.py](ml/scorecast_ml/train/model.py))

Single subcommand: `python -m scorecast_ml train --league PL`. Replaces the 6-subcommand pre-Tier-17 CLI; everything else (ingest / reconcile / elo / predict / predict-and-write) was deleted. The trainer inlines what it used to call out to:

1. **Read CSVs** — `fs.readdirSync('ml/data/raw/')` filtered to `PL_\d{4}\.csv`, sorted by season-start-year (alphabetical sort breaks because PL_0001 sorts before PL_9394 due to the two-digit-year wrap). Parsed via the surviving `ingest/football_data_uk.py` which tolerates ragged trailing columns (mid-season odds providers added across history; pandas C engine drops those rows).
2. **Strict reconciliation** — strict lookup against [reconcile/teams.json](ml/scorecast_ml/reconcile/teams.json). `KeyError` on any unmapped CSV name with the full list of missing entries. The pre-Tier-17 fuzzy fallback (rapidfuzz, three score tiers) was removed — historical corpus is static and known-clean; new clubs require a manual `teams.json` extension before retraining.
3. **Elo walk** — [elo/engine.py](ml/scorecast_ml/elo/engine.py) `batch_compute(matches, EloConfig())`. K=20, INITIAL=1500, HFA=0. Promoted-team strategy: `min_rating` past the first season. Produces `home_elo_pre` / `away_elo_pre` columns (the PRE-match snapshot, no leakage).
4. **2-feature matrix** — `X = augmented[['home_elo_pre','away_elo_pre']].rename(...)` to match `FEATURE_NAMES = ['home_elo','away_elo']`. Labels via `{H:0, D:1, A:2}` to match XGBoost's `multi:softprob` column order. The pre-Tier-17 11-feature build (form / ppg / days-rest) was dropped because the runtime cascade in Node has no source for rolling form — production features have to match what the cascade can supply.
5. **Time-based split** — train through `--train-through-season` (default 2223); val on `--val-season` (default 2324, used for early-stopping). No held-out test set in the training run; honest OOS evaluation now happens organically via the picks that come in and resolve.
6. **XGBoost fit** — `multi:softprob`, max_depth=4, learning_rate=0.05, num_boost_round=400, early_stopping=30 patience on val mlogloss, `seed=42` (determinism). The Phase-2 isotonic calibration step was dropped — runtime clipping in `lib/ml/normalize.js` handles the edge cases the calibrators used to.
7. **Native JSON export** — `booster.save_model('ml/data/models/PL_elo_<date>.json')`. This is the file the operator commits (without the date suffix) to `lib/ml/models/PL_elo.json`. Replaces the `.joblib` bundle entirely — `ModelBundle` + `load_latest_bundle` + `fit_calibrators` + the joblib dependency are all gone.

The trainer is the only entry point: `python -m scorecast_ml --help` shows just `train`. `requirements.txt` was slimmed to `pandas`, `numpy`, `xgboost`, `scikit-learn`, `typer`, `pydantic-settings`, `structlog`, `python-dateutil` + dev tools (pytest, ruff). `httpx`, `tenacity`, `psycopg`, `rapidfuzz`, `joblib`, `pyarrow` are all gone (no more API writes, no more DB reads, no more fuzzy matching, no more joblib bundles, no more parquet snapshots).

**2. Model artifact — `lib/ml/models/PL_elo.json`**

XGBoost 2.x native JSON dump. ~1.5 MB for the production PL model (615 trees × ~16 nodes each, plus a small `learner_model_param` block). The format ([xgboost docs](https://xgboost.readthedocs.io/)) has these per-tree arrays:

```
{
  learner: {
    learner_model_param: { num_class: "3", base_score: "<hex-float>", ... },
    gradient_booster: {
      model: {
        trees: [
          {
            tree_param: { num_nodes: "N" },
            left_children:    [int...],   // -1 means leaf
            right_children:   [int...],
            split_indices:    [int...],   // feature index for split nodes
            split_conditions: [float...], // threshold (or leaf weight if leaf)
            default_left:     [0|1...],   // direction for NaN inputs
            base_weights:     [float...]  // leaf output
          }, ...
        ],
        tree_info: [int...]               // class index per tree
      }
    }
  }
}
```

**Gotcha — hex-encoded `base_score`** (caught live in prod): XGBoost 2.x emits `learner_model_param.base_score` as a C99 hex-float string (e.g. `"5E-1F"` for 0.5). JS `Number("5E-1F")` returns NaN, which would poison every logit and produce `[NaN, NaN, NaN]` out of softmax. `parseBaseScore()` in [lib/ml/xgboostInference.js](lib/ml/xgboostInference.js) falls back to 0 when the parse fails — correct for `multi:softprob` because base_score broadcasts identically to every class and cancels under softmax (shift-invariant). For `binary:logistic` this matters; the code has a TODO to handle that case when we ever train a binary model.

**3. JS inference — [lib/ml/xgboostInference.js](lib/ml/xgboostInference.js)**

Pure tree walker. Zero dependencies. ~150 LOC.

```js
function walkTree(tree, features) {
  let i = 0;
  for (let steps = 0; steps < tree.left_children.length; steps += 1) {
    if (tree.left_children[i] === -1) return tree.base_weights[i];
    const f = features[tree.split_indices[i]];
    const goLeft = Number.isNaN(f) ? tree.default_left[i] === 1 : f < tree.split_conditions[i];
    i = goLeft ? tree.left_children[i] : tree.right_children[i];
  }
  throw new Error('walkTree: did not reach a leaf within num_nodes steps');
}
```

`predict(model, features)` accumulates per-class logits across that class's trees (`tree_info[t]` says which class tree t belongs to), adds `base_score` uniformly (no-op for softmax), runs a numerically-stable softmax (subtract max(logits) before exp() to avoid overflow), and **throws if any output is non-finite** — defensive guard that surfaces propagation bugs at the predict boundary instead of letting them silently reach `normalize.toThreeWay`.

`loadModel(path, { numFeatures })` is the **graceful-missing-model boundary**: if the JSON file is absent, logs a warn and returns `null`. `PredictionService.rePredictFutureFixtures` null-checks the cached model and silently no-ops (`{ rewritten: 0, skipped: 'no model' }`) so a missing file never crashes a result-capture transaction. This was the load-bearing contract that let PR B + PR C ship before the trained PL_elo.json existed.

**Performance** — depth-4 trees × 615 trees per prediction ≈ 9,800 comparisons per fixture. JS Math.exp + Array.fill add another ~3 µs. End-to-end per-fixture prediction is ~50 µs. A typical PL cascade rewrites ~5-15 fixtures per result → cascade overhead is ~0.5 ms. Effectively free.

**4. JS Elo math — [lib/ml/eloMath.js](lib/ml/eloMath.js)**

Pure functions, no dependencies:

```js
expectedHomeScore(homeElo, awayElo) = 1 / (1 + 10^((awayElo - (homeElo + HFA)) / 400))
updateElos(homeElo, awayElo, result) → { newHomeElo, newAwayElo }
eloDelta(homeElo, awayElo, result) → { home: delta, away: delta }
```

The `eloDelta` function is what makes PR F's reversibility work — `PredictionService.onResultUpdated` computes the delta against a stored snapshot, subtracts it to reverse a prior application, then adds a new delta against the same snapshot. Zero-sum invariant (home delta = −away delta) is locked in by `tests/eloMath.test.js`.

**Parity with Python** — [ml/scorecast_ml/elo/engine.py](ml/scorecast_ml/elo/engine.py) is the source of truth. `lib/ml/eloMath.js` is a literal port. Drift would silently desync the seeder's bootstrap (Python-derived) from the runtime cascade (JS-derived). Both sides have determinism + invariant tests covering the same cases (`ml/tests/test_elo_engine.py` + `tests/eloMath.test.js`).

**5. JS normalize — [lib/ml/normalize.js](lib/ml/normalize.js)**

End-to-end pipeline that takes the raw 3-tuple from `predict()` and produces the DECIMAL(3,2) triple that lands in the DB:

1. **Validate range** — every prob in [0, 1] ± 1e-9, throws otherwise.
2. **Renormalize if drifted** — tolerate ±5% sum-drift; throw on wilder.
3. **Clip each class to [0.01, 0.99]** — DECIMAL(3,2) precision means anything below 0.005 rounds to 0.00. Without the clip, an isotonic-style lopsided model output (raw 0.001) would emit literal "0% chance" probability writes. The clip is load-bearing, not defensive — the bug it prevents was the original motivation for Phase 2 calibrators on the Python side.
4. **Round each class to 2 decimals**.
5. **Absorb rounding residual into the class with the largest RAW probability** (not the largest rounded value). Three close classes often tie after rounding; using the raw input as the tiebreak preserves model ordering through ties.
6. **Nudge off the `(0.50, 0.00, 0.50)` sentinel** — that's the "untouched by anyone" tuple a fresh game has post-draw-scoring migration. Emitting it would collide with the auto-insert sentinel check; we shift to `(0.51, 0.00, 0.49)` or `(0.49, 0.00, 0.51)` based on raw direction.

Mirrors [ml/scorecast_ml/inference/normalize.py](ml/scorecast_ml/inference/normalize.py) from before that file was deleted in Tier 17 PR D.

**6. PredictionService — the reactive cascade** ([services/PredictionService.js](services/PredictionService.js))

The bridge between a captured result and the probability rewrites for every upcoming fixture involving either team. Two functions, two distinct transactional contexts:

```js
// Inside the result-capture transaction. Atomic with game.save().
onResultUpdated(game, { transaction }) → { affectedTeams, leagueId } | null

// AFTER the transaction commits. Best-effort, can't undo the result.
rePredictFutureFixtures({ affectedTeams, leagueId }) → { rewritten, skipped, ... }
```

**`onResultUpdated` behavior matrix** (PR F): `game.appliedResult` is the value previously Elo-applied to the team rows; `game.result` is the new value the caller just set:

| previous → next                 | What runs                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `X === X` (idempotent)          | Short-circuit. No Elo shift, returns `null`, cascade skipped.                                                                              |
| `null → 'home'                  | 'away'                                                                                                                                     | 'draw'` | First capture. Snapshot live team Elo onto `game.homeEloPre` + `awayEloPre`. Apply delta. Stamp `appliedResult`. `gamesPlayed += 1`. |
| `X → Y` (change, both non-null) | Reverse prior delta against locked snapshot. Apply new delta against SAME snapshot. Update `appliedResult`. Net `gamesPlayed` change is 0. |
| `X → null` (clear)              | Reverse prior delta against snapshot. Drop snapshot + `appliedResult`. `gamesPlayed -= 1`.                                                 |

Both team rows are locked with `SELECT ... FOR UPDATE` so concurrent captures involving the same team serialize cleanly. The snapshot fields are **immutable** for the life of the game once first stored — they represent pre-match strength, not post-revision strength, so reverse + reapply always uses the same reference Elo pair regardless of what other games have shifted the team's live Elo in between.

**`rePredictFutureFixtures`** runs after commit (in `.catch()` so failures can't undo the result):

1. Resolve `leagueCode` from `leagueId` (one extra query; avoids a dep-cycle with LeagueService).
2. Look up cached model via `getModelForSourceLeagueCode(code)`. `MODEL_PATHS` maps `PL` → `lib/ml/models/PL_elo.json`. Per-league cache populated lazily.
3. `Game.findAll({ leagueId, status: 'scheduled', [Op.or]: [{ homeTeam IN affectedTeams }, { awayTeam IN affectedTeams }] })` — every upcoming fixture involving either side.
4. Bulk-fetch the teams referenced (the affected teams + their opponents) in one query. Build `eloByName: Map<name, parseFloat(elo)>`.
5. For each fixture: `predict()` + `toThreeWay()` + `game.update({ homeProbability, drawProbability, awayProbability })`. Skip with logged warn on missing-team / predict-throw / normalize-throw — never blocks the rest of the batch.
6. Log `rePredictFutureFixtures: cascade complete` with rewritten + skipped counts.

**7. Teams table + Elo state** ([models/Team.js](models/Team.js))

New table introduced in Tier 17 PR A:

| Column                    | Type                                 | Notes                                                                                                                             |
| ------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | UUID PK                              | `gen_random_uuid()` default                                                                                                       |
| `name`                    | VARCHAR(128) NOT NULL                | Canonical name as football-data.org sends it ("Manchester City FC", not "Man City")                                               |
| `leagueId`                | UUID NOT NULL FK leagues(id) CASCADE | Per-league Elo space. Same canonical name can appear in multiple leagues.                                                         |
| `elo`                     | NUMERIC(8,2) NOT NULL DEFAULT 1500   | DECIMAL — Sequelize returns as STRING, services parseFloat before math. NUMERIC vs FLOAT avoids drift over years of K=20 updates. |
| `gamesPlayed`             | INTEGER NOT NULL DEFAULT 0           | Increments on first result capture per game; decrements on clear (PR F).                                                          |
| `lastMatchDate`           | DATE                                 | Date of the most recent match the team's Elo was updated for.                                                                     |
| `createdAt` / `updatedAt` | TIMESTAMPTZ                          | Standard Sequelize.                                                                                                               |

Indexes: unique `(name, leagueId)` + non-unique on `leagueId`.

**Two write paths populate this table**:

- **Initial seed** — [seeders/20260522000001-seed-teams-from-elo-history.js](seeders/20260522000001-seed-teams-from-elo-history.js) walks the 32-season committed PL CSV history chronologically (custom sort to handle the two-digit-year wrap), applies the same K=20 / INITIAL=1500 / HFA=0 / min_rating algorithm the Python trainer uses, and inserts every team with its post-walk Elo + gamesPlayed + lastMatchDate. `ON CONFLICT (name, leagueId) DO NOTHING` — re-runs are no-ops for existing rows, so live Elo accumulated by the cascade is preserved. The seeder is NOT auto-run by CD's `db:migrate`; an operator runs it once after the first prod deploy.
- **Runtime auto-insert** — [services/LeagueService.js](services/LeagueService.js) `ensureTeamExists` inserts a missing team at the league's current `MIN(elo)` (falling back to INITIAL_RATING=1500 when the league has zero teams). Fires on every `upsertFixture` call — both create and update paths — so newly-promoted clubs land in the table before their first match's cascade fires. Mirrors the Python pipeline's promoted-team `min_rating` strategy at the fixture-sync boundary.

#### Per-game snapshot — PR F reversibility contract

Three columns added to `games` in [migration 20260523000001-games-add-elo-snapshot.js](migrations/20260523000001-games-add-elo-snapshot.js):

| Column          | Type              | Purpose                                                                   |
| --------------- | ----------------- | ------------------------------------------------------------------------- |
| `homeEloPre`    | NUMERIC(8,2) NULL | Home team's Elo at first result capture. Immutable after first store.     |
| `awayEloPre`    | NUMERIC(8,2) NULL | Away team's Elo at first result capture. Immutable after first store.     |
| `appliedResult` | VARCHAR(10) NULL  | The result value that's been Elo-applied. Mirrors the `game.result` enum. |

The locked-snapshot pattern is the key to PR F's reversibility. When a result is changed, the cascade reverses the prior delta against the snapshot (NOT against live Elo, which may have shifted from other games' captures in between) and applies the new delta against the SAME snapshot. The arithmetic guarantee is that A → B → A round-trips to bit-identical Elo, regardless of intervening team activity.

If the snapshot were re-taken on every change instead of being locked, we'd accumulate drift: each toggle would compound the current Elo with another delta. This was exactly the Tier 17 PR C bug that PR F fixed.

#### Operator workflows

**Retraining**:

```bash
cd ml
python -m venv .venv && .venv\Scripts\Activate.ps1   # or .venv/bin/activate
pip install -r requirements.txt
python -m scorecast_ml train --league PL
# Produces ml/data/models/PL_elo_<date>.json
cp data/models/PL_elo_<date>.json ../lib/ml/models/PL_elo.json
git add ../lib/ml/models/PL_elo.json
git commit -m "ml: retrain PL elo-only model (val mlogloss X.XXX)"
git push
# CD deploys ~3-4 min; per-league model cache populates on next cascade fire
```

**Backfill upcoming fixtures with the new model** (one-off, post-retrain):

```bash
node scripts/backfill-probabilities.mjs --dry-run    # eyeball the writes first
node scripts/backfill-probabilities.mjs              # for real
```

Functionally identical to `PredictionService.rePredictFutureFixtures` but CLI-driven. Useful after retrain or any time probabilities need a forced refresh.

**Cleanup a corrupted game's Elo state** (rare — used during PR F migration):

```bash
node scripts/find-game.mjs "Home FC" "Away FC"                # find the gameId
node scripts/repair-test-game-elo.mjs <gameId> "Home FC" "Away FC"
npx sequelize-cli db:seed --seed 20260522000001-seed-teams-from-elo-history.js
```

`repair-test-game-elo.mjs` clears the game's result + snapshot + appliedResult AND deletes the two team rows; the seeder re-inserts at canonical historical Elo on next run (`ON CONFLICT` preserves other teams).

**Add a new league** (e.g. La Liga):

1. Commit the new league's CSVs to `ml/data/raw/PD_*.csv`.
2. Add a `PD` block to [ml/scorecast_ml/reconcile/teams.json](ml/scorecast_ml/reconcile/teams.json) with the full alias map.
3. Mirror that alias map to [seeders/reconcileMap.json](seeders/reconcileMap.json).
4. Add the league code to `MODEL_PATHS` in [services/PredictionService.js](services/PredictionService.js).
5. Extend the seeder to iterate `PD_*.csv` alongside `PL_*.csv` (currently hardcoded to PL).
6. `cd ml && python -m scorecast_ml train --league PD` and commit the resulting JSON to `lib/ml/models/PD_elo.json`.

#### Critical invariants (don't break these)

1. **Python ↔ JS Elo math parity**: K=20, INITIAL=1500, HFA=0. `lib/ml/eloMath.js` is the JS port of `ml/scorecast_ml/elo/engine.py`; drift between them silently desyncs the seeder's bootstrap from the runtime cascade. Both have determinism + invariant tests covering the same cases.
2. **Atomicity of Elo update with result**: `onResultUpdated` runs INSIDE the result-capture transaction. If the result rolls back, Elo rolls back with it. The `SELECT ... FOR UPDATE` on team rows serializes concurrent captures.
3. **`rePredictFutureFixtures` runs AFTER commit**: read-only-on-teams cascade. Safe to retry; failures don't roll back the result. Mirror of Tier 5.3 notify/badge pattern.
4. **Per-game snapshot is immutable after first store**: `game.homeEloPre` + `awayEloPre` represent pre-match strength. Reverse + reapply uses them as the reference Elo pair — never refresh from live Elo, or the reverse would be against wrong-Elo and the round-trip wouldn't bit-match.
5. **Probability normalize ordering**: `toThreeWay` absorbs rounding residual into the largest-RAW class (not the largest rounded). `(0.501, 0.249, 0.250)` rounds to `(0.50, 0.25, 0.25)` preserving home as the top class, not flipping to `(0.51, 0.24, 0.25)`.
6. **Default-left for NaN features**: tree walker honors `default_left[i]` when input feature is NaN. Never relevant for our 2-feature model in practice but mandatory for XGBoost JSON parity.
7. **Clip to [0.01, 0.99] BEFORE rounding**: caught real Arsenal-vs-Burnley 1.00 / 0.00 / 0.00 outputs in the wild on the Python pipeline. `normalize.js` preserves the same clip on the JS side. Test: `tests/normalize.test.js` `toThreeWay clips literal-zero outputs`.
8. **Numeric precision**: `teams.elo` is NUMERIC(8,2). Sequelize returns DECIMAL as STRING; always parseFloat before math. Same for `games.homeEloPre` / `awayEloPre`.
9. **`parseBaseScore` defaults to 0**: XGBoost 2.x's hex-encoded base_score can't be parsed by JS `Number()`. For `multi:softprob` (our case) base_score broadcasts equally → safe to default to 0. Tests lock this in.
10. **Seeder idempotency**: `ON CONFLICT (name, leagueId) DO NOTHING`. Re-running the seeder MUST NOT reset live Elo back to historical-snapshot values.
11. **Auto-insert at `MIN(elo)`**: newly-promoted clubs enter at the league's current minimum (or INITIAL_RATING when empty). Mirrors the Python trainer's `promoted_team_strategy='min_rating'`. Without this, a brand-new club would enter at 1500 and immediately tank the leaderboard via favorable early matches.

#### Known limits + forward path

- **Single league at launch** — PL only. Architecture supports multi-league via `(name, leagueId)` unique index + per-league `MODEL_PATHS`. La Liga / Bundesliga / Serie A / Ligue 1 each need their own training run + reconcile-map extension + seeder extension. The pipeline is league-agnostic; per-league work is mostly data, not code.
- **No isotonic calibration** — dropped per the design call to keep the runtime path zero-dep. Calibrators would re-introduce sklearn or require porting `IsotonicRegression.predict` to JS (binary search through piecewise constants). Probabilities may be slightly miscalibrated at extremes (>70%); accept as tradeoff. ~30-LOC JS addition if it ever matters.
- **No monotonicity constraints** — XGBoost trees over a 2-feature space can have small non-monotonic kinks across narrow Elo ranges (`monotone_constraints={'home_elo':1, 'away_elo':-1}` would eliminate). Observed in the user verification: a 20-pt Elo drop for Newcastle slightly INCREASED their away-win probability by 3pp against Fulham. Noise-level; not blocking. If pursued, the Python trainer is a one-line config addition.
- **No xG / form features** — Tier 17's elo-only feature set was deliberate (the runtime cascade has no source for rolling form). If we add an xG provider later, the runtime cascade would need to maintain xG state per team in the `teams` table too.
- **Cascade write count** — typical PL result rewrites 5-15 upcoming fixtures (count is bounded by remaining-fixtures-this-season for both teams). End-of-season the cascade naturally trails off. Cost is negligible (sub-ms total cascade time).
- **Multi-replica scaling** — the per-league model cache is per-process. Multi-replica deploys (post-Tier-10.4) would load the model independently in each replica; no shared state needed. The cascade's `SELECT ... FOR UPDATE` on team rows + the same-game transaction means concurrent result-captures across replicas serialize cleanly via Postgres locks.
- **Retraining cadence** — once per season is typical (after a new season's worth of CSV data is available). Mid-season retraining happens only if model drift becomes visible in the OOS payout structure. The seeder + cascade run continuously regardless of model version.

### 8.18 Profile Privacy (Tier 8.6)

Each user carries a `users.profileVisibility` enum:

- **`'public'`** (default): existing behavior — anyone can fetch the profile, leaderboard rows render the username.
- **`'friends'`**: only accepted friends + self + admins can fetch the profile; everyone else gets a 404 from `/api/users/:username/profile`. On leaderboards, the row is **masked**.
- **`'private'`**: only self + admins can fetch; everyone else (including friends) gets a 404. Masked on leaderboards.

**Identical 404 for friends-gated and private** is the design — distinguishing the two would let an attacker probe the friend graph by watching which 404 responses turn into 200s after a friend-request flow.

**Gate location**: [services/UserService.js](services/UserService.js) `getProfileByUsername({username, viewer})`. The route handler just unpacks `req.user` (which is `null` for anon, populated for authed) and forwards.

**Leaderboard masking** ([services/LeaderboardService.js](services/LeaderboardService.js)):

- The cache stores **viewer-agnostic** rows (a list of every user's `{userId, username, displayName, points, winRate, profileVisibility}`). `profileVisibility` was added to the cached shape by `lib/users.js buildUserSummary` + `lib/groups.js buildGroupLeaderboard` so the masking layer can decide per-viewer.
- `getOverallForViewer(viewer)` and `getForGroupForViewer(groupId, opts, viewer)` apply `applyMasking(rows, {viewerId, viewerIsAdmin, friendIds, exemptIds})` on top of the cached array. The cache stays a single source of truth shared across viewers; masking is a cheap per-request projection.
- **Masking rule per row**:
  - `viewerIsAdmin` → never mask
  - `row.userId === viewerId` → never mask (self)
  - `row.userId ∈ exemptIds` → never mask
  - `row.profileVisibility === 'public'` → no mask
  - `row.profileVisibility === 'friends' && row.userId ∈ friendIds` → no mask
  - otherwise: replace `username` with `displayName` if set, else `'Player #' + uuid.slice(0,4)`. Set `isMasked: true` on the row so the frontend can render an italic + "private" chip and suppress click-to-drawer.

**Group implicit social contract**: within a per-group leaderboard, members never see each other masked regardless of their visibility setting. `exemptIds` = the group's own member list. Joining a group is consent to be visible to other members.

**Anonymous viewers** of a public group's `/api/groups/:id` get a per-member-masked list (`GroupService.maskMembersForAnon`) — see §8.19 below.

**Cache invalidation**: `PUT /api/me` invalidates the `'all'` leaderboard cache when `displayName` OR `profileVisibility` actually changes. Without that, the masking layer would project against stale visibility for up to 30 s after the toggle.

**Friend requests bypass the gate**: `/api/users/search` returns every match with a `profileVisibility` flag (username stays in the response since friend requests need it; the client may render the row masked).

### 8.19 Anonymous Browse Mode

Architectural counterpart to the frontend gate UX described in §6.9. Public-read endpoints replace `authMiddleware` with `optionalAuth` + `publicReadLimiter`. Service-layer code branches on `req.user === null`:

| Endpoint                           | Anon behavior                                                                                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/games`                   | Same payload as authed                                                                                                                                                                                         |
| `GET /api/games/:gameId/comments`  | Same payload; per-comment `yourReactions[]` is `[]` for anon                                                                                                                                                   |
| `GET /api/leaderboard`             | Returns the masked variant of rows for the anon viewer (everyone non-`'public'` masked)                                                                                                                        |
| `GET /api/groups/discover`         | `GroupService.discoverPublic(viewer=null)` returns all public groups (authed: public groups the caller is not in)                                                                                              |
| `GET /api/groups/:id`              | `GroupService.getVisible({groupId, viewer=null})` returns 404 if private (avoids leaking existence); public returns group + `maskMembersForAnon(members)` projection so non-`'public'` member names are masked |
| `GET /api/search`                  | iLike across users/groups/games. Private groups the caller isn't in are hidden (same rule as authed-non-member); user rows carry `profileVisibility` so the client can render appropriately                    |
| `GET /api/users/:username/profile` | Visibility gate runs with `viewer=null`. Public profile: returns full payload BUT with `friendStatus: null` (no friend graph for anon). Friends-only / private: returns 404                                    |
| `GET /api/leagues`                 | Same payload as authed                                                                                                                                                                                         |
| `GET /healthz`                     | Same payload                                                                                                                                                                                                   |

**Write surface** is unchanged — every mutating route still goes through `authMiddleware` and 401s anonymous attempts. The frontend gate UX (§6.9) ensures anonymous viewers never reach those endpoints; they hit the gate first.

**Rate limiting**: `publicReadLimiter` (240 req/min/IP) applies on every `optionalAuth` route. Caps the cost of botnet browsing while leaving plenty of headroom for human dashboard fetches.

### 8.20 Onboarding Tour (Tier 11 Chunk 4)

First-time users see a 4-step modal walking through picks → scoring → leaderboard → groups. Implementation:

- **State**: `users.onboardingCompletedAt TIMESTAMPTZ NULLABLE`. `NULL` ⇒ tour should fire on next valid render.
- **Mount condition** ([src/components/OnboardingTour.jsx](src/components/OnboardingTour.jsx)): `user && !browseAsGuest && user.onboardingCompletedAt == null && view === 'games' && games.length > 0`. The `games.length > 0` gate avoids firing while the dashboard is still loading.
- **Dismissal**: both **Skip** and **Done** buttons `POST /api/me/onboarding-completed`. The route is idempotent (preserves existing timestamp on repeat calls). The user state's `onboardingCompletedAt` is locally set on success so the tour stops mounting immediately.
- **Reduced motion**: `useReducedMotion` from [src/lib/a11y.js](src/lib/a11y.js) skips the dialog animation when the OS requests reduced motion.

**E2E impact**: [tests/e2e/fixtures/seed.js](tests/e2e/fixtures/seed.js) pre-completes the tour for seed users (`onboardingCompletedAt: now`) so existing flows aren't blocked. Runtime-registered users in `pick-and-result.spec.js` get dismissed via the [tests/e2e/helpers/auth.js](tests/e2e/helpers/auth.js) `dismissOnboardingTour()` helper.

### 8.21 Theming (Tier 11 Chunk 1 + 3)

Light/dark theme system. Two themes ship — see §6.8 for the design-token mechanics.

- **Persistence**: `localStorage.sc_theme` ∈ `{'dark', 'light'}`. Legacy `'system'` values (from before Tier 11 Chunk 3 removed system mode) normalize to `'dark'` on read.
- **Application**: `lib/theme.js applyTheme(theme)` toggles `<html data-theme='...'>` and sets `color-scheme`. Called **synchronously in [main.jsx](src/main.jsx) before React mounts** so the user never sees a flash of the wrong palette.
- **Toggle**: [src/components/ThemeToggle.jsx](src/components/ThemeToggle.jsx) — a `Switch` primitive in the top utility bar.
- **Reduced motion**: [src/lib/a11y.js](src/lib/a11y.js) `useReducedMotion()` reads `prefers-reduced-motion`. Consumed by `OnboardingTour` (skips dialog animation) and any future motion-heavy component.

### 8.22 Live Score Pipeline (Tier 4b Chunk 2 — operational deep-dive)

The flow that turns football-data.org events into ScoreCast UI updates. Already covered architecturally in §8.16 + §5.5; this section captures the operational lifecycle and the defensive layers added after the 2026-05-19 incident.

```
       ┌──────────────────────────────────────────────────────┐
       │ football-data.org v4                                  │
       │   A. GET /v4/matches?status=LIVE,IN_PLAY,PAUSED      │
       │   B. GET /v4/matches?ids=...                          │
       │      (used by 30-s reconcile + 3-min defensive job)   │
       └─────────────────────┬────────────────────────────────┘
                             │
                             ▼
       ┌────────────────────────────────┐  ┌─────────────────────────────────┐
       │ lib/jobs/syncLiveScores.js     │  │ lib/jobs/                       │
       │   '*/30 * * * * *' (every 30s) │  │   reconcileInProgressGames.js   │
       │   — Tier 18 (was 1 min)        │  │   '*/3 * * * *' (every 3 min)   │
       │                                 │  │   — Tier 18 (was 5 min)         │
       │ • LIVE call (A) + per-match     │  │                                 │
       │   apply                         │  │ • Scans local status=in-progress│
       │ • Inline reconcile via ?ids=    │  │   + sourceId IS NOT NULL        │
       │   (B) for games that fell OFF   │  │ • ?ids= call (B) regardless of  │
       │   the LIVE filter OR have       │  │   LIVE-filter membership        │
       │   status=scheduled + kickoff    │  │ • Defensive layer against       │
       │   > 15 min ago                  │  │   upstream ?status= going stale │
       └──────────────────┬──────────────┘  └──────────────┬──────────────────┘
                          │                                  │
                          └──────────────┬───────────────────┘
                                         ▼  per match:
       ┌────────────────────────────────────────────────────────────┐
       │ services/GameService.applyLiveUpdate                        │
       │   BEGIN TX                                                  │
       │     fresh = SELECT * FROM games WHERE id=? FOR UPDATE       │
       │       ← serializes concurrent 1-min + 5-min calls on row    │
       │                                                             │
       │   if fresh.status='finished' && apiMatch.status not in      │
       │      ('FINISHED','AWARDED'):                                │
       │     log + return changed=false  ← finished-status guard     │
       │                                                             │
       │   newStatus = mapUpstreamStatus(apiMatch.status)            │
       │   newResult = deriveResultFromFixture(...)                  │
       │              // only if fresh.result==null                  │
       │   if (unchanged) return early                               │
       │                                                             │
       │   UPDATE games SET status=?, scores=?, result=?,            │
       │     halfTimeReached=?, phase=? WHERE id=?                   │
       │   COMMIT                                                    │
       │                                                             │
       │   if transitionedToFinished:                                │
       │     for each pick on this game:                             │
       │       NotificationService.notify('pick-scored')             │
       │       BadgeService.evaluateBadges()                         │
       │     LeaderboardService.invalidate('all')                    │
       └─────────────────────┬──────────────────────────────────────┘
                             │ DB
                             ▼
       Next client refreshGames picks up the new state. NotificationBell's 30s
       poll surfaces the pick-scored notification within ~30 s of the cron tick.
```

**Cost**: €19/mo on TIER_ONE (paid since 2026-05-23 — was $0/mo on the free tier). 20 req/min budget; 2 req/min averaged for the 30-s LIVE poll + ~0.33 req/min averaged for the 3-min `?ids=` reconcile + ~12 req for the daily fixture sync (single minute) = ~20% steady-state utilization, 16+ req/min headroom for admin syncs. **Plus** Azure Container Apps Consumption (~$0.10–$1/day depending on cron activity — see "Container Apps cost-gate" below).

**Container Apps cost-gate** (2026-05-26): all three cron jobs now early-return at zero outbound API cost when there's no relevant work. `syncLiveScores` runs a cheap `Game.count` on `{leagueId IN <active>, [(status='in-progress') OR (status='scheduled' AND date IN [now − 4h, now + 2h])]}` — when 0, no upstream call fires. `reconcileInProgressGames` early-returns when there are no local `status='in-progress'` rows (already had this gate). `sendKickoffReminders` early-returns when there are no scheduled games in the 15-30 min window (already had this gate). **Why this matters**: Azure Container Apps Consumption bills per vCPU-second of active work — pre-gate, every 30-s `syncLiveScores` tick made an upstream call + parsed the response regardless of local state, burning ~2880 wasted calls/day + the CPU to handle them. The Azure billing chart showed it clearly: daily costs ramped from ~$0.10 (pre-2026-05-21) to ~$0.77 after the 5-min reconcile + PWA kickoff cron landed, then climbed further after Tier 18 Chunk 2's 30-s tightening. Post-gate, daily cost during off-season + overnight should drop back toward the pre-2026-05-21 baseline; match-window cost stays the same. **Don't remove or shrink the gate's window** — the 4h lookback is the only catch for kickoffs that pass while the app is scaled to zero (longest realistic match runtime ≈ 165 min), and the 2h lookahead is what guarantees we pick up SCHEDULED → IN_PLAY the moment upstream flips.

**Multi-replica safety**: `pg_try_advisory_lock(crc32(jobName))` ensures only one replica runs each tick per job. `crc32` is deterministic + stable across deploys. Lock always released via `finally`. Each job has its own lock ID (different name → different crc32) so the 1-min and 5-min jobs do NOT contend at the scheduler level — they only serialize at the per-row level inside `applyLiveUpdate`.

**Row-level concurrency**: `applyLiveUpdate` opens a transaction and re-fetches the game via `SELECT ... FOR UPDATE`. A concurrent call on the same game row blocks at the lock, then re-reads the committed state from the first transaction (NOT the stale `localGame` snapshot the caller passed in). Without this, the 1-min and 5-min jobs at xx:00 / xx:05 alignments could load the same stale row simultaneously and the second `save()` would overwrite the first.

**Finished-status flip-back guard**: once `fresh.status === 'finished'`, any `apiMatch.status` that isn't `FINISHED` or `AWARDED` is treated as a stale lie and ignored. The guard returns `changed=false` and logs `applyLiveUpdate: ignored stale non-FINISHED upstream snapshot for already-finished game`. Allows legitimate FINISHED snapshots through (e.g. score corrections, replay re-finalizes) while blocking the `?status=` staleness regression vector.

**`NODE_ENV=test` opt-out**: `scheduler.start()` is a no-op so Playwright doesn't spawn surprise jobs.

#### Incident 2026-05-19: AFC Bournemouth vs Manchester City — upstream `?status=` filter went stale for 92+ minutes

**Trigger**: PL fixture sourceId 538145 (AFC Bournemouth 1–1 Manchester City) finished at 22:25 UTC. The canonical `?ids=538145` endpoint immediately reflected `status=FINISHED, winner=DRAW, fullTime=1-1, lastUpdated=22:25:33Z`. But the filtered `?status=LIVE,IN_PLAY,PAUSED` endpoint kept returning the same match with `status=IN_PLAY` and HT score `1-0` until at least 23:59 UTC — a 94-minute divergence between two endpoints of the same provider.

**Local impact**: The 1-min `syncLiveScores` job polled the LIVE filter every minute, faithfully mirroring the stale snapshot. The existing reconcile pass at the bottom of [lib/jobs/syncLiveScores.js](lib/jobs/syncLiveScores.js) explicitly EXCLUDED 538145 from `?ids=` escalation because the game WAS present in the LIVE response (`sourceId NOT IN [...liveSourceIds]`). So we never consulted the fresh endpoint. The DB row stayed `status='in-progress', homeScore=1, awayScore=0, result=null` for the duration. Picks couldn't be scored, leaderboard couldn't update, no notifications fired.

**Why this wasn't caught by prior design**: the architecture assumed upstream's two endpoints share a single freshness lane. The filtered endpoint was treated as a reliable enumeration of "what's currently live"; canonical lookup was only for catching matches that had **dropped off** the filter. football-data.org's free tier breaks that assumption. The TIER_ONE upgrade (2026-05-23) has NOT been verified to fix the underlying `?status=` staleness — the defensive `reconcileInProgressGames` sweep stays, just at 3-min cadence instead of 5-min (Tier 18).

**Diagnostic path** (preserved for future incidents):

1. Direct DB probe revealed the stuck row.
2. Probed both endpoints from inside the prod container with the live API key: `?ids=538145` was correct, `?status=` was stale. Confirmed it's an upstream-API bug, not our code.
3. Traced [lib/jobs/syncLiveScores.js](lib/jobs/syncLiveScores.js) reconcile predicate and identified the LIVE-filter-membership exclusion as the gap.

**Fix** (commit `c2d8fae`, deployed in revision `scorecast-app--0000045`):

1. **New 5-min job** [lib/jobs/reconcileInProgressGames.js](lib/jobs/reconcileInProgressGames.js) — sweeps every local `status='in-progress'` game with a sourceId via `?ids=` regardless of LIVE-filter membership. Schedule overridable via `IN_PROGRESS_RECONCILE_CRON` env.
2. **Row lock in `applyLiveUpdate`** — wraps compute+save in a transaction with `SELECT ... FOR UPDATE` so the 1-min and 5-min jobs serialize per row at xx:00 / xx:05 alignments. Without this, both jobs could read the same stale snapshot at the same instant and the second save would overwrite the first.
3. **Finished-status flip-back guard** — once locally settled, any non-FINISHED/AWARDED upstream snapshot is treated as stale.

**Live verification** (timestamps in UTC):

- 23:47:37 — new revision boots, `reconcileInProgressGames` registered.
- 23:50:01 — first `*/5` tick catches 538145: `caught stale-upstream finish via ?ids= ... result=draw`. DB transitions to `finished, 1-1, draw`. Pick-scored notifications fan out (would have, had there been picks).
- 23:50:06 → 23:59:03 — guard fires 10× (once per minute) as the 1-min job keeps seeing the still-stale `?status=` snapshot. Every guard fire is logged + the row is preserved. Zero regressions across 10 adversarial ticks.
- ~00:00 — upstream's `?status=` filter finally caught up; guard log stops firing.

**Worst-case stuckness**: pre-fix, observed 92+ minutes (and would have continued until next daily fixture sync at 03:00 UTC). Post-fix, ≤5 minutes (next `*/5` tick).

**Accepted residual risks** (cannot be addressed in code alone):

- Both upstream endpoints simultaneously stale → admin manual override is the only path. Provider swap to a paid tier is the long-term fix.
- App scaled to zero during a cron tick → in-process node-cron loses that tick; next `*/5` recovers within ≤5 minutes. Eliminated by `minReplicas=1` ($8–12/mo, parked decision).
- `FOOTBALL_DATA_API_KEY` unset → cron silently no-ops. Dev-environment behavior; documented.

**Operational signal**: if `applyLiveUpdate: ignored stale non-FINISHED upstream snapshot` starts firing repeatedly in prod logs for any sourceId, that's the upstream-filter-staleness signature. Cost per firing: ~1 transaction with a single PK lookup + 1 log line. Low. If it ever fires for many fixtures simultaneously and log volume becomes painful, options are to demote the log to `debug` or rate-limit per-game.

### 8.23 PWA + Web Push (Tier 7 PWA chunks)

Turns ScoreCast into a home-screen-installable app with native OS push notifications. Shipped as six chunks; see Critical Considerations in CLAUDE.md for the load-bearing invariants.

**Frontend installability layer (chunks 1-3)**:

```
┌─────────────────────────────────────────────────────────────────┐
│ index.html                                                       │
│   <link rel="manifest" href="/manifest.webmanifest"> ← auto      │
│   <link rel="apple-touch-icon" href="/apple-touch-icon-180.png">│
│   <meta name="theme-color" content="#020617" ...>                │
│   viewport-fit=cover                                              │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼  on first page load
┌─────────────────────────────────────────────────────────────────┐
│ vite-plugin-pwa registerSW.js                                    │
│   navigator.serviceWorker.register('/sw.js')                     │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ dist/sw.js (built from src/sw.js via injectManifest)             │
│   • workbox precache(self.__WB_MANIFEST)                         │
│   • runtime caching: Google Fonts (SWR + CacheFirst),            │
│     /api/{games,leaderboard,me,groups,leagues} (SWR 5min)        │
│   • skipWaiting + clientsClaim                                   │
│   • push handler → registration.showNotification()               │
│   • notificationclick handler → focus or openWindow              │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼  user gesture: <InstallPrompt /> Install button (Chromium)
                or Safari Share → Add to Home Screen (iOS)
┌─────────────────────────────────────────────────────────────────┐
│ Installed PWA — display: standalone, theme color status bar,     │
│ launches from home-screen icon, no Safari/Chrome chrome.         │
└─────────────────────────────────────────────────────────────────┘
```

**Icon set**: [public/logo.svg](public/logo.svg) is the single source. [scripts/generate-pwa-assets.mjs](scripts/generate-pwa-assets.mjs) uses `@resvg/resvg-js` + `png-to-ico` to produce `pwa-{64,192,512}.png`, `maskable-icon-512x512.png` (70% inner scale for Android Adaptive Icon safe zone), `apple-touch-icon-180x180.png`, and `favicon.ico`. Sidesteps the broken `sharp/libvips` win32-arm64 prebuild that breaks `@vite-pwa/assets-generator` on ARM Windows. Regenerate after editing logo.svg: `npm run generate-pwa-assets`.

**InstallPrompt + iOS gating** ([src/components/InstallPrompt.jsx](src/components/InstallPrompt.jsx)): renders a banner with three branches:

- Chromium with deferred `beforeinstallprompt` → "Install app" button calls native prompt.
- iOS Safari (`/iPad|iPhone|iPod/.test(ua)` or `MacIntel` + `maxTouchPoints>1` for iPadOS 13+) → "Tap Share → Add to Home Screen" instructions with inline share-icon SVG.
- Already-installed or dismissed → renders nothing. Dismissal persists via `localStorage.sc_install_dismissed`.

Mounted unconditionally in DashboardView — visible to both signed-in and anonymous-browse visitors. The component self-suppresses; no caller gating needed.

**Backend Web Push pipeline (chunks 4-6)**:

```
┌─────────────────────────────────────────────────────────────────┐
│ NotificationService.notify(userId, type, title, body, link)     │
│   1. Notification.create({...}) → bell row                      │
│   2. PushService.sendToUser(userId, type, {title,body,link})    │
│      .catch(() => {}) ← fire-and-forget                          │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ services/PushService.js                                          │
│   if !initialized: no-op (VAPID env not set)                     │
│   user = User.findByPk(userId)                                   │
│   if user.pushPreferences[type] === false: skip                  │
│   subs = PushSubscription.findAll(...)                           │
│   Promise.all(sendToSubscription(sub) for sub in subs)           │
│     on 410/404 Gone → destroy sub                                │
│     on other errors → failureCount++ ; destroy at 5              │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼  webpush.sendNotification(sub, body, {TTL:24h})
┌─────────────────────────────────────────────────────────────────┐
│ Browser push provider (FCM / Apple WebPush / Mozilla autopush)   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼  delivered to the device's service worker
┌─────────────────────────────────────────────────────────────────┐
│ src/sw.js 'push' handler                                         │
│   self.registration.showNotification(title, {body, icon, badge,  │
│     tag: type, data: {link}})                                    │
└─────────────────────────────────────────────────────────────────┘
```

**Subscription lifecycle**: [src/hooks/usePushSubscription.js](src/hooks/usePushSubscription.js) drives the W3C ceremony — `Notification.requestPermission()` → fetch `GET /api/push/vapid-public-key` → `pushManager.subscribe({userVisibleOnly: true, applicationServerKey})` → `POST /api/push/subscribe` with the `{endpoint, keys}` JSON. Unsubscribe walks the reverse path with rollback on server-side failure so the client+server never drift.

**Per-type preferences**: `users.pushPreferences` is a JSONB column mapping notification-type → boolean. Absent key (or `true`) means "deliver"; only an explicit `false` opts out. `PUT /api/me/push-preferences` does a partial merge so a one-key update doesn't clobber the rest. The known types live in [validation/schemas.js](validation/schemas.js) `PUSH_NOTIFICATION_TYPES` — adding a new type requires updating that enum AND `NOTIFICATION_TYPES` in [src/components/PushSettingsPanel.jsx](src/components/PushSettingsPanel.jsx). Current types: `pick-scored`, `badge`, `invite`, `group-join`, `odds-shifted`, `kickoff-reminder`, `friend-request`.

**Kickoff reminder cron** ([lib/jobs/sendKickoffReminders.js](lib/jobs/sendKickoffReminders.js)): every 15 min, finds `status='scheduled'` games kicking off in the next 15-30 min with `kickoffReminderSentAt IS NULL`, looks up every Pick on each game, fires `NotificationService.notify(userId, 'kickoff-reminder', ...)` per pick, stamps `games.kickoffReminderSentAt = NOW()`. Idempotent — duplicate ticks observing the same game skip via the stamp. Cron `KICKOFF_REMINDER_CRON` defaults to `*/15 * * * *`.

**VAPID config**:

- `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` env vars. Generate with `npx web-push generate-vapid-keys`.
- In prod, the private key is a Key Vault secret `vapid-private-key` referenced by [infra/modules/app.bicep](infra/modules/app.bicep). Must be seeded by hand BEFORE the first Bicep reapply that wires push (same pattern as `jwt-secret` / `football-data-api-key`). The public key + subject are plain Bicep params (`vapidPublicKey` / `vapidSubject`), required on every Bicep reapply that intends push to be live.
- Without VAPID configured, `PushService.init()` logs one warn at boot and `sendToUser` becomes a silent no-op. `GET /api/push/vapid-public-key` returns 503 so the frontend can branch the UI to "push not available" rather than mis-subscribing.

**Notification poll throttle**: [src/components/NotificationBell.jsx](src/components/NotificationBell.jsx) polls `/api/notifications` every 30s by default. PWA Chunk 5 drops the interval to 5 min when `navigator.serviceWorker.controller != null` — push delivers freshness in real time, polling becomes a fallback. Cheap signal; user with SW but no push subscription gets 5-min lag (acceptable).

**Critical iOS constraint**: iOS Safari only supports Web Push from an installed PWA, on iOS 16.4+. PushSettingsPanel renders an install-first gate (`isIos && !isStandalone`) that points users at the Share menu before the master toggle becomes available.

### 8.24 Games Calendar Viewer (Tier 18 Chunk 3)

Replaces the original three-section "live / upcoming / completed" cascade on the Games tab with a fixed 7-day calendar strip. Surfaces fewer games at once but makes day-by-day navigation trivial — particularly important now that the live-score pipeline keeps in-progress matches visible across days.

**Component**: [src/components/GamesCalendar.jsx](src/components/GamesCalendar.jsx). Lives inside `view === 'games'` in DashboardView.

**Window math**:

- 7 cells visible at a time: today − 3 → today + 3 (center on today on first load).
- Window index `N` covers days `[N*7 − 3, N*7 + 3]` relative to today; `windowIndex = 0` is the default.
- Prev/Next arrow buttons at the strip ends page by ±7 days. No horizontal scroll — every chip is `grid grid-cols-7` sized.
- A `?date=YYYY-MM-DD` query param is read on mount (regex-validated). If the URL date sits outside the default window, `windowIndex` snaps to `Math.round(diffInDays(today, urlDate) / 7)` so the chip is visible on first paint.
- Selecting a chip writes `?date=` via `history.replaceState`. Selecting today's chip DELETES the param (today is the canonical default).

**`useGames` selector** ([src/hooks/useGames.js](src/hooks/useGames.js)) exports a stable `dayKey(value)` helper (`Intl.DateTimeFormat('en-CA').format(...)` → `YYYY-MM-DD`) and a `byDay: Map<string, Game[]>` memo so per-day lookups are O(1) and consistent with the URL key format. `DataContext.consumeDeepLinks` imports the same `dayKey` so a `?gameId=` resolution writes a key that GamesCalendar will read correctly.

**Chips** carry three signals:

- Day-number rendered in cyan (inline `style={{ color: 'rgb(34, 211, 238)' }}` to bypass any CSS conflicts).
- Game count + live red pulsing dot when `meta.hasLive` (any game on this day has `status='in-progress'`).
- Active chip painted with `bg-accent/15` border; today's chip painted with `border-accent/40` even when not selected.

**"Back to today" pill** in the card header — only renders when `selectedKey !== todayKey`. When `liveToday` is true (any in-progress game today, regardless of window position), the pill carries a pulsing red dot so a user paging through the future doesn't miss live action.

**Empty days**: render `EmptyState` with day-aware copy — "Nothing kicking off today. Pick another day…" on today, "Pick another day, or page through with the arrows." on other days.

### 8.25 Friends' Picks Visibility (Tier 18 Chunk 4)

Surfaces every friend's pick on every game inside a ±30-day window. Two consumers: per-card collapsed panel inside `GameCard`, and a global flat list in `PicksHistory`'s new "Friends" tab.

**Endpoint** — `GET /api/picks/friends?gameId=<uuid>` ([routes/picks.js](routes/picks.js)) — authed. Optional `gameId` UUID-regex-validated. Implementation in [services/PickService.js](services/PickService.js) `listFriendsPicks(viewerId, {gameId})`:

```js
const FRIENDS_PICKS_HORIZON_DAYS = 30;
const FRIENDS_PICKS_MAX_ROWS = 500;
```

The query uses an `INNER JOIN` (`required: true`) against `Game` so the date filter and the optional `gameId` filter apply server-side. Each returned row is scored via `lib/scoring.js scorePick(pick, game)`, which honors the Tier 17 pick-time probability snapshots (`homeProbabilityAtPick` / `drawProbabilityAtPick` / `awayProbabilityAtPick`) — so a friend who picked when odds were 0.35 sees +65 even if the ML cascade later rewrote the game's live probabilities. Rows are then passed through `LeaderboardService.applyMasking` so a friend who has flipped to private since accepting the request still appears at their masked label, not their username.

**State** — `DataContext.friendsPicks` is a flat `[FriendPick]` slot loaded in `loadDashboard` and refreshed in `revalidate` (matches the cadence of `picks`, `games`, `leaderboard`). Empty when the viewer has no friends.

**Selector** — [src/hooks/useFriendsPicks.js](src/hooks/useFriendsPicks.js) memoizes `byGame: Map<gameId, FriendPick[]>` so per-`GameCard` lookups are O(1) without re-walking the list on every render.

**Per-card UI** — [src/components/FriendPicksPanel.jsx](src/components/FriendPicksPanel.jsx) mounted at the bottom of every `GameCard` body. Collapsed: "N friends picked" (or "No friends picked yet" if `byGame.get(game.id)` is empty). Expanded: per-row Avatar + username + side chip + outcome badge:

| Game state                                     | Outcome badge  | Tone                                                                                                     |
| ---------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| Pre-result (`game.result == null`)             | side chip only | neutral                                                                                                  |
| Won (pick.choice === game.result and not draw) | `✓ +<pts>`     | success (green)                                                                                          |
| Drew (game.result === 'draw')                  | `Drew +<pts>`  | **warning yellow** (not green — important Chunk 4 polish; matches the GameCard outcome badge convention) |
| Missed (pick.choice !== game.result)           | `✗ Missed`     | danger (red; NOT "+0" — easier to read at a glance)                                                      |

**My Picks tab — Friends mode** ([src/components/PicksHistory.jsx](src/components/PicksHistory.jsx)):

- Segmented `[Mine] [Friends]` toggle at the top (pill label "Friends" has NO apostrophe; section heading "Friends' Picks" keeps the apostrophe — distinct copy choices kept stable for screenreader consistency).
- Friend dropdown filter (Friends mode only) positioned LEFT of `LeaderboardFiltersBar` with matching `bg-overlay/60 rounded-2xl px-4 py-3` pill styling. Select text is non-uppercase so usernames render naturally.
- Shared `comparePicksByPendingThenRecent` comparator across both modes: unresolved picks first (kickoff ASC = soonest first), then resolved picks (kickoff DESC = most-recent first). Stops a user from scrolling past last week's games to see what's about to kick off.
- The Friends mode honors the existing `leaderboardFilters` ({leagueId, seasonId}) by client-side filtering — same pattern as the Mine mode.

### 8.26 Notification Deep-Links + Error Toast Cleanup (Tier 18 Chunk 6a + 6b)

**6a — Deep-link plumbing** is described in full in §6.2 (consumer + link convention table). The server side is just every `NotificationService.notify(...)` call site populating the 5th positional arg (`link`). No new state or endpoints — the SW `notificationclick` handler was already calling `clients.openWindow(targetUrl)` from `data.link`.

**Tier 19 follow-up — bell click-through + `odds-shifted` link fix.** Chunk 6a wired the server side AND the SW + boot consumers but missed the in-app `NotificationBell` click handler: bell row click only marked-read and ignored `n.link`, so the populated `link` field was dead for anyone interacting via the bell (i.e. anyone without push subscribed). Fix is a 3-file change: (1) `DataContext.navigateToDeepLink(link)` — `history.pushState`s the URL and re-runs the existing memoized `consumeDeepLinks(games)`; exported through context. (2) `NotificationBell.jsx` row click handler — does mark-read + `navigateToDeepLink` + `setOpen(false)` in order. (3) `services/GameService.js:notifyOddsShiftFanOut` — `odds-shifted` had been emitting `link = '/games/${game.id}'`, a path that isn't a real SPA route; both boot + new bell consumers parse only query params, and the SW would `openWindow` straight to a 404-ish "/" landing. Corrected to the convention `link = '/?gameId=${game.id}'`. The dedup `Notification.findOne({ where: { link, … } })` automatically tracks the new format. Boundary tests in `tests/e2e/notifications-badges.spec.js` cover badge → Profile tab and pick-scored → Games tab navigation + assert consumed params are stripped post-click.

**6b — Error toast cleanup** addresses two long-standing UX papercuts:

1. **Login race fix** ([src/views/AuthView.jsx](src/views/AuthView.jsx)). `AuthContext.handleLogin` shows the real status banner ("Invalid credentials") and re-throws. The re-throw used to bubble as an unhandled promise rejection → `clientErrorReporter` fired the generic "Something went wrong" toast and clobbered the banner. The fix wraps the AuthView-level `handleLogin` in try/catch that swallows the rejection — same pattern as the pre-existing `handleRegister`. AuthContext's contract is preserved (callers that want the throw still get it). Documented in `CLAUDE.md` "Frontend login error race" — closed by this chunk.

2. **`wasHandled` flag** ([src/hooks/useRequest.js](src/hooks/useRequest.js) + [src/lib/clientErrorReporter.js](src/lib/clientErrorReporter.js) + [src/contexts/NotificationContext.jsx](src/contexts/NotificationContext.jsx)). Every 4xx response thrown from `useRequest` now carries:

```js
const err = new Error(friendlyMessage(msg));
err.reqId = reqId;
err.status = response.status;
err.wasHandled = true; // ← Tier 18 Chunk 6b
throw err;
```

`reportClientError` short-circuits on `error.wasHandled === true` — skips both the DOM event AND the server-side POST to `/api/client-errors`. Rationale: a 4xx already has a user-facing message (the server's `error` envelope) that the caller will surface via `showStatus(error.message)`; there's nothing useful to log server-side, and the generic toast is actively harmful. `NotificationContext` has a defense-in-depth check on the same flag in its `scorecast:client-error` listener for the edge case where an unhandled rejection still carries it.

3. **Friendly wrappers** for cryptic error codes via `FRIENDLY_ERROR_CODES` in `useRequest`:

```js
const FRIENDLY_ERROR_CODES = {
  football_api_rate_limit: 'Live scores are catching up — try again in a moment.',
  rate_limited: 'Too many requests — slow down for a moment and try again.',
};
```

Unknown codes pass through unchanged so plain human-readable messages are unaffected. Add new entries here when an `AppError` factory in `lib/errors.js` surfaces a machine-readable code that ends up in a toast.

### 8.27 Legal Pages + Terms Acceptance (Tier 18 Chunk 6c)

End-to-end consent capture, designed for Trinidad & Tobago jurisdiction. Four user-facing legal pages, one in-app blocking acceptance gate, one versioned acceptance record.

**Legal pages** — [src/components/legal/](src/components/legal/): `LegalLayout.jsx` (shared chrome) + `Terms.jsx` / `Privacy.jsx` / `Copyright.jsx` / `CookiePolicy.jsx`. Each page is a static React component. Operator details live in a `LEGAL_CONTACT` constant at the top of each file (`Bantryx` / `bantryx@gmail.com` / Republic of Trinidad and Tobago, no postal address).

**Routing** — `App.jsx` checks `window.location.pathname` against `/terms`, `/privacy`, `/copyright`, `/cookies` BEFORE any other view logic and returns the matching component (which renders its own `<main id="main">` inside `LegalLayout`). The existing SPA fallback in `server.js` (any non-`/api/*` path → `dist/index.html`) means no backend route changes are needed; the pathname reaches the browser as a normal SPA boot. Trailing slash is normalized via `pathname.replace(/\/+$/, '') || '/'`. Anon and authed users see the same content — no auth gate, no skeleton wait. Direct visits AND clicks from the in-app `<Footer />` both work the same way.

**Copy depth — deliberate trim**: the pages are written for the general public, not for security researchers. We do NOT publish:

- specific cookie names (`sc_access` / `sc_refresh` / etc.) — cookies are described as "authentication" or "security" categories
- exact retention windows (24h / 1h / 30d) — described as "for as long as we need it"
- specific security mechanisms (bcrypt / SHA-256 / HttpOnly / CSP) — described as "industry-standard security and storage practices"
- named sub-processors (Azure / Cloudflare / Resend / Sentry) — described as "third-party providers for hosting, transactional email, and football fixture data"

Rationale: minimize attack-surface disclosure while still satisfying T&T DPA Chapter 22:04 (2011) data subject right-to-be-informed requirements. If a real DPA inquiry ever lands, the operator can name specific providers in a direct response (or via an internal annex) without that detail being indexed on the public site.

**Footer** — [src/components/Footer.jsx](src/components/Footer.jsx) mounted at the bottom of `<Landing />` (below the final CTA) and at the bottom of `DashboardView`'s `<main>`. Compact muted styling: `© <year> Bantryx · Trinidad & Tobago · [Terms] [Privacy] [Copyright] [Cookies]`. Links are plain `<a href="/...">` — clicking triggers a full navigation that goes back through `App.jsx`'s pathname short-circuit.

**Terms acceptance — data model**:

- `users.termsAcceptedAt TIMESTAMPTZ NULLABLE` — set the moment the user accepts (on registration OR via the blocking modal).
- `users.termsAcceptedVersion INTEGER NULLABLE` — the version they accepted. Compared against `CURRENT_TERMS_VERSION` (bundled into both server and client) to decide whether to re-prompt.

**Version constant** — `CURRENT_TERMS_VERSION = 1`. Lives in two places that **must stay in sync**:

- Server: [validation/schemas.js](validation/schemas.js) — exported alongside `acceptTermsSchema` for use by `routes/auth.js` and `routes/me.js`.
- Client: [src/lib/terms.js](src/lib/terms.js) — exported alongside `needsTermsAcceptance(user)` for use by `AuthContext`, `TermsAcceptanceModal`, and `App.jsx`.

When we ever change material terms, bump BOTH constants in the same commit. Every user whose recorded `termsAcceptedVersion < CURRENT_TERMS_VERSION` will see the blocking modal on next visit.

**Registration flow**:

1. `RegisterForm` shows a required checkbox: "I have read and agree to the **Terms of Service** and the **Privacy Policy**" (inline links open `/terms` and `/privacy` in a new tab via `target="_blank" rel="noreferrer"`).
2. Submit button is `disabled` until the box is checked. Client-side guard.
3. `AuthContext.handleRegister` sends `{username, password, email, acceptedTerms: true, acceptedTermsVersion: CURRENT_TERMS_VERSION}`. If the box wasn't checked, it throws a user-facing error before fetching.
4. `registerSchema` requires `acceptedTerms: z.literal(true)` AND `acceptedTermsVersion: z.literal(CURRENT_TERMS_VERSION)`. A stale frontend bundle that posts an older version fails the literal check at the schema layer with a recognizable 400.
5. `routes/auth.js` `POST /api/register` stamps both fields on `User.create` — so the new user never sees the blocking modal on first dashboard load.

**Existing-user flow (blocking modal)**:

1. Migration `20260526000002` adds both columns as NULLABLE. Every existing user lands on NULL/NULL.
2. `App.jsx` evaluates `showTermsGate = Boolean(user) && !browseAsGuest && needsTermsAcceptance(user)` after every render. `needsTermsAcceptance` returns `true` when the user's recorded version is missing OR less than `CURRENT_TERMS_VERSION`.
3. When `showTermsGate` is true, [src/components/TermsAcceptanceModal.jsx](src/components/TermsAcceptanceModal.jsx) mounts. It's a Radix Dialog with **all dismissal vectors blocked**:
   - `onEscapeKeyDown={(e) => e.preventDefault()}`
   - `onPointerDownOutside={(e) => e.preventDefault()}`
   - `onInteractOutside={(e) => e.preventDefault()}`
   - The Dialog's `onOpenChange` is a no-op (`() => {}`).
4. Only two actions are exposed: **"I accept"** POSTs `/api/me/accept-terms` with `{version: CURRENT_TERMS_VERSION}`. On success, merges `termsAcceptedAt` + `termsAcceptedVersion` into `user`, which trips `needsTermsAcceptance` to false and unmounts the modal. **"Sign out"** calls `performLogout` (clears auth, returns to landing).
5. `OnboardingTour` is suppressed while `showTermsGate` is open (`showOnboarding` ANDs `!showTermsGate`) so dialogs don't stack.

**Backend endpoint** — `POST /api/me/accept-terms` (authed + CSRF + validated). Returns 400 with `'Terms version is out of date — please reload'` if `req.body.version !== CURRENT_TERMS_VERSION` (stale-tab guard: a frontend bundle open since before a version bump can't silently accept the old version). On success, sets both columns + returns the new values.

**`GET /api/me` returns** the new `termsAcceptedAt` + `termsAcceptedVersion` fields — without them, the client couldn't tell whether to mount the gate.

**Test seeding** — [tests/e2e/fixtures/seed.js](tests/e2e/fixtures/seed.js) pre-accepts terms for the three seed users (mirrors the `onboardingCompletedAt` pattern). [tests/e2e/helpers/auth.js](tests/e2e/helpers/auth.js) `registerViaUI` ticks `#register-accept-terms` before clicking Register. Five API-level `/api/register` calls in `auth.spec.js` + `admin.spec.js` updated to send the new fields. Without these updates the existing E2E suite would 100% fail because (a) registration would 400 without the new payload fields, and (b) seed users would all hit the blocking modal on every sign-in.

### 8.28 Kickoff-Time Pick Scoring Lock (Tier 19 Chunk 5)

**Problem**: pre-Chunk-5, the three `Pick.picked{Home,Draw,Away}Probability` snapshot columns were written ONCE at pick-create time and never updated. A user picking on Monday at home=0.30 and a user picking on Saturday at home=0.45 (after the ML cascade moved odds) would score DIFFERENTLY for the same outcome on the same game — Monday's pick paid +70, Saturday's paid +55. The "scout early, pick at long odds" loop rewarded obsessive app-checking over predictive skill.

**Solution**: the AUTHORITATIVE snapshot write moves from pick-time to **kickoff-time**. After kickoff, every pick on the same game scores against IDENTICAL probabilities. Same-team picks pay the same regardless of when they were placed.

**Schema** — Migration [20260527000002](migrations/20260527000002-games-add-pick-probabilities-locked-at.js) adds:

- `games.pickProbabilitiesLockedAt TIMESTAMPTZ NULL` — stamped at the moment of lock.
- Partial index `games_unlocked_scheduled_idx ON games (status, date) WHERE "pickProbabilitiesLockedAt" IS NULL` — keeps both writers' hot queries cheap on a growing games table by scanning only the small "still eligible to lock" subset.

**Two writers** (defense in depth):

1. **Cron** ([lib/jobs/lockPickProbabilities.js](lib/jobs/lockPickProbabilities.js)) — registered at 1-min cadence (overridable via `LOCK_PICK_PROBABILITIES_CRON`). Each tick:
   1. Cost-gate via cheap `Game.count` against `{status: 'scheduled', pickProbabilitiesLockedAt: null, date: <= NOW()}`. If zero, return `{skipped: true, reason: 'no-relevant-games'}` — off-season ticks are near-free (mirrors the syncLiveScores cost-gate pattern).
   2. `Game.findAll` with same predicate.
   3. For each game, one transaction: `Game.findByPk(id, {lock: t.LOCK.UPDATE})` re-fetches with FOR UPDATE (concurrent applyLiveUpdate on the same row blocks here until the other transaction commits — and the reload sees the committed write, including any `pickProbabilitiesLockedAt` that beat us). If still unlocked, `Pick.update({pickedHomeProbability: fresh.homeProbability, pickedDrawProbability: fresh.drawProbability, pickedAwayProbability: fresh.awayProbability}, {where: {gameId: fresh.id}, transaction: t})` and stamp `fresh.pickProbabilitiesLockedAt = new Date()`.
   4. Per-game failures are logged-and-continued — one bad row mustn't break the rest of the batch.
2. **In-line hook** ([services/GameService.js](services/GameService.js) `applyLiveUpdate`) — when the live-score job pulls upstream state and the game transitions out of `status='scheduled'`, the same bulk Pick.update + stamp happen INSIDE the FOR UPDATE transaction that flips status. Atomic. The detection variable `transitionedOutOfScheduled` is captured BEFORE the status assignment (same pattern as the existing `transitionedToFinished` — see code), with predicate `fresh.status === 'scheduled' && newStatus !== 'scheduled' && !fresh.pickProbabilitiesLockedAt`. Covers the rare scheduled → finished direct jump in addition to the common scheduled → in-progress path (the former happens when upstream's first observation of a game arrives after the match is already done).

**Why both?** The cron handles the case where the app was scaled to zero around kickoff and the live-score signal didn't fire in time. The in-line hook handles the case where the live-score signal arrives between cron ticks. Either can fire first; whichever does, the other becomes a no-op (the `pickProbabilitiesLockedAt IS NULL` predicate excludes already-locked games).

**Cascade guard** — [services/PredictionService.js](services/PredictionService.js) `rePredictFutureFixtures` extends its WHERE clause with `pickProbabilitiesLockedAt: { Op.is: null }`. The existing `status='scheduled'` filter already covers this (a locked game is by then no-longer-scheduled), but the paranoid extra check makes the contract explicit and survives any future change to status semantics. After lock, the ML model can NEVER rewrite the game's probabilities — the cascade flat-out skips it.

**Picks after kickoff** — Still blocked by the existing `gameDate <= now` rejection in [services/PickService.js:24](services/PickService.js#L24). The plan's "post-kickoff pick creation path" is structurally satisfied by this — we don't WANT late picks anyway, so no new code path was needed.

**`'odds-shifted'` notification** — Still fires for PRE-kickoff probability changes ([services/GameService.js notifyOddsShiftFanOut](services/GameService.js)) because a pre-lock change DOES change your final payout. POST-kickoff it becomes structurally impossible because the cascade is gated against locked games. No notification-side code change needed; the contract narrows naturally.

**Frontend** — [src/components/GameCard.jsx](src/components/GameCard.jsx) `PayoutMatrix` gains a one-line "Payout locks in at kickoff." tooltip below the payout grid. The matrix numbers themselves were already the game's CURRENT probabilities (not the user's picked snapshot), so the visual already showed the right value — the tooltip clarifies the semantic.

**Tradeoff (explicit, deliberate)**:

- **Lost**: "pick early at long odds for value" gameplay. A pick at 0.30 home odds → win used to score +70. Now it scores whatever the model shows at kickoff (likely 0.35-0.45 on stable leagues → +55-65).
- **Gained**: same-team picks pay the same regardless of pick time. Fairness invariant is concrete and observable. Removes the incentive to obsessively re-check the app between picks.
- **CLAUDE invariant** documents the don't-reintroduce-pick-time-lock guardrail so future-me doesn't accidentally revert it not realizing the change was deliberate.

**Test coverage** — three e2e tests in [tests/e2e/api/picks.spec.js](tests/e2e/api/picks.spec.js) under the `lockPickProbabilities` describe block:

1. **Identical snapshots after lock**: alice picks at home=0.5, admin moves probabilities to home=0.7, bob picks at the new odds, kickoff passes, cron runs once. Both alice and bob now have `pickedHomeProbability=0.7` — same payout regardless of pick time.
2. **Idempotency**: cron runs once locks a game, second run returns `{skipped: true, reason: 'no-relevant-games'}` because the WHERE clause filters out the now-locked game.
3. **No-op on already-locked**: a game with `pickProbabilitiesLockedAt` set is excluded from the cron's query even if probabilities later move — picks retain their existing snapshot, mirroring the cascade-guard semantic at the cron layer.

New `updateGameFields(gameId, fields)` helper in [tests/e2e/helpers/api.js](tests/e2e/helpers/api.js) bypasses GameService so the tests can stage states the public API rejects (date in past, locked-at populated manually, etc.). `hooks: false` mirrors the existing setUserPassword pattern.

### 8.29 Tier 20 — Polish + Hardening + Tier 10 fold-in

A seven-chunk polish-and-hardening tier with no new infrastructure (explicitly no Redis, no managed services). Items chosen because they were either user-visible debt (legal copy, age gate, mobile overflow, broken share previews) or production-readiness gaps that Tier 10 had been carrying.

**Chunk 1 — Legal hardening + 13+ age gate + terms v2 bump** (see also §8.27). Three changes bundled under one `CURRENT_TERMS_VERSION` bump (1 → 2) so existing users see the blocking modal once, not three times:

1. **Dropped $50 liability floor** ([src/components/legal/Terms.jsx](src/components/legal/Terms.jsx) §7). Original clause capped liability at "the greater of (a) total paid in last 12 months, OR (b) USD $50". Since every user pays $0 on the free tier, the $50 OR-branch was a per-user exposure floor that served no purpose. Now reads "limited to the total amount you have paid us in the twelve months preceding the claim (which, for the free tier, is zero)" — standard structure for free consumer apps.
2. **Added 13+ age line** to Terms §3 Acceptable Use. "You must be at least 13 years old to use Bantryx. Some jurisdictions require an older minimum age — you are responsible for confirming the local requirement." Pairs with the existing Privacy page disclosure "We do not knowingly collect data from children under 13."
3. **Added `confirmedAge` literal-validated field** to [validation/schemas.js](validation/schemas.js) registerSchema. RegisterForm gains a second required checkbox (`#register-confirm-age`) above the existing terms checkbox; AuthContext.handleRegister guards both client-side with user-facing toasts before posting. `confirmedAge` is NOT persisted — existence of the registration row + `termsAcceptedAt` ARE the consent record (matches the `acceptedTerms` pattern from Tier 18 Chunk 6c). Bumping the minimum age requires a new terms version bump (which re-collects via the blocking modal).

**Chunk 2 — Profanity filter on 6 surfaces**. Adds [`obscenity`](https://www.npmjs.com/package/obscenity) (MIT, ~17KB, modern English matcher with l33t/repeated-char/zero-width transformers and built-in whitelisting for collision-prone English words like Scunthorpe). Shared `noProfanity` zod `.refine()` in [validation/schemas.js](validation/schemas.js) wired in alongside the existing Tier 5.5b `DANGEROUS_TEXT_CHARS` refine on every user free-text surface:

- `username` (registerSchema)
- `displayName` + `bio` (editProfileSchema)
- `commentSchema.body`
- `createGroupSchema.name`
- `joinRequestSchema.message` (Tier 19)

The matcher is initialized once at module load. Failed validation returns the standard 400 from the shared `validate()` middleware with the message "Please remove inappropriate language" — symmetric with the bidi/control-character rejection ergonomics. No mask/replace: UX is "fix and resubmit." Three boundary tests in `comments.spec.js` + `me.spec.js` + `groups.spec.js` lock the wiring; one per surface is enough since they all share the same refine function.

**Chunk 3 — Search → calendar deep-link**. DashboardView's SearchBar `onSelectGame` prop changed from `() => setView('games')` to `(game) => { setView('games'); navigateToDeepLink('/?gameId=' + game.id); }`. This reuses the Tier 18 Chunk 6a deep-link consumer infrastructure: `navigateToDeepLink` pushes the URL via `history.pushState`, then `consumeDeepLinks(games)` resolves the gameId against the games list, derives the day via `dayKey(game.date)`, writes a synthetic `?date=YYYY-MM-DD`, and strips the consumed `?gameId=` via `replaceState`. GamesCalendar's first-render useState initializer reads `?date=` and pre-shifts `windowIndex` when the target sits outside the default ±3-day window — so the chip is visible on first paint. Pre-fix, the in-app search surface only switched the tab but dropped the user on today; post-fix it lands them on the kickoff day directly.

**Chunk 4 — GamesCalendar mobile polish** ([src/components/GamesCalendar.jsx](src/components/GamesCalendar.jsx)).

- **Header re-layout**: replaced the flex-wrap `<h3>` + sibling pill with a `grid grid-cols-3 items-center` layout. Heading left (truncates with ellipsis at 360px via `min-w-0 truncate`), "Back to today" pill centered in the middle column (only renders when not on today; the center column stays empty-but-reserved otherwise), count right-aligned in column 3. Tracking tightened from `[0.24em]` to `[0.16em]` at `<sm:` to give long-form labels ("Wednesday, May 27") more room — bumps back to `[0.24em]` at `sm:`.
- **Today chip overflow fix**: at `<sm:`, the 7-col chip grid leaves ~40px per chip. The word "TODAY" with uppercase + letter-tracking eats more horizontal space than 3-letter weekday labels ("SAT", "SUN") — the `truncate` kicked in and showed "Toda…" which read as a layout bug. Mixed-case `'Today'` (no uppercase, no tracking) is narrower than the uppercase weekday and fits cleanly at the tightest width. Uppercase styling preserved at `sm:` and above where chips have room.

**Chunk 5 — Logo restyle (athletic motif + center)** ([public/logo.svg](public/logo.svg)).

- **Centering**: the original B path spanned `x ∈ [152, 410]` (midpoint 281, 25px right of the 512-canvas center 256). Every M/H/C endpoint shifted `-25` in x so the B now spans `x ∈ [127, 385]` (midpoint 256, true geometric centering). All other coordinates preserved exactly — letterform is bit-identical to the original, just repositioned.
- **Athletic motif — pitch-line accent**: new horizontal cyan stripe at `y=263` (the B's crossbar / pinch-point y-coordinate), 352px wide centered horizontally, 2px tall, fading from transparent at the edges to ~85% opacity in the middle via a horizontal linear gradient. Reads as a horizon / pitch line at 192px+ icon sizes; vanishes into the cyan bowl pinch at 32-64px favicon sizes so the favicon stays recognizably a B. Renders BEHIND the B (drawn first) so the letterform stays crisp.

[scripts/generate-pwa-assets.mjs](scripts/generate-pwa-assets.mjs) regenerates six PNG/ICO variants from the new SVG with no script change — the resvg-js pipeline picked up the new content unchanged.

**Chunk 6 — SEO + Open Graph + favicon in `<head>`** ([index.html](index.html)). Three problems solved: (a) Google SERP shows no favicon today (no `<link rel="icon">` was anchored against structured data); (b) shared links on Slack / Discord / WhatsApp / iMessage / FB / LinkedIn / X rendered as plain text — no preview image; (c) no schema.org markup for Google's Knowledge Graph.

- **Canonical + Open Graph** (`og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image` + `width`/`height`/`alt`) — cross-platform sweet-spot 1200×630 image at `/og-image-1200x630.png`.
- **Twitter Card** (`summary_large_image` with title / description / image).
- **Inline JSON-LD** WebApplication structured data — name, url, applicationCategory=GameApplication, logo, image, description, offers (price=0).

The JSON-LD body is INTENTIONALLY single-line formatted so its SHA-256 hash stays byte-stable. [server.js](server.js) `cspDirectives.scriptSrc` whitelists the computed hash explicitly (`'sha256-GhzleH2mfEY14NZF8AZ+UWxx4YN/y6+t46pWTLHVEUo='`) — helmet's default `'self'`-only CSP would reject the inline block otherwise. ANY whitespace or content change to the JSON-LD body means re-computing the hash via the one-liner documented at the top of `cspDirectives` in server.js.

New [public/og-template.svg](public/og-template.svg) — landscape 1200×630 SVG with the centered B (same path as logo.svg) + the BANTRYX wordmark (rendered via a generic Impact / Arial Narrow Bold font-family because resvg-js doesn't load webfonts at rasterization time — closest universal fallback to the live Bebas Neue wordmark) + tagline + URL. Same brand gradient + glow + pitch-line accent.

[scripts/generate-pwa-assets.mjs](scripts/generate-pwa-assets.mjs) extended with a `writeOgImage` step that rasterizes the landscape template at exactly 1200×630 (bypasses the square `writePng` helper which derives height from the SVG aspect ratio via fit-to-width).

**Chunk 7 — Production hygiene (Tier 10.1 + 10.5 fold-in)**.

- **`/readyz`** ([routes/health.js](routes/health.js)) — pings DB via `sequelize.query('SELECT 1')`, returns 503 on failure. `/healthz` stays liveness-only (no DB ping) so transient outages don't restart containers. [infra/modules/app.bicep](infra/modules/app.bicep) Readiness probe now points at `/readyz` (5s initialDelay, 10s period, 3-strike failure threshold); Liveness probe still on `/healthz` (10s initialDelay, 30s period, 3-strike).
- **Graceful SIGTERM** ([server.js](server.js)) — wraps the existing `app.listen()` return value with a SIGTERM + SIGINT handler. Shutdown order: (1) `server.close()`; (2) 25s drain race (5s buffer under ACA's default 30s `terminationGracePeriodSeconds`); (3) `scheduler.stop()`; (4) `sequelize.close()`; (5) `process.exit(0)`. Drain timeout → exit(1) so the orchestrator surfaces failed shutdown in deploy logs. A `shuttingDown` re-entry guard prevents double-fire. tini (already in Dockerfile) forwards SIGTERM correctly to the Node process — no entrypoint change needed.

**Out of scope (deliberate)**: Tier 10.2 (Sentry server-side) + Tier 10.3 (Prometheus /metrics) NOT folded in — kept Tier 20 focused. Tier 7 (SSE realtime + email/digests + full notification preferences UI) explicitly NOT folded in — SSE only pays off at multi-replica (which needs Redis); email/digest is its own tier-sized scope. Save both for Tier 21 or whenever Tier 10.4 (Redis) lands.

**Post-launch follow-ups (2026-05-26, commit `3fbb240`)** — three fixes after live prod testing:

1. **Chunk 3 search-tap was a no-op when the user was already on the Games tab**. Root cause: `navigateToDeepLink` calls `history.pushState` + `consumeDeepLinks` which writes `?date=` via `history.replaceState`. But pushState/replaceState DO NOT fire `popstate` — and GamesCalendar's `selectedKey` is initialized from the URL via a `useState` initializer that only runs ONCE on mount. So when the user stayed on the Games tab, the URL changed under the calendar's feet but `selectedKey` stayed stale. (The cross-tab case worked because GamesCalendar unmounts when `view !== 'games'` and remounts fresh, re-running the initializer.) **Fix**: `consumeDeepLinks` now dispatches a `scorecast:url-changed` `CustomEvent` on `window` after the `replaceState`. GamesCalendar adds a `useEffect` listener that re-reads `?date=` from the URL and snaps both `selectedKey` and `windowIndex`. Generic event name (not gameId-specific) so future deep-link targets that need to react in-place can reuse the same wakeup.
2. **Today-chip overflow returned**. The earlier Chunk 4 fix (lowercase `Today`) still clipped to `Toda…` on some viewport / font combos at < 360px because the truncate boundary was tight. The chip's accent border + cyan day-number color already communicate "this is today" without the word, so on `<sm:` we now render JUST the weekday label (`SAT/SUN/MON/...`) like every other chip — visual emphasis comes from the highlight alone. At `sm:` and above where chips have room, the explicit `TODAY` label comes back.
3. **`fullDayLabel` weekday dropped**. The long-form label used to return `Wednesday, May 27` for non-today/tomorrow dates. The weekday was redundant with the chip strip directly below (which always shows the weekday for the selected date) and ate the limited mobile header width. Now just `May 27`.

The `scorecast:url-changed` pattern is the durable take-away — any future component whose state is derived from URL params and remains mounted across in-app navigation must subscribe to this event rather than relying on the once-only `useState` initializer.

---

### 8.30 Tier 22 — Park 2FA + Pre-Launch Security Hardening

Tier 22 is a two-thread tier: (1) parking 2FA cleanly so revival is a `git revert` away, and (2) closing the audit gaps surfaced by a three-agent security scan ahead of the marketing launch. Both threads ship in one PR (`sec/launch-hardening`) as 3 commits + 1 cleanup, organized so each commit is independently revertible.

**Thread 1 — Park 2FA** (commit `b2bd286`). The 4 route handlers (`POST /auth/2fa/verify` + `/me/2fa/{setup,confirm,disable}`), the login challenge-cookie branch in `routes/auth.js`, three zod schemas (`totpSetupSchema`/`totpConfirmSchema`/`totpVerifySchema`), and the entire frontend surface (`TwoFactorSetup.jsx`, `TwoFactorChallenge.jsx`, AuthContext handlers `handle2faVerify`/`handle2faSetup`/`handle2faConfirm`/`handle2faDisable`, ProfileView panel, AuthView `twofa` branch) were deleted.

Deliberately preserved so revival is friction-free:

- `users.{totpSecret, totpEnabledAt, totpRecoveryCodes}` columns — schema-level, no migration needed to bring them back.
- Every `migrations/*` file mentioning totp — invariant of the project, never delete a migration.
- `lib/auth.js CHALLENGE_COOKIE` + `CHALLENGE_TTL_MS` constants — tiny footprint, used only by the dormant 2FA flow.
- The `twoFactorEnabled` boolean on `GET /api/me` (always `false` post-removal) — keeps the API shape stable for the revival commit.
- `speakeasy` + `qrcode` npm deps — leaving them means revival is literally `git revert` with no `npm install`.

Marker comments at the top of `routes/auth.js` and `routes/me.js` carry the revival recipe. 4 regression e2e tests assert each of the 4 endpoints returns 404 so a future inadvertent re-mount fails CI.

**The 20260514000001-disable-all-2fa.js migration already cleared every user's totp columns in May 2026**, so the removal lands on a clean data slate — nobody loses access. If 2FA is ever revived, the operator should audit `SELECT COUNT(*) FROM users WHERE "totpEnabledAt" IS NOT NULL` first (should be 0 today) before deciding whether to enforce 2FA for those users immediately or wipe + treat as opt-in.

**Thread 2 — Security patches** (commits `362a3a6` + `545688e` cleanup + `4c0c234`). Twelve verified findings from a three-Explore-agent audit:

| ID  | Severity | Patch                                                                                                                                                                                                                       |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3  | HIGH     | `npm audit fix` — `js-cookie ≤3.0.5` prototype hijack (`GHSA-qjx8-664m-686j`, CVSS 7.5).                                                                                                                                    |
| H1  | HIGH     | `sensitiveAccountLimiter` (10/hr/IP) on `/me/password` + `/me/email`; `lightWriteLimiter` (60/min/IP) on `/me/{push-preferences,onboarding-completed,accept-terms}` + PUT `/me` + `/notifications/{:id/read,read-all}`.     |
| H2  | HIGH     | `inviteLimiter` (5/min/IP) on `POST /groups/:id/invite`. Per-group pending-invite cap deferred (low real-world abuse risk; existing notification fan-out is bounded).                                                       |
| H3  | HIGH     | `CommentService.edit/remove` `assertStillMember()` re-check on group-scoped comments. Admin override on remove preserved (admin > group). Two e2e tests in `comments.spec.js`.                                              |
| H4  | HIGH     | `pushSubscribeSchema.endpoint` refine() against FCM/Apple/Mozilla/Edge allowlist + HTTPS-only. `PushService.sendToSubscription` defensive private/loopback-IP block (drops sub on send). Three e2e tests in `push.spec.js`. |
| H5  | MOD      | `npm audit fix` — `qs 6.11.1–6.15.1` DoS (`GHSA-q8mj-m7cp-5q26`).                                                                                                                                                           |
| H6  | MOD      | `overrides.uuid: ^11.1.1` in package.json (resolves `GHSA-w5hq-g745-h8pq` buffer-bounds via sequelize transitive without a semver-major sequelize bump).                                                                    |
| M1  | MED      | `/healthz` body shrunk to `{ ok: true }` exactly; e2e asserts `payload.uptime === undefined`.                                                                                                                               |
| M2  | MED      | CORS non-prod fallback locked to localhost (`['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173']`); was `true`.                                                                                     |
| M3  | MED      | Explicit `hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }` (was helmet default w/o preload). Eligible for HSTS preload list after 30 days of prod traffic.                                               |
| M4  | MED      | `MAX_GROUP_MEMBERS = 500` (env-overridable, clamps [10, 5000]) enforced in 4 add-member paths in `GroupService.js` (`joinPublic`, `joinWithPassword`, `acceptInvite`, `approveJoinRequest`).                                |
| L4  | LOW      | Extended Permissions-Policy beyond camera/mic/geo/payment to also deny `usb, fullscreen, accelerometer, gyroscope, magnetometer, interest-cohort`. Defense-in-depth.                                                        |

**Drive-by fix** during verification: a pre-existing regression in `pushPreferencesSchema` where Zod 4's `z.record(z.enum([...]), z.boolean())` requires every enum key to be present, breaking the documented partial-update merge contract (`PushService.updatePreferences` does a JSONB merge). Switched to `z.record(z.string(), z.boolean())` + a refine that gates keys against `PUSH_NOTIFICATION_TYPE_SET`. Confirmed pre-existing by checking out main and reproducing the failure before the fix.

**Group cap (M4) e2e test was deliberately skipped** — cap=500 makes direct e2e impractical without seeding 500 fake users (the `group_members` table FK to `users.id` blocks the direct-SQL workaround). The cap is a single readable predicate (`count >= MAX_GROUP_MEMBERS`) easily verified by code review; the env override exists so a future staging test can dial it down to a testable value.

**Defense-in-depth recommendations** (operational, not code-shipped):

1. Cloudflare WAF managed ruleset (OWASP Core, paranoia 1).
2. Cloudflare Bot Fight Mode.
3. Cloudflare edge rate limits on `/api/login`, `/api/register`, `/api/auth/forgot-password` — backstop the app-level limiters.
4. Sentry alerts on any 5xx from `/api/auth/*` + spikes in 401s + `client-errors` POST rate.
5. Postgres connection ceiling check (Sequelize pool 5 × ACA max 3 replicas = 15 connections, B1ms cap ≈ 50).
6. Backup restore drill before launch.
7. Secrets rotation drill — `JWT_SECRET`, `RESEND_API_KEY`, `FOOTBALL_DATA_API_KEY`, `VAPID_PRIVATE_KEY`.
8. Publish `security@bantryx.com` or `/.well-known/security.txt` for external researchers.
9. Audit-log weekly digest cron emailing admin.
10. Verify `NODE_ENV=production` on the Container App — if it ever drops to dev, `/api/openapi.json` would leak the entire attack surface.

**Accepted-risk items** (documented in CLAUDE.md):

- Postgres firewall `AllowAllAzureServices` — cost-gated; Tier 10.4 will move to VNet integration.
- No CAPTCHA on register — `registerLimiter` (3/hr/IP) + Resend's own quotas cover abuse for now.
- No file upload surface today — avatars are deterministic from username. If avatar upload is ever added, redo the audit.

**Pre-existing UI-spec flake during verification** (fixed before Tier 22 merge): the full e2e sweep showed 342 pass + 6 fail. All 6 failures (admin-panel, comment-reaction, group-lifecycle, pick-and-result, picks-snapshot ×2) were pre-existing on main — confirmed by checking out main and reproducing the same "Pick Test Lions to win button not found" failure with the same test. Root cause: seed data dates sit on calendar chips that the test didn't navigate to from the default `today` selection (a Tier 18 Chunk 3 calendar widget change). **Fixed in PR #18 (`c2853f2`, merged 2026-05-28 ahead of Tier 22)** — new `tests/e2e/helpers/games.js` `selectGameDate(page, dateOrGame)` helper drives the in-app `scorecast:url-changed` event + `?date=YYYY-MM-DD` URL param to snap the calendar chip onto the target game's date before hunting for UI. PR #18 also fixed an admin GameManager race on leagues fetch, a browser-cache `/api/games` staleness after admin writes (`page.reload()` workaround; real product fix would be `Cache-Control: no-store` on `GET /api/games`, flagged inline), and a Tier-19-stale `Invite a friend` selector (switched to `getByRole('textbox', { name: 'Search users to invite' })`). Net Tier 22 verification at deploy time: all e2e specs green.

**Verification matrix**:

- ESLint clean (2 pre-existing warnings unchanged across the 3 commits).
- 42/42 unit tests green.
- `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities (the 2 remaining moderates are in `vite`/`esbuild` devDependencies — never reach the production image).
- API spec subset: 189/189 across health + auth + me + picks + groups + comments + push.
- 9 new boundary tests (4 Tier 22 2FA-routes-removed regressions, 3 push-SSRF, 2 comment-IDOR-after-leave).
- Full plan at `C:\Users\vinde\.claude\plans\tier22.md`.

---

## 9. End-to-End Data Flows

### 9.1 Login → Dashboard Load

```
Browser:                              Server:                            DB:
─────────────────────────────────────────────────────────────────────────────
1. POST /api/login   ─────────────▶  loginLimiter
   { username,password }              validate(loginSchema)
                                      getUserByUsername(name)  ──────▶  SELECT * FROM users WHERE iLike
                                      [Tier 6.6] check lockedUntil
                                      bcrypt.compare(pw, hash)
                                      [Tier 6.6] reset loginAttempts on success
                                      [Tier 6.9] if totpEnabledAt: issue sc_challenge cookie + return {challenge:true}
                                      [Tier 6.8] setAuthCookies(res, user) ─▶  INSERT INTO refresh_tokens
   { user } ◀──────────────────────  Set-Cookie: sc_access; sc_refresh; sc_csrf
                                      (no token in body)

2. (cookies are HttpOnly; SPA cannot read them — only `user` is stored in component state)
3. handleLogin → setUser → loadDashboard()

4. Parallel fetches (in loadDashboard order):
   GET /api/me ──────────────────▶  authMiddleware  ──────────────▶  SELECT user, joined groups, pending invites
   GET /api/games  ──────────────▶  authMiddleware  ──────────────▶  SELECT * FROM games ORDER BY date ASC
   GET /api/groups ──────────────▶  authMiddleware  ──────────────▶  SELECT groups joined; for each, members + invites
   GET /api/picks ───────────────▶  authMiddleware  ──────────────▶  SELECT * FROM picks WHERE userId=...
   GET /api/leaderboard?groupId=  ▶ authMiddleware  ──────────────▶  buildUserSummary + buildGroupLeaderboard
   GET /api/friends ─────────────▶  authMiddleware  ──────────────▶  SELECT friendships; partition by direction
   GET /api/groups/discover ────▶  authMiddleware  ──────────────▶  SELECT public groups not joined + counts

5. setLoading(false) → dashboard renders
6. NotificationBell mounts → starts 30s poll on /api/notifications
```

### 9.2 Submit Pick → Game Result → Notification + Badge

```
[ user clicks "Pick Home" on GameCard ]
        │
        ▼
submitPick(gameId, 'home') → POST /api/picks { gameId, choice: 'home' }
        │
        ▼  server:
   validate(pickSchema)
   if game.date <= now or game.result → 400
   upsert Pick(userId, gameId) with choice=home
   evaluateBadges(userId)            ───── awards 'first-pick' if applicable
   200 { success: true }
        │
        ▼  client:
   refreshGames + refreshPicks + refreshLeaderboard
   showStatus('Pick saved successfully')


────── days later, admin sets the result ──────

POST /api/games/:gameId/result { result: 'home' }   (admin via GameManager)
        │
        ▼  server (Tier 17 — transactional):
   TX:
     SELECT games ... FOR UPDATE
     game.result = 'home'; game.status = 'finished'; game.save({transaction})
     PredictionService.onResultUpdated(game, {transaction})
       previous = game.appliedResult ?? null  (existing value)
       next = 'home'
       if previous === next → idempotent no-op, return null
       SELECT teams (homeTeam, leagueId) FOR UPDATE
       SELECT teams (awayTeam, leagueId) FOR UPDATE
       if previous != null && snapshot present:
         reverse prior delta: team.elo -= eloDelta(snapshot, previous)
       if next != null:
         if !snapshot: snapshot live team Elo into game.homeEloPre / awayEloPre
         apply: team.elo += eloDelta(snapshot, next)
       team.gamesPlayed += (delta in {0, +1, -1})
       team.lastMatchDate = game.date.toISOString().slice(0,10) (on apply only)
       game.{homeEloPre, awayEloPre, appliedResult} updated; game.save
   COMMIT (mid-cascade exception → ROLLBACK; result + Elo + snapshot all intact)

   POST-COMMIT side effects:
     for each pick on this game:
       scorePick(pick, game) → N
       notify(pick.userId, 'pick-scored', 'Your pick on X vs Y: ✓ Correct +N pts')
       evaluateBadges(pick.userId)     ───── may award first-win, correct-N, upset-specialist
     LeaderboardService.invalidate('all')
     PredictionService.rePredictFutureFixtures({affectedTeams, leagueId})  ← Tier 17
       loadModel('lib/ml/models/PL_elo.json')  (per-league cache)
       Game.findAll({status:'scheduled', homeTeam|awayTeam in [home, away]})
       for each upcoming fixture:
         probs = xgboost.predict(model, [eloByName[home], eloByName[away]])
         triple = normalize.toThreeWay(probs[0], probs[1], probs[2])
         game.update({homeProbability, drawProbability, awayProbability})
       logger.info({rewritten: N, skipped: 0}, 'cascade complete')

   200 { success: true, game }


────── moments later in the user's browser ──────

NotificationBell's 30s timer fires
   GET /api/notifications
        │
        ▼
   unreadCount becomes > 0 → bell shows red badge
   user opens dropdown → sees "✓ Correct +N pts" notification
   click → POST /api/notifications/:id/read → optimistic local dim
```

### 9.3 Send Friend Request → Accept → Head-to-Head Shows

```
[ Alice opens vo123's profile drawer from the leaderboard ]
   GET /api/users/vo123/profile  →  friendStatus: 'none'
   Drawer renders "Add friend" button

[ Alice clicks "Add friend" ]
   POST /api/friends/request { username: 'vo123' }
        │
        ▼  server:
   guards: not self, not duplicate, not already friends
   Friendship.create({ requesterId: alice, addresseeId: vo, status: 'pending' })
   notify(vo, 'friend-request', 'alice sent you a friend request')

[ vo opens NotificationBell → sees request → opens Groups tab → FriendsList ]
   incoming list shows 'alice'
   click Accept → POST /api/friends/<id>/accept
        │
        ▼  server:
   friendship.status = 'accepted'
   friendship.acceptedAt = NOW
   notify(alice, 'friend-request', 'vo123 accepted your friend request')

[ Alice re-opens vo's profile ]
   GET /api/users/vo123/profile  →  friendStatus: 'friends'
   computes head-to-head: for each shared completed game, compare scorePick(alice) vs scorePick(vo)
   ProfileView renders "You X — Y vo123 (Z ties)"
```

### 9.4 Admin Deletes a User (Tier 5.3 — transactional)

```
Admin opens UserManager → clicks Delete on bob → ConfirmModal → Confirm

DELETE /api/admin/users/<bobId>
        │
        ▼  routes/admin.js:
   authMiddleware → requireAdmin → auditMutation('admin.user.delete', 'user') → handler
        │
        ▼  handler:
   if bobId === req.user.id  → 400 'You cannot delete yourself'
   BEGIN TX
     UserService.cascadeDelete(bob, {transaction: t}):
       ownedGroups = groups where ownerId = bob
       if ownedGroups:
         DELETE group_members WHERE groupId IN ownedGroups
         DELETE group_invites WHERE groupId IN ownedGroups
         DELETE groups        WHERE id IN ownedGroups
       DELETE picks                       WHERE userId = bob
       DELETE comments                    WHERE userId = bob
       DELETE comment_reactions           WHERE userId = bob
       DELETE friendships                 WHERE requesterId = bob OR addresseeId = bob
       DELETE group_members               WHERE userId = bob
       DELETE group_invites               WHERE username = bob.username
       DELETE email_verification_tokens   WHERE userId = bob
       DELETE password_reset_tokens       WHERE userId = bob
       DELETE refresh_tokens              WHERE userId = bob
       DELETE notifications               WHERE userId = bob
       DELETE badges                      WHERE userId = bob
       DELETE users                       WHERE id = bob
   COMMIT  (mid-cascade exception → ROLLBACK; parent + children all intact)

   audit_log row written via res.on('finish'):
     { action: 'admin.user.delete', entityType: 'user', entityId: bob, after: req.body, statusCode: 200 }

   200 { success: true }
```

**Why the token / notification / badge tables get explicit destroys** even though they're `ON DELETE CASCADE` at the DB level: prod was originally deployed with `sync({ alter: false })` running BEFORE migrations, which created those FKs with `NO ACTION` (Sequelize default). The shipped `CREATE TABLE IF NOT EXISTS … ON DELETE CASCADE` migrations no-op'd against already-synced tables, so prod's FKs were stuck on NO ACTION and `cascadeDelete` 500'd whenever the target had any token / notification / badge row. The three-part fix is documented in CLAUDE.md "Cascade-delete fix-up". Explicit destroys inside the tx are the belt; the migration retrofit ([20260516000002-cascade-user-fks.js](migrations/20260516000002-cascade-user-fks.js)) is the braces.

**Bulk-delete**: `POST /api/admin/users/bulk` runs **one transaction per id** (not one tx for the entire batch). A bad row aborts the batch but everything already committed stays orphan-free. Self-id is silently filtered into `skipped: [{id, reason: 'self'}]` before the loop.

### 9.5 Live-Score Tick → Pick Resolution

See §8.22 for the full lifecycle diagram. Compressed:

```
60s tick → scheduler acquires advisory lock → footballApi.getLiveMatches()
  ├─ for each in-progress match: GameService.applyLiveUpdate(localGame, apiMatch)
  │     TX:
  │       SELECT ... FOR UPDATE (row-lock; serializes vs the 5-min job)
  │       if fresh.status='finished' && apiMatch.status not in (FINISHED,AWARDED):
  │         log + return — finished-status flip-back guard
  │       update games {status, homeScore, awayScore, result, halfTimeReached, phase}
  │       if transitionedToFinished && newResult && leagueId:
  │         PredictionService.onResultUpdated(fresh, {transaction: t})  ← Tier 17
  │           SELECT teams ... FOR UPDATE × 2 (home + away)
  │           snapshot game.{homeEloPre, awayEloPre} if first capture
  │           apply eloDelta(snapshot, newResult) to team rows
  │           stamp game.appliedResult = newResult
  │     POST-COMMIT (outside tx):
  │       if just transitioned to 'finished' AND result was null → now set:
  │         for each pick on this game:
  │           NotificationService.notify('pick-scored', '... Drew/Won/Missed +N pts')
  │           BadgeService.evaluateBadges()
  │         LeaderboardService.invalidate('all')
  │         PredictionService.rePredictFutureFixtures({affectedTeams, leagueId})  ← Tier 17
  │           load lib/ml/models/<code>_elo.json (cached after 1st load)
  │           Game.findAll({status:'scheduled', homeTeam|awayTeam in [affected]})
  │           for each: predict([homeElo, awayElo]) → toThreeWay → game.update(probs)
  └─ reconcile pass: for in-progress local games not in the LIVE response,
       and scheduled local games with kickoff > 15 min ago:
       footballApi.getMatchesByIds([...]) → applyLiveUpdate (same flow)

5-min tick → scheduler acquires advisory lock → for every local status='in-progress'
  game with a sourceId: footballApi.getMatchesByIds([...]) → applyLiveUpdate
  (defensive sweep — catches upstream-?status=-filter staleness; idempotent)
```

Frontend picks up the update on the next `refreshGames` call (after pick / undo / admin action) or on a manual tab switch. Notifications surface via NotificationBell's 30 s poll. No WebSocket/SSE today.

**Tier 17 cascade** runs both inside the live-update tx (atomic Elo update) and after commit (probability rewrites). The cascade is best-effort post-commit: a model-load failure or per-fixture predict throw never undoes the result commit above it. See §8.17 for the full mechanism + behavior matrix.

---

## 10. Cross-Cutting Concerns

### 10.1 Error Handling

**Server**:

- Every route handler is wrapped in `try { ... } catch (error) { res.status(500).json({error: '...'}) }`. Catch blocks call `req.log.error({err}, 'handler error')` (Tier 5.4) and return a generic message; no stack trace leaks to the client. The structured log carries `reqId`, so a 500 returned to a user can be traced back to the exact handler invocation via the response's `X-Request-Id` header.
- **zod validation errors** are 400 with the `issues` array (path + message).
- **Specific business errors** (e.g. duplicate friend request) are 400 with a human-readable string.
- **Sentry error middleware** (Tier 5.4b) is mounted via `sentry.setupExpressErrorHandler(app)` after all routes. It captures any error propagated via `next(err)` to Sentry — no-op when `SENTRY_DSN` is unset.

**Frontend** (Tier 5.4b restructured this from "no error boundary" to a three-path strategy — see §6.7):

1. **React render errors** → caught by [ErrorBoundary](src/components/ErrorBoundary.jsx) → fallback UI + report.
2. **Window-level errors / unhandled rejections** → [clientErrorReporter](src/lib/clientErrorReporter.js) → POST `/api/client-errors` + custom DOM event → `NotificationContext` shows a cyan toast.
3. **Handled API errors** (anything `request()` throws) → caller's `.catch()` → `showStatus(error.message)`. The special `'Session expired'` error is not re-toasted (the session-expired handler already toasted).

All three paths converge on the **server-side structured log** via `POST /api/client-errors`. Sentry sees paths 1 + 2 directly (its browser SDK installs its own `window.error` listener at `init`).

**What users see** by failure type:

- Render error → full-page fallback card (Reload / Try again buttons; raw error text only in dev builds).
- Window/async error → 3.5 s cyan toast: _"Something went wrong — refresh if things look off."_
- API error → contextual cyan toast with the server's `error` message (or _"Request failed"_ fallback).

### 10.2 Security Posture (post-Tier 6)

| Concern                      | Status                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ----- | -------- | --- | ---- | ------ | ---------- | ------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| Password storage             | bcrypt cost 10, enforced via model hooks                                                                                                                                                                                                                                                                                                                                                                           |
| Auth secret                  | JWT_SECRET required in prod; insecure dev fallback never reaches prod                                                                                                                                                                                                                                                                                                                                              |
| Session transport            | **HttpOnly cookie auth** (Tier 6.8): `sc_access` (15-min JWT) + `sc_refresh` (30-day opaque, rotating, hashed in DB). Bearer-header path removed. XSS payloads can't lift either cookie                                                                                                                                                                                                                            |
| Token storage in DB          | SHA-256 hashes of high-entropy random tokens (refresh, verify-email, password-reset); bcrypt for low-entropy recovery codes                                                                                                                                                                                                                                                                                        |
| Brute force                  | Per-route rate limits across login, register, comments, friend-requests, picks, forgot-password, client-errors (Tier 6.10); per-user lockout after 5 failed logins (Tier 6.6); generic 401 to avoid enumeration. `app.set('trust proxy', 1)` so per-IP buckets resolve to the real client IP through Cloudflare → Azure ingress (was the proxy IP before)                                                          |
| Login timing                 | **Constant-time** — login always runs `bcrypt.compare` against either the real hash or `LOGIN_DUMMY_HASH` (generated once at module load); no observable response-time difference between "user does not exist" and "user exists, wrong password". `/api/auth/forgot-password` token INSERT + email send moved to `setImmediate` so the 204 latency is dominated only by the user lookup that runs in all branches |
| JWT verification             | **HS256 pinned** on every `jwt.verify(..., {algorithms:['HS256']})` call site — `middleware/auth.js`, `middleware/optionalAuth.js`, `routes/auth.js` (2FA challenge), `routes/client-errors.js`. jsonwebtoken@9 already rejects `alg:none` by default; explicit pinning is belt-and-braces                                                                                                                         |
| Identity-change re-auth      | `PATCH /me/email` + `POST /me/2fa/setup` + `POST /me/password` all require `currentPassword` in the body so a stolen access JWT alone can't pivot a brief cookie compromise into account takeover. `PATCH /me/email` also notifies the OLD address before overwriting                                                                                                                                              |
| In-session password change   | `POST /api/me/password` — bcrypt-compares `currentPassword`, saves new (Sequelize beforeUpdate re-hashes), then `revokeAllUserRefreshTokens` followed by `setAuthCookies` so the calling client stays signed in but every other device is kicked out                                                                                                                                                               |
| Input validation             | zod on every body; no trust placed in client-side validation. Body limit 32KB (was the 100KB default); `displayName`/`bio` reject bidi-override + zero-width + control codepoints (allowing ZWJ for emoji)                                                                                                                                                                                                         |
| SQL injection                | Sequelize parameterizes everything; raw SQL in migrations has no user input                                                                                                                                                                                                                                                                                                                                        |
| RBAC                         | `requireAdmin` middleware; admin endpoints under `/api/admin/*` plus the legacy `POST /api/games/:gameId/result`                                                                                                                                                                                                                                                                                                   |
| Self-protection              | Admin cannot demote or delete self (server-side, not just UI)                                                                                                                                                                                                                                                                                                                                                      |
| XSS                          | React's default escaping; no `dangerouslySetInnerHTML` anywhere. CSP `default-src 'self'` blocks inline `<script>` injection                                                                                                                                                                                                                                                                                       |
| CSRF                         | **Double-submit cookie** (Tier 6.7): `sc_csrf` cookie + `X-CSRF-Token` header, `crypto.timingSafeEqual` compare. SameSite=Lax is the first wall; double-submit is belt-and-braces                                                                                                                                                                                                                                  |
| CORS                         | **Env allowlist** (Tier 6.1) via `CORS_ORIGINS`; server throws on boot in prod when empty                                                                                                                                                                                                                                                                                                                          |
| Security headers             | **helmet** (Tier 6.2) with CSP tuned for Vite+Tailwind+Sentry; HSTS; `X-Frame-Options: DENY`; `Referrer-Policy: no-referrer`; `X-Content-Type-Options: nosniff`. Plus a `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` middleware right after helmet (helmet doesn't set this by default)                                                                                              |
| Password reset               | **Email-based** (Tier 6.4): 15-min single-use tokens, always-204 response shape (no enumeration). Reset additionally revokes all refresh tokens (force-logout-everywhere)                                                                                                                                                                                                                                          |
| Email verification           | **Required at register** (Tier 6.5): 24h single-use tokens. `forgot-password` only sends to verified emails                                                                                                                                                                                                                                                                                                        |
| 2FA                          | **Opt-in TOTP** (Tier 6.9) via speakeasy. 10 single-use recovery codes (bcrypt-hashed) with **constant-time verification** — `Promise.all(codes.map(bcrypt.compare))` instead of an early-exit loop, so the matched index can't be inferred from response time. 5-min `sc_challenge` cookie between password-OK and code-OK                                                                                        |
| Audit log                    | **Tier 4b Chunk 3** — `auditMutation(action, entityType)` wraps every `/api/admin/*` mutation; 4KB payload truncation; `actorUserId` SET NULL on user delete so history survives admin removal. Read via paginated `GET /api/admin/audit-log` + the AuditLog admin tab                                                                                                                                             |
| Telemetry PII                | Sentry init (`lib/instrument.js`) explicitly sets `sendDefaultPii: false`, `maxBreadcrumbs: 50`, and a `beforeSend` hook that redacts any key matching `password                                                                                                                                                                                                                                                   | secret | token | recovery | otp | totp | cookie | set-cookie | authorization | csrf | api[-_]?key`from`request.{data,headers}`, `extra`, `contexts`, and `breadcrumbs[].data` before the event leaves the process |
| Dependency hygiene           | CI runs `npm audit --audit-level=high --omit=dev` on every PR. `.github/dependabot.yml` opens weekly grouped PRs for npm prod/dev + pip (`ml/`) + github-actions + docker (root and `ml/`)                                                                                                                                                                                                                         |
| Multi-device session listing | Not implemented today; `refresh_tokens.userAgent` is captured to support a future "active sessions" UI                                                                                                                                                                                                                                                                                                             |

### 10.3 Performance

- **Leaderboard cache (Tier 5.2)**: `GET /api/leaderboard` reads through [lib/leaderboardCache.js](lib/leaderboardCache.js) — a 30 s in-process TTL Map. Sort and pagination layer on top of the cached array, so a single cache entry serves all `orderBy`/`offset`/`limit` combinations. See §8.14 for the invalidation policy. The underlying `buildUserSummary` / `buildGroupLeaderboard` are still O(users × picks) on a miss — caching just bounds the cost to once per 30 s per scope.
- **Profile endpoint**: not cached. Similar shape to leaderboard but bounded to a single user; a Tier 5 follow-up candidate if profile views become hot.
- **N+1 elimination (Tier 5.7)**: `getGroupsForUser` and `getGroupById` now use Sequelize `include: [{model: User}]` to batch-load member usernames in a single query. For a user in 3 groups, this dropped 12 queries to 3.
- **No connection pooling tuning**: Sequelize default of max 5 is fine for a single Node process.
- **HTTP compression (Tier 5.6)**: `compression` middleware mounted before static/body parsing. JS bundle compresses ~75 % on the wire; JSON responses under 1 KB are skipped (default threshold).
- **Bundle size**: the production JS bundle is ~485 KB uncompressed, ~120 KB gzipped on the wire. All from React + Tailwind + business code; future code-splitting (Tier 9.5) could split the admin and profile-drawer trees into separate chunks.

### 10.4 Accessibility (Tier 2 floor + Tier 11 Chunk 4)

**Established floor**:

- Every form input has a matching `<label htmlFor=...>` or `aria-label`.
- All interactive elements have `focus-visible:ring-2 focus-visible:ring-accent` (token-driven; works in both themes).
- Sidebar items render `<button role="tab">` with accessible name `<kicker> <label>` so screen readers + Playwright's `getByRole('tab', { name: /…/ })` resolve regardless of sidebar collapse state.
- The status toast uses `role="status" aria-live="polite"`.
- The dashboard root has `aria-busy={loading}` during initial fetch.
- Modal dialogs use Radix's `<Dialog>` primitive — focus trap, Esc-to-close, return-focus, scrim, `aria-modal`/`aria-labelledby` wiring all handled by the primitive.
- Comment `role="alert"` for inline form errors (e.g. TwoFactor challenge mismatch) ensures NVDA/JAWS announce on input.

**Tier 11 Chunk 4 additions**:

- **Skip-to-content link** in `<App>` (visible on focus, target `#main`). Lets keyboard-only users skip past the sidebar.
- **`<nav aria-label="Primary navigation">`** wrapping the Sidebar's tablist.
- **`<main id="main">`** landmarks on DashboardView / AuthView / SkeletonView.
- **`useReducedMotion()`** in [src/lib/a11y.js](src/lib/a11y.js) → consumed by `OnboardingTour` to skip its animation when the OS requests reduced motion. New motion-heavy components should consume this too.
- **`useFocusOnRouteChange()`** — moves focus to the new `<main>` heading on view switches so screen-reader users hear which tab they're on.
- **iOS Safari 16 px form-input minimum** ([src/index.css](src/index.css)) — every editable form field has `font-size: 16px !important` at `<` 768 px so tapping search/login/comment/admin inputs no longer auto-zooms the viewport and leaves it stuck zoomed after blur. Desktop unaffected (`text-sm` utilities win at `>= 768px`).
- **Public a11y statement** at [ACCESSIBILITY.md](ACCESSIBILITY.md) — documents WCAG 2.1 AA targets + known gaps.

**Known gaps**:

- No exhaustive keyboard audit of every modal stack (ConfirmModal-over-Sidebar-drawer covered; less-common stacks not).
- Skeleton loading states don't announce themselves to screen readers (would need `aria-live` regions on skeleton mount).
- No formal WCAG color-contrast audit; tokens pass at-a-glance (cyan-on-slate dark-mode + cyan-on-white light-mode all clear 4.5:1) but no scripted check yet.
- No automated a11y in CI (e.g. `@axe-core/playwright`).

### 10.5 Observability (Tier 5.4 + 5.4b)

- **Structured logging**: all backend logs go through pino via [lib/logger.js](lib/logger.js). JSON in production, `pino-pretty` colored output in development. Log level controlled by `LOG_LEVEL` env (`debug` in dev, `info` in prod by default).
- **Request correlation**: [middleware/requestId.js](middleware/requestId.js) assigns `req.id` (UUID v4 or honored inbound `X-Request-Id`), echoes it back on the response, and attaches `req.log = logger.child({reqId})`. Every handler error log line carries the `reqId`, so a client error can be traced back to the exact request.
- **Access log**: `pino-http` emits one structured line per request (`req`, `res`, `responseTime`). `customLogLevel` maps `>=500` to `error` and `>=400` to `warn`, so warn/error filters surface the bad requests automatically.
- **Client-error pipeline (Tier 5.4b)**: see §6.7. Browser failures of any kind flow to `POST /api/client-errors`, get a `req.log.error` line on the server side, and (if `SENTRY_DSN`/`VITE_SENTRY_DSN` are set) also flow into Sentry. The browser sends along the most recent server-side `reqId` it observed via `X-Request-Id`, so each client error can be tied back to the exact server request that rendered the failing page.
- **Sentry (Tier 5.4b)**: opt-in via env. When unset, both server and browser ship without Sentry overhead (server-side `lib/sentry.js` exports no-ops; client-side Vite tree-shakes the dynamic `@sentry/react` import). When set, server uses `@sentry/node` with OpenTelemetry instrumentation (initialized in [lib/instrument.js](lib/instrument.js) _before_ Express is required); browser uses `@sentry/react` with its own window listeners + the ErrorBoundary's explicit `captureException` calls.
- **Still missing**: no `/metrics` endpoint, no APM beyond Sentry, no log shipping to a managed log aggregator (CloudWatch / Application Insights / Loki). Captured under Tier 10 — Observability & scale in the forward roadmap.

### 10.6 Testing (Tier 5.5 + 5.5b + per-endpoint API suite)

**Playwright E2E** is the only test layer below this. **270 tests across 22 spec files**, ~5 min full-suite runtime.

**UI / flow specs** under [tests/e2e/](tests/e2e/):

| Spec                                                                                                          | Coverage                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pick-and-result.spec.js`                                                                                     | register → pick → admin set result → leaderboard updates                                                                                                                                                                           |
| `group-lifecycle.spec.js`                                                                                     | create → invite → accept → transfer → delete                                                                                                                                                                                       |
| `comment-reaction.spec.js`                                                                                    | post → edit → react → delete                                                                                                                                                                                                       |
| `auth-security.spec.js` (Tier 5.5b)                                                                           | Lockout + password reset cascade + CSRF reject                                                                                                                                                                                     |
| `friend-system.spec.js`, `notifications-badges.spec.js`, `leaderboard-scoring.spec.js`, `admin-panel.spec.js` | Tier 5.5b — friend lifecycle / unread count + badge unlocks / probability-weighted scoring across 50/50, 60/40, 40/60 odds with cache invalidation / admin GameManager CRUD + UserManager bulk role flip + Tier 5.3 cascade delete |
| `profile-privacy.spec.js` (Tier 8.6)                                                                          | 5 invariants — friends-only non-friend → 404, friends-only friend → full payload, private non-admin → 404, private admin → full payload, leaderboard masking by viewer relationship                                                |
| `change-email-panel.spec.js`, `change-password-panel.spec.js`                                                 | Security-hardening batch — UI smokes for the two new in-session credential-change panels                                                                                                                                           |
| `screenshots/mobile.spec.js`                                                                                  | Visual regression                                                                                                                                                                                                                  |

**Per-endpoint boundary suite** under [tests/e2e/api/](tests/e2e/api/) — one spec file per `routes/*.js`. ~250 tests covering happy path + auth-required 401 + admin-required 403 + CSRF-required 403 + zod-validation 400 + ownership 403/404 + missing-id 404 for every one of the 68 HTTP endpoints. Includes `auth.spec.js`, `me.spec.js`, `games.spec.js`, `picks.spec.js`, `comments.spec.js`, `groups.spec.js`, `friends.spec.js`, `leaderboard.spec.js`, `notifications.spec.js`, `users.spec.js`, `leagues.spec.js`, `admin.spec.js` (largest — 14 endpoints × ~5 cases), `client-errors.spec.js`, `health.spec.js`.

**Shared helpers** ([tests/e2e/helpers/](tests/e2e/helpers/)):

- `auth.js` — UI `loginViaUI` / `registerViaUI` / `logoutViaUI` + `dismissLanding` / `dismissOnboardingTour`.
- `api.js` — `apiLogin(user)` → APIRequestContext auto-carries `sc_access`/`sc_refresh`/`sc_csrf` cookies + pre-sets `X-CSRF-Token`. Also `apiAnon()` (bare context), `stripCsrf(ctx)` (drops the CSRF header for assertion negatives). DB helpers: `clearPicksAndBadges`, `clearFriendships`, `resetUserLockout`, `insertPasswordResetToken`, `clearComments`, `clearGroupsCreatedBy`, `clearLeaguesByName`, `clearAuditLog`, `clearNotifications`, `clearGameResults`, `getUserId`, `deleteUserByUsername`, `clear2faForUser`, `setUserPassword`, `updateUserFields`.
- `apiAssertions.js` (security-batch follow-on) — `assertOk` / `assertUnauthorized` / `assertForbiddenWithoutAdmin` / `assertCsrfRejected` / `assertValidationError` / `assertNotFound` / `assertNoContent` / `expectShape`. Collapses per-test boilerplate from ~15 lines to 1.
- `selectors.js` — `closestCard` etc.
- `admin.js` — `openAdminTab`.

**Test environment**:

- Runs against `npm run build && node server.js` on `:3100` with `NODE_ENV=test`.
- `workers: 1` (shares Sequelize pool across specs).
- `globalSetup` syncs the schema, applies migrations, truncates + reseeds three deterministic users (`e2e_admin`, `e2e_alice`, `e2e_bob`) and three upcoming games per run. Seed users ship with `onboardingCompletedAt: now` so the tour doesn't block existing flows.
- **Specs MUST NOT call `closeDb()` in `afterAll`** — `workers:1` means the `require('models')` Sequelize pool is shared; closing it stalls every later spec.
- Each spec resets only the state it touches via the DB helpers so order across the file doesn't matter.
- Rate limiters are skipped when `NODE_ENV=test` (`skipInTest` predicate in `middleware/rateLimit.js`) so the suite doesn't 429 itself.

**CI integration**: [.github/workflows/ci.yml](.github/workflows/ci.yml) runs the full suite on every PR. Cached Chromium, Postgres service, HTML report + traces uploaded on failure.

**Pre-CSRF-middleware ordering insight**: in the API suite, `assertUnauthorized` seeds an `sc_csrf` cookie via a throwaway GET before the actual assertion call. State-changing routes' auth boundary then lands on `authMiddleware` (401) instead of being absorbed by CSRF (403) — the assertion catches the right layer.

---

## 11. Operational Notes

### 11.1 Environment Variables

See [.env.example](.env.example):

- **`JWT_SECRET`** — must be set in production; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Server refuses to start in `NODE_ENV=production` without it.
- **`CORS_ORIGINS`** — (Tier 6.1) comma-separated allowlist of origins permitted with `credentials: true`. **Required in production** — server throws on boot when empty. In dev, falls back to `origin: true`. Example: `CORS_ORIGINS=https://scorecast.com,https://www.scorecast.com`.
- **`DATABASE_URL`** — Postgres connection string. Optional; defaults to `postgres://postgres:postgres@localhost/scorecast_db` (see [config/database.js](config/database.js)).
- **`PORT`** — defaults to 3000.
- **`NODE_ENV`** — `development` or `production`. Gates JWT_SECRET + CORS_ORIGINS enforcement, logger format (pretty vs JSON), cookie `Secure` flag, and migration auto-run behavior.
- **`LOG_LEVEL`** — (Tier 5.4) pino level. Defaults to `debug` in dev and `info` in prod. Values: `fatal | error | warn | info | debug | trace | silent`.
- **`MIGRATE_ON_BOOT`** — (Tier 5.1) `'true'` to apply pending migrations on server boot in production. Default off — production should run `npm run db:migrate` as an explicit deploy step. No effect in development (always auto-migrates).
- **`SENTRY_DSN`** — (Tier 5.4b) Sentry server-side DSN. When unset, [lib/instrument.js](lib/instrument.js) skips Sentry init and [lib/sentry.js](lib/sentry.js) exports no-ops. When set, `@sentry/node` initializes at boot (before Express) and `setupExpressErrorHandler(app)` reports any `next(err)`-propagated error.
- **`VITE_SENTRY_DSN`** — (Tier 5.4b) Sentry browser DSN. Read at **Vite build time**, not runtime — any change requires `npm run build`. When unset, Vite dead-code-eliminates the dynamic `@sentry/react` import (verified zero bytes added to the bundle). When set, `initSentry()` in [src/lib/sentry.js](src/lib/sentry.js) loads the SDK and calls `Sentry.init(...)` on app startup.
- **`RESEND_API_KEY`** — (Tier 6.3) Resend API key for outbound email (verification, password reset). When unset, [lib/email.js](lib/email.js) falls back to log-only mode (emits the rendered payload via pino instead of dispatching). Get one at resend.com; free tier covers 100/day, 3k/month.
- **`EMAIL_FROM`** — (Tier 6.3) `From:` header on outbound mail. Defaults to `ScoreCast <onboarding@resend.dev>` (Resend's sandbox sender, deliverable only to the account's signup email). For real users, point at a domain you've verified in Resend.
- **`PUBLIC_APP_URL`** — (Tier 6.3) base URL baked into outbound email links (`${PUBLIC_APP_URL}/?verifyToken=…` and `${PUBLIC_APP_URL}/?resetToken=…`). Defaults to `http://localhost:${PORT}` so dev works without setup; set to `http://localhost:5173` for Vite-dev testing, or your deployed URL in prod.
- **`FOOTBALL_DATA_API_KEY`** — (Tier 4b) football-data.org v4 API key. All three cron jobs ([syncFixtures](lib/jobs/syncFixtures.js), [syncLiveScores](lib/jobs/syncLiveScores.js), [reconcileInProgressGames](lib/jobs/reconcileInProgressGames.js)) early-return silently when unset, so dev without a key sees no errors but also no upstream data. Manual admin sync also requires it.
- **`FOOTBALL_DATA_API_HOST`** — (Tier 4b) override for the upstream host. Defaults to `api.football-data.org`. Useful for testing against a recorded-response proxy.
- **`FOOTBALL_DATA_RATE_LIMIT`** — (Tier 18) integer override for the in-process rate-limit budget. Defaults to `20` (TIER_ONE plan). Set to `10` if reverting to the free tier; bump if upgrading further. The client always reserves 1 slot for ad-hoc admin syncs regardless of budget.
- **`FIXTURE_SYNC_CRON` / `LIVE_SCORE_SYNC_CRON` / `IN_PROGRESS_RECONCILE_CRON`** — (Tier 4b + 2026-05-19 + Tier 18) cron expression overrides for the three football-data jobs. Defaults: `'0 3 * * *'` daily, `'*/30 * * * * *'` every 30 s (Tier 18 — was `'* * * * *'` every minute), `'*/3 * * * *'` every 3 min (Tier 18 — was `'*/5 * * * *'`). Use `node-cron` 6-field syntax (with leading seconds field) for sub-minute cadence. Useful for dev rapid iteration, falling back to free-tier cadence, or incident-response bumps.
- **`KICKOFF_REMINDER_CRON`** — (PWA Chunk 6) cron expression for the kickoff-reminder fan-out job. Default `'*/15 * * * *'`. DB-only; no API calls.

### 11.2 Local Setup

```bash
# 1. Install Postgres locally; create the scorecast_db database
createdb scorecast_db

# 2. Copy env template
cp .env.example .env
# Edit .env: set JWT_SECRET (a random string is fine in dev)

# 3. Install dependencies
npm install

# 4. Run backend on port 3000 (terminal 1)
node server.js

# 5. Run Vite dev server on port 5173 (terminal 2)
npm run dev
# Open http://localhost:5173 — Vite proxies /api/* to localhost:3000
```

On first boot, [data.json](data.json) is seeded into an empty `users` table. Seed users:

- `vo123` / `password123` — admin
- `alice` / `secret` — user
- `bob` / `secret` — user

### 11.3 Production Build

```bash
npm run db:migrate  # apply pending migrations (idempotent against existing DBs)
npm run build       # vite build → dist/
node server.js      # serves dist/ + /api on the same port (does NOT auto-migrate in prod)
```

Or in one go: `npm start` (= `vite build && node server.js`). For production it's recommended to run `npm run db:migrate` separately before starting the server, or set `MIGRATE_ON_BOOT=true` to auto-apply on boot.

### 11.4 Common Gotchas

1. **Route shadowing**: `/api/groups/discover` must stay registered before `/api/groups/:groupId`. Same for any future `/api/groups/<literal>` routes.
2. **Scoring duplication**: edits to `scorePick` in [server.js](server.js) must be mirrored in [src/utils/scoring.js](src/utils/scoring.js) (and vice versa) in the same commit.
3. **Migration framework (Tier 5.1)**: **never** add raw DDL back into `runMigrations()` — it's a thin umzug shim now. Add a new file under `migrations/` via `npx sequelize-cli migration:generate --name <name>`. Make `up` statements idempotent (`IF NOT EXISTS`, `DO $$ EXCEPTION` blocks) so they're safe to apply against DBs that pre-existed the framework.
4. **Notification side-effects on result-set**: when modifying `POST /api/games/:gameId/result`, `POST /api/admin/games/bulk` (setResult action), or any endpoint that resolves picks, you must keep the `notify` + `evaluateBadges` loop intact, otherwise users stop getting feedback.
5. **Self-protection guards**: the admin self-demote/self-delete checks compare on `req.user.id` (UUID string from the JWT). The bulk-user endpoint additionally **silently filters** self out (no error). If you ever change how `req.user` is shaped, audit both paths.
6. **`save({hooks: false})`** is intentional in the role-update endpoint, `PUT /api/me`, the bcrypt backfill seeder, and bulk role flips — without it, Sequelize's `beforeUpdate` hook would attempt to re-hash an already-hashed password.
7. **`pickMap` shape**: the frontend `pickMap` lives in [src/hooks/usePicks.js](src/hooks/usePicks.js) (moved from App.jsx in Tier 13) and stores **full pick objects** (Tier 8.2), not just the `choice` string. Consumers in [GameCard.jsx](src/components/GameCard.jsx) call `usePicks()` and destructure `pickMap.get(game.id)` to `existingChoice` and `existingPickId`. Don't revert to the simpler shape — the undo-pick UX needs the id.
8. **Avatar color stability**: [Avatar.jsx](src/components/Avatar.jsx) hashes on **lowercased `username`**, never `displayName`. If you change this, every existing user's avatar color flips on next render.
9. **Comment reaction emoji palette**: `ALLOWED_EMOJIS` in [validation/schemas.js](validation/schemas.js) and `REACTION_EMOJIS` in [src/components/CommentThread.jsx](src/components/CommentThread.jsx) must stay in sync. Adding an emoji to one without the other yields either a 400 (server rejects) or a stuck UI button (client allows but server rejects on send).
10. **Leaderboard `viewerRow`**: when consuming `GET /api/leaderboard`, the group block's `groupMeta.viewerRow` is the **sorted-row including rank**, not the raw user. The frontend uses it to render the "Your position" anchor when the page window excludes the viewer.
11. **Leaderboard cache invalidation (Tier 5.2)**: any new endpoint that mutates picks, game results, group membership, or deletes users/games must call `leaderboardCache.invalidate('all')` (or a scoped `group:<id>` key) **before** returning, otherwise readers will see stale standings for up to 30 s. The current 11 invalidation sites are listed in §8.14.
12. **Cascade transactions (Tier 5.3)**: `cascadeDeleteUser`, `cascadeDeleteGame`, `cascadeDeleteGroup` accept a `{transaction}` option and forward it to every internal `destroy()`. Callers wrap with `await sequelize.transaction(async (t) => { await cascadeFn(x, {transaction: t}); })`. **Don't move `notify()` calls inside the transaction** — they're synchronous Notification.create calls that should not be rolled back by a cascade failure. Keep notify calls before/after the tx block, never inside.
13. **Logging (Tier 5.4)**: use `req.log.error({err}, 'msg')` inside handlers (never `console.*`). For boot-time code that has no request context, use the top-level `logger` from [lib/logger.js](lib/logger.js). The shape `req.log.error({err: error}, 'handler error')` is conventional and shows up structured in JSON output.
14. **Verifying transaction rollback**: to confirm a new cascade path is genuinely atomic, monkey-patch one of the internal `destroy()` methods to throw and call the endpoint. Verify the parent row + all child rows are intact after the tx exception. See the 5.3 smoke-test recipe in the plan history.
15. **Tier 5.4b — instrument.js ordering**: [lib/instrument.js](lib/instrument.js) **must remain the very first `require()`** in [server.js](server.js), before `dotenv` and before `express`. `@sentry/node` v8+ uses OpenTelemetry instrumentation that needs to wrap Express and Sequelize at import time. Moving this require down even one line silently disables Sentry's auto-instrumentation. The file itself calls `require('dotenv').config()` first so `SENTRY_DSN` is readable; the second `dotenv.config()` later in server.js is idempotent.
16. **Tier 5.4b — VITE_SENTRY_DSN is build-time**: changing `VITE_SENTRY_DSN` in `.env` does nothing until you rebuild (`npm run build`) and the browser reloads the new bundle. Vite substitutes the value at build time. `SENTRY_DSN` (server) is read at process start so a server restart picks it up live.
17. **Tier 5.4b — never `console.*` in new client code either**: window-level errors are already captured by `clientErrorReporter`. If you `console.error(...)` in client code to "log something," that line never reaches the server and never reaches Sentry. Call `reportClientError({message, level: 'warn' | 'error'})` from [src/lib/clientErrorReporter.js](src/lib/clientErrorReporter.js) instead.
18. **Tier 5.4b — ErrorBoundary raw-message gate**: the boundary renders `this.state.message` (which can include sensitive details from the thrown error) **only** under `import.meta.env.DEV`. Do not remove the gate. If you need to surface a friendlier message in prod, set a separate state field with the curated text.
19. **Tier 6.1 — CORS_ORIGINS production throw**: `CORS_ORIGINS` empty + `NODE_ENV=production` makes the server **refuse to boot**. Same pattern as `JWT_SECRET`. In dev with `CORS_ORIGINS` unset, falls back to permissive `origin: true` so the Vite dev server keeps working. Don't quietly add a production fallback to `origin: true` — the failure-loud behavior is the whole point.
20. **Tier 6.2 — CSP and Vite HMR**: helmet's CSP `connectSrc` includes `ws://localhost:5173, http://localhost:5173` **only when `NODE_ENV !== 'production'`** so HMR works in dev. If you change `connectSrc` for any reason (e.g., to allow a new third-party host), keep the dev-only HMR entry, or you'll see "Refused to connect" errors in the browser console and HMR will silently fail.
21. **Tier 6.6 — Lockout response generic-401 invariant**: locked accounts return exactly the same `401 {error: 'Invalid credentials'}` body and status as wrong-password and unknown-user. Don't add "Account is locked" messages anywhere user-visible — that's a username-enumeration leak. The lock is observable internally via `users.lockedUntil` and via the access logs.
22. **Tier 6.7 — CSRF EXEMPT_PATHS additions**: when adding a state-changing endpoint that runs **before** the user has a session (login, register-time, email-link landing pages), you must add the path to `EXEMPT_PATHS` in [middleware/csrf.js](middleware/csrf.js) or callers will get blanket 403. The current exemption list covers all pre-auth and anonymous mutation endpoints — adding more in the same category is fine; adding any **post-auth** endpoint to the list is a security mistake.
23. **Tier 6.8 — Cookie auth + frontend `useRequest()` refresh-retry**: `useRequest()` retries a 401 exactly once after `POST /api/auth/refresh`. It exempts `/api/auth/*` paths so refresh can't recurse on itself. **Don't add another retry layer at a caller** — if the post-refresh attempt still 401s, the user is genuinely logged out and we want to fall through to `clearSession` (which flips `AuthContext.user` to null; `DataContext` then auto-wipes its slots via the `user → null` effect). Wrapping calls in retry loops would mask that.
24. **Tier 6.8 — Bearer-header clean break**: `authMiddleware` reads `req.cookies.sc_access` only. If you're tempted to "support both" again for backwards compatibility (e.g., during a migration window), don't — the original `localStorage.scorecastToken` from before Tier 6 was invalidated client-side at deploy time. Adding bearer-header support back would re-expose the XSS-readable-session attack surface.
25. **Tier 6.8 — `Path=/api/auth` on refresh cookie**: `sc_refresh` is path-scoped so it isn't sent on `/api/picks`, `/api/me`, etc. Don't bring it back to `Path=/` — the whole point is that the high-value cookie is only exposed on the (small) auth endpoint surface. Same logic for `sc_challenge`.
26. **Tier 6.8 — Multi-device login semantics**: `/api/login` does NOT revoke prior refresh tokens. Multiple devices can be logged in simultaneously, each with its own active refresh chain. Only `/api/auth/logout` (current device) and `/api/auth/reset-password` (all devices) revoke. If you ever add "sign out all devices" UI, call `revokeAllUserRefreshTokens(userId)`.
27. **Tier 6.5 — Login response shape on 2FA-enabled users**: returns `{challenge: true}` instead of `{user}`. Frontend (`handleLogin`) must branch on this before calling `setUser`. Don't try to "fix" the inconsistency — that's the only signal the client gets before the 2FA challenge.
28. **Tier 6.9 — Recovery codes are one-shot**: once shown at setup, they cannot be re-displayed. The DB only has bcrypt hashes. Don't add an endpoint that "shows the codes again" — that requires storing them in plaintext, which defeats the whole pattern. Users who lose their codes must disable + re-enable 2FA to regenerate.
29. **Tier 6.9 — `users.totpEnabledAt` is the source of truth**: `totpSecret` may be populated without `totpEnabledAt` (= pending-but-unconfirmed setup). The login flow checks `totpEnabledAt`, not `totpSecret`. Don't gate behavior on `totpSecret` alone.
30. **Tier 6.4 — `forgot-password` is always 204**: regardless of whether the email exists, is verified, or has a recently-issued token. The shape difference between "email exists" and "doesn't" is **only** in whether a server-side email-send log line appears. Don't ever return a different status or body for the existence case — that's the classic user-enumeration leak.
31. **Tier 6.3 — `lib/email.send()` never throws**: failures log and return `{delivered: false, ...}`. Callers should treat email as best-effort. **Don't wrap email calls in transactions that depend on send success** — emails are not transactional and never will be. The flow is always: do the DB work first, then dispatch the email after-the-fact.
32. **Tier 11 — Design tokens are mandatory in `src/components/**`**: never use raw `slate-_`/`cyan-_`/`text-white`/`bg-gray-\*`Tailwind literals — they bypass the light-mode override in`:root[data-theme='light']` and look broken in the inverse theme. Use semantic tokens (`bg-base`, `bg-elevated`, `text-fg`, `text-accent`, `border-default`, etc.). No lint rule enforces this yet; review for it.
33. **Tier 11 — Modal stacking + sidebar drawer Escape**: ConfirmModal + SignInModal + ProfileDrawer + OnboardingTour all `z-50`. When a modal opens on top of the mobile sidebar drawer, the drawer's Escape handler is guarded by `drawerRef.contains(document.activeElement)` so Escape closes the modal first. **Don't add a global `keydown` Escape listener that closes the drawer unconditionally** — it will steal Escape from any modal stacked above.
34. **Tier 11 — Theme is applied synchronously before React mounts**: [src/main.jsx](src/main.jsx) calls `applyTheme(getStoredTheme())` BEFORE `ReactDOM.createRoot().render(...)`. If you ever push theming into a hook that runs after mount, you'll re-introduce the FOUC. Same for SSR if it ever lands — apply theme in the document head.
35. **Tier 11 — Sidebar tab buttons MUST keep `role="tab"`**: existing Playwright suites locate sidebar items via `page.getByRole('tab', { name: /…/ })`. Switching to `role="link"` or removing the role would break every flow spec that opens a tab.
36. **Anonymous browse — Sidebar item filter**: [src/components/Sidebar.jsx](src/components/Sidebar.jsx) filters items to Games/Groups/Rankings for `user === null`. Don't accidentally render My Picks / Profile / Admin for anon viewers — those rely on authed `useData` slots.
37. **Anonymous browse — `loadAnonDashboard` is a SEPARATE fetch path**: on boot, `DataProvider` tries `loadDashboard()` first; on 401 with `browseAsGuest=true`, it falls through to `loadAnonDashboard()` (parallel fetch of just the public endpoints). Don't conflate the two — the authed path expects `/api/me` + `/api/picks` + `/api/friends` etc. which will 401 for anon.
38. **Anonymous browse — public-read endpoints MUST use `optionalAuth`, not `authMiddleware`**: getting this wrong is a 401 for everyone or an auth bypass. The 7 public-read paths are listed in §8.19. Their write counterparts (POST/PUT/PATCH/DELETE) stay on `authMiddleware`.
39. **Tier 8.6 — `profileVisibility` change invalidates the leaderboard cache**: `PUT /api/me` calls `LeaderboardService.invalidate('all')` when `displayName` OR `profileVisibility` actually changes (not on every put). Without this, the masking layer would project against stale visibility for up to 30 s. **If you add another user-row column that the leaderboard surfaces, add it to the invalidation predicate**.
40. **Tier 8.6 — Identical 404 for friends-gated and private**: distinguishing them via different status codes or error messages is a friend-graph leak. Keep both at `errors.notFound()` from `lib/errors.js`. Admin override applies the same — admins always see unmasked + full profiles regardless.
41. **Draw scoring — pick semantics are still winner-only**: `pick.choice` is `'home' | 'away'` only; there is no "pick the draw" option. The `'draw'` result enum value just awards partial credit instead of zero. Strict `winRate` semantic preserved — picks where `choice === result` literally (so draws never count as wins regardless of partial-credit points awarded). The migration does NOT backfill historical `result=null + status='finished'` games to `'draw'` — that would retroactively reshuffle the leaderboard.
42. **Draw scoring — scoring formula has THREE branches**: `home/away` (winner gets `(1 - winning_probability) × 100`), `draw` (winning side proportional pay × `drawProbability × opposite_team_prob / (home_prob + away_prob) × 100`), and `null` (no payout yet). Both [lib/scoring.js](lib/scoring.js) and [src/utils/scoring.js](src/utils/scoring.js) MUST mirror all three branches in the same commit.
43. **Draw scoring — `expectedDrawPoints` returns `null` for unconfigured games**: when `drawProbability ≤ 0` (the post-migration default for fresh games), `expectedDrawPoints` returns `null` so `PayoutMatrix` renders `+x` / `+y` placeholders rather than misleading `+0`. Until ML or admin writes a non-zero `drawProbability`, the Draw row is visibly "pending" rather than "literal zero".
44. **Draw scoring — `ScoreboardBody.winningSide` is narrowed to `'home' | 'away'`**: a `'draw'` result leaves both team boxes un-dimmed (no green ring on either side). The outcome badge / locked-pick chip carry the "Drew +N pts" framing. Don't let `'draw'` leak into `winningSide` — that branches the layout in surprising ways.
45. **Tier 4b — `lib/fixtureStatus.js` is the SINGLE source of truth for status/result mapping**: both `LeagueService.upsertFixture` (manual + daily sync) and `GameService.applyLiveUpdate` (60-s live poll) import from here so they can never drift. New provider mappings go in `STATUS_MAP`; if you swap providers via [lib/footballApi.js](lib/footballApi.js), update this file in the same commit.
46. **Tier 4b — Live-score reconcile pass is load-bearing**: the live-score job polls `?status=LIVE,IN_PLAY,PAUSED`, but matches transition off that filter between ticks. The reconcile pass at the bottom of [lib/jobs/syncLiveScores.js](lib/jobs/syncLiveScores.js) batch-fetches via `getMatchesByIds()` to fix (1) `status='in-progress'` locally + missing from LIVE → caught IN_PLAY → FINISHED, (2) `status='scheduled'` locally + kickoff > 15 min ago → caught SCHEDULED → IN_PLAY missed during downtime. **Don't remove it** — without it, finished matches stay stale until the next daily sync.
47. **`reconcileInProgressGames` (5-min defensive job) is also load-bearing** (post-2026-05-19 incident — see §8.22 postmortem): closes the upstream-`?status=`-filter-staleness gap that the 1-min reconcile can't address. Sweeps every local `status='in-progress'` game via `?ids=` regardless of LIVE-filter membership, every 5 min. Schedule overridable via `IN_PROGRESS_RECONCILE_CRON` env. **Don't remove or de-frequency** without a paid-tier provider swap — without it, a stuck live game silently blocks pick scoring + leaderboard updates for everyone holding picks on it, for up to several hours.
48. **`applyLiveUpdate` requires `SELECT ... FOR UPDATE`**: the 1-min and 5-min jobs race on the same row at xx:00 / xx:05 alignments. `applyLiveUpdate` re-fetches the game inside the transaction under a row lock so a concurrent call observes the first transaction's committed writes, NOT the caller's stale `localGame` snapshot. **Don't refactor to use the caller's `localGame` for save** — that reopens the window where two concurrent saves with stale snapshots can overwrite each other (e.g. 5-min job sets FINISHED+result, 1-min job then regresses to in-progress on its stale view, wiping the result).
49. **`applyLiveUpdate` finished-status guard**: once `fresh.status === 'finished'`, any `apiMatch.status` other than `'FINISHED'` or `'AWARDED'` is treated as a stale upstream snapshot and ignored. Logs `applyLiveUpdate: ignored stale non-FINISHED upstream snapshot for already-finished game`. **Don't widen** the guard to accept other apiMatch.status values — letting stale LIVE/IN_PLAY/PAUSED snapshots through would re-introduce the 2026-05-19 regression vector. **Do leave FINISHED/AWARDED allowed through** — those are legitimate score corrections / replay re-finalizes and should propagate.
50. **Tier 4b — football-data.org rejects repeated `?status=X&status=Y`**: wants comma-separated `?status=X,Y,Z`. [lib/footballApi.js](lib/footballApi.js) `getLiveMatches()` uses the comma form; switching back to repeated params is a 400.
51. **Tier 4b — `games.leagueId NOT NULL`**: enforced by [migration 20260518000007-games-tighten-league-not-null.js](migrations/20260518000007-games-tighten-league-not-null.js). New games created via admin must always have a `leagueId`. The legacy "synthetic Legacy / Imported league" catches the case where admin forgets, but the schema requires it.
52. **Tier 4b Chunk 3 — `auditMutation(...)` ordering**: wrap routes BEFORE `validate(...)` so the audit trail captures the raw inbound payload (not the zod-coerced version). Action strings use the dotted shape `admin.<entity>.<verb>` — keep the prefix consistent so the audit-log UI can filter cleanly. Auth-failed admin attempts (401/403 thrown before `auditMutation` runs) are NOT audited by design.
53. **Tier 4b Chunk 3 — Audit log `actorUserId` SET NULL on user delete**: history survives admin removal. **Don't change to CASCADE** — losing audit history when admins leave defeats the whole point.
54. **Tier 4b Chunk 3 — `audit_log` payload truncation is 4KB**: [services/AuditLogService.js](services/AuditLogService.js) `truncatePayload()` replaces oversize payloads with `{_truncated: true, _bytes, preview: 'first 512 chars'}`. The middleware fires via `res.on('finish')` and **NEVER throws back into the request lifecycle** — an audit-log outage cannot block a real admin action.
55. **Security batch H1 — `app.set('trust proxy', 1)`**: critical for per-IP rate limiters and lockout to see real client IPs through Cloudflare → Azure Container Apps. **Don't switch to `app.set('trust proxy', true)`** — that trusts every hop in `X-Forwarded-For`, letting an attacker spoof an arbitrary IP. The `1` means "trust one hop" (the Azure ingress).
56. **Security batch H2 — `LOGIN_DUMMY_HASH` is generated once at module load**: the constant-time login path runs `bcrypt.compare` against the real user hash OR the dummy hash. If you ever inline-generate the dummy hash inside the request handler, you reintroduce the timing leak. Same module-load constant pattern would apply to any future "constant-time check" use case.
57. **Security batch M4 — `algorithms: ['HS256']` pinning**: every `jwt.verify` call site MUST pass the algorithm allowlist (`middleware/auth.js`, `middleware/optionalAuth.js`, `routes/auth.js` for 2FA challenge, `routes/client-errors.js`). jsonwebtoken@9 already rejects `alg:none` by default, but pinning is belt-and-braces against future regression.
58. **Security batch L5 — Recovery code verify is constant-time**: `Promise.all(codes.map(bcrypt.compare))` instead of an early-exit `for` loop. **Don't "optimize" to early-exit** — the matched slot would become inferrable from response time.
59. **Per-endpoint API suite — `closeDb()` in afterAll**: spec files MUST NOT call `closeDb()` in `afterAll`. `workers:1` shares the Sequelize pool; closing it stalls every later spec. Each spec only resets the tables it touches via DB helpers in [tests/e2e/helpers/api.js](tests/e2e/helpers/api.js).
60. **Per-endpoint API suite — Seed CSRF cookie before assertUnauthorized**: `assertUnauthorized` for state-changing routes must seed an `sc_csrf` cookie via a throwaway GET first; otherwise the assertion lands on CSRF (403) rather than auth (401). The helper handles this internally — `apiAnon()` returns a context that already has the cookie set.
61. **Tier 18 Chunk 5 — `comments` scope is single-valued**: the DB CHECK constraint `comments_one_scope_chk` enforces exactly one of `gameId` / `groupId` is non-null per row. Both `CommentService.list` and `CommentService.create` call `assertSingleScope({gameId, groupId})` first so a programmer error surfaces as a recognizable 400. **Do not write to both columns** — Postgres will reject the INSERT.
62. **Tier 18 Chunk 5 — Group-comment write is member-only by design**: `CommentService.create` for a `groupId` scope rejects non-members with 403 even on public groups. Anon read of a public group's comments is intentional (mirrors the rest of public-group surface); write requires membership. Don't loosen the write side without a product decision.
63. **Tier 18 Chunk 5 — Private-group comment GET returns 404**: `assertReadable` in [routes/groups.js](routes/groups.js) returns 404 (not 403) for non-members of a private group's `/comments`. Mirrors `GroupService.getVisible` — distinguishing "private exists" from "doesn't exist" is a group-graph leak vector.
64. **Tier 18 Chunk 5 — `group-comment` push type is in TWO places**: `PUSH_NOTIFICATION_TYPES` in [validation/schemas.js](validation/schemas.js) AND `NOTIFICATION_TYPES` in [src/components/PushSettingsPanel.jsx](src/components/PushSettingsPanel.jsx). Same dual-update rule as every other push type. The `fanOutGroupComment` consumer reads the user's `pushPreferences[type]` via PushService — absent key OR `true` means deliver; only explicit `false` opts out.
65. **Tier 18 Chunk 6a — Notification `link` convention**: every `NotificationService.notify(userId, type, title, body, link)` call site MUST populate `link` (see §6.2 table for the per-type convention). Without a link, the SW's `notificationclick` opens `/` and the user lands on the dashboard instead of the relevant context. The deep-link consumer in `DataContext.consumeDeepLinks` only recognizes `?view=`, `?gameId=`, `?groupId=` — new param families need to be added there too.
66. **Tier 18 Chunk 6a — Deep-link consumer + `scorecast:url-changed` event bridge**: `consumeDeepLinks` runs ONCE between data-load and bootDone for cold loads — `GamesCalendar` reads `?date=` from the URL via `useState` initializer on its first mount. Tier 20 follow-up: after `consumeDeepLinks` rewrites the URL via `history.replaceState`, it dispatches a `scorecast:url-changed` `CustomEvent` on `window`. GamesCalendar's listener re-reads `?date=` and snaps `selectedKey` + `windowIndex` so in-app navigation (search tap, in-app bell click) updates the mounted component — pushState/replaceState don't fire `popstate` so this is the only signal that wakes a mounted reader. **Generic event name on purpose** — any future component whose state derives from URL params and persists across in-app navigation must subscribe to this event rather than relying on the once-only `useState` initializer.
67. **Tier 18 Chunk 6b — `wasHandled` flag is the contract**: `useRequest` sets `err.wasHandled = true` on EVERY 4xx response. `clientErrorReporter.reportClientError` short-circuits on the flag — skips both the DOM event AND the server-side POST. If you add another error path that produces a user-facing message, set the flag too so the generic "Something went wrong" toast doesn't clobber the real message. **Don't remove the defense-in-depth check** in `NotificationContext`'s event listener — it catches the edge case of unhandled rejections that still carry the flag.
68. **Tier 18 Chunk 6b — AuthView swallows login + register rejections**: both `handleLogin` and `handleRegister` in [src/views/AuthView.jsx](src/views/AuthView.jsx) wrap the AuthContext call in try/catch. The catch is empty (intentionally) because AuthContext already surfaced the message via `showStatus`. The re-throw must not bubble or `clientErrorReporter`'s unhandled-rejection listener fires the generic toast. **If you ever stop re-throwing in AuthContext**, the AuthView catches become dead code — fine to remove, but in lockstep.
69. **Tier 18 Chunk 6c — Legal pages MUST bypass everything**: `App.jsx`'s pathname short-circuit runs BEFORE the `bootDone` check and the auth view switch. Anon + authed users see the same `/terms`, `/privacy`, `/copyright`, `/cookies` content with no auth gate and no skeleton wait. If you ever move the short-circuit below the boot/auth logic, you'll re-introduce a flash of unauthenticated chrome before the legal copy renders.
70. **Tier 18 Chunk 6c — Legal copy stays plain-English**: do NOT add specific cookie names, exact retention windows, named sub-processors, or specific security mechanism names to the legal pages. The trim is deliberate to minimize attack-surface disclosure. The previous (verbose) versions exist in git history if a DPA inquiry ever requires that level of detail in a direct response.
71. **Tier 18 Chunk 6c — `CURRENT_TERMS_VERSION` lives in TWO places**: [validation/schemas.js](validation/schemas.js) (server) and [src/lib/terms.js](src/lib/terms.js) (client). They MUST stay in sync — the server validates `registerSchema` and `acceptTermsSchema` against the server-side value; bumping only the client triggers 400s on every registration. Bump BOTH in the same commit.
72. **Tier 18 Chunk 6c — Stamp `termsAcceptedAt` + `termsAcceptedVersion` on registration**: `routes/auth.js POST /api/register` stamps both fields on `User.create`. Without this, every new user would see the blocking modal on their first dashboard load — which is a confusing UX (they just accepted via the checkbox seconds ago). The `registerSchema` requires `acceptedTerms: literal(true)` so the consent capture is server-validated; the route just records what was already validated.
73. **Tier 18 Chunk 6c — Blocking modal is BLOCKING**: `TermsAcceptanceModal` preventDefaults `onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside`, and uses a no-op `onOpenChange`. Two actions only: Accept or Sign out. **Don't add a "remind me later" option** — that defeats the consent-capture contract. **Don't soften** any of the preventDefaults — Radix Dialog defaults would otherwise let users dismiss the modal without accepting.
74. **Tier 18 Chunk 6c — Pre-accept terms for seed users (post-Tier-20 — version 2)**: [tests/e2e/fixtures/seed.js](tests/e2e/fixtures/seed.js) sets `termsAcceptedAt: now, termsAcceptedVersion: 2` on every seed user. Without this, every E2E spec that signs in as a seed user would hit the blocking modal and fail. UI-registered test users go through the checkbox path via the `registerViaUI` helper which ticks BOTH `#register-confirm-age` (Tier 20 Chunk 1) AND `#register-accept-terms`. API-level `/api/register` test calls (in `auth.spec.js` + `admin.spec.js`) send `acceptedTerms: true, acceptedTermsVersion: 2, confirmedAge: true`. When bumping `CURRENT_TERMS_VERSION` again, update both `seed.js` AND every API-level test payload in lockstep.
75. **Tier 20 Chunk 7 — ACA migrate-job `AcrPull` role can orphan after MI rotation**: the `scorecast-migrate` Container Apps Job has a SystemAssigned identity; the AcrPull role assignment is created via [migrate-job.bicep:128-136](infra/modules/migrate-job.bicep#L128-L136) with `guid(acr.id, job.id, 'acrpull')` as the assignment name and `principalId: job.identity.principalId`. **Any rotation of the job's MI principalId** (re-create, identity toggled off/on, major Microsoft API-version migration) leaves the existing assignment bound to the stale principalId — CD fails the next deploy with `InvalidParameterValueInContainerTemplate ... unable to pull image using Managed identity system for registry`. **Diagnose**: `az containerapp job show --name scorecast-migrate --query identity.principalId` vs the principalId in `az role assignment list --assignee <principalId> --scope <acr-id>` — if no AcrPull row for the current principal, that's the failure. **Fix** (no Bicep reapply needed): `az role assignment create --assignee <current principalId> --role AcrPull --scope <acr id>`, wait ~60s for RBAC propagation, then re-trigger CD via `gh workflow run deploy.yml`. Confirmed seen 2026-05-26 on the Tier 20 deploy. Full recipe is saved as a Claude project memory at `reference_aca_migrate_job_acr_pull.md`. Same pattern applies to the main `scorecast-app` Container App's MI if it ever rotates — the role assignment lives in [app.bicep](infra/modules/app.bicep) with the same `guid(...)` naming.

### 11.5 Backup / Restore

Standard Postgres tooling (`pg_dump`, `pg_restore`). No app-specific export. Seed data is hand-curated in [data.json](data.json) and only re-runs when the users table is empty.

### 11.6 Cloud Deployment (Tier 9)

ScoreCast runs on Azure (`eastus2`) at https://bantryx.com. The whole stack is provisioned via Bicep IaC and updated by GitHub Actions CD on every push to `main`.

#### Resource topology

| Resource                 | Name                           | Role                                                                                                                               | Cost/mo             |
| ------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Resource Group           | `scorecast-prod`               | Container for everything                                                                                                           | —                   |
| Container Apps env       | `scorecast-env-p3aaelev7xp52`  | Consumption plan; hosts the app + the migration Job                                                                                | $0 idle             |
| Container App            | `scorecast-app`                | The Node/Express server; ingress on `:3000` → `:443`; scale 0→3                                                                    | $0 idle, ~$1/1k req |
| Container Apps Job       | `scorecast-migrate`            | One-shot `npm run db:migrate` triggered by CD before each roll-out                                                                 | $0 idle             |
| Container Apps Job       | `scorecast-ml-job`             | Daily probability pipeline (02:30 UTC); runs the `scorecast-ml` image's baked-in predict-and-write CMD                             | $0 idle, ~$0.07/mo  |
| Container Registry       | `scorecastacrp3aaelev7xp52`    | Stores `scorecast:<sha>` (Node) + `scorecast-ml:<sha>` (Python ML) images. Basic SKU, admin disabled, AcrPull via managed identity | ~$5                 |
| Postgres Flexible Server | `scorecast-pg-p3aaelev7xp52`   | B1ms (1 vCPU, 2 GB), Postgres 16, 32 GB storage, 7-day backups, public + firewall (`AllowAllAzureServices`)                        | ~$17                |
| Key Vault                | `scorecast-kv-p3aaelev7xp`     | RBAC mode; holds `jwt-secret`, `database-url`, `postgres-admin-password`, `resend-api-key`, `ml-pipeline-password`                 | ~$0.10              |
| Log Analytics workspace  | `scorecast-logs-p3aaelev7xp52` | Container Apps stdout sink; 1 GB/day cap                                                                                           | ~$2                 |
| Application Insights     | `scorecast-appi-p3aaelev7xp52` | APM (currently unwired in app code — env var present, SDK not yet imported)                                                        | ~$2                 |
| Azure AD app             | `scorecast-github-cd`          | Federated identity for GitHub OIDC; no client secret                                                                               | —                   |
| DNS                      | (Cloudflare, `bantryx.com`)    | Apex CNAME flattened to Container Apps FQDN, `www` proxied for redirect rule                                                       | $13/yr domain       |

Idle total: **~$30–35/mo**.

#### Bicep modules ([infra/](infra/))

| File                        | What it provisions                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.bicep`                | Orchestrator; takes `location`, `appName`, `imageTag`, `pgAdminPassword` (`@secure`), `customDomain`                                                                                                                                                                                                                                                                                         |
| `modules/logs.bicep`        | Log Analytics workspace + Application Insights linked to it                                                                                                                                                                                                                                                                                                                                  |
| `modules/registry.bicep`    | ACR Basic, admin disabled, anonymous pull disabled                                                                                                                                                                                                                                                                                                                                           |
| `modules/secrets.bicep`     | Key Vault, RBAC mode, soft-delete 7d                                                                                                                                                                                                                                                                                                                                                         |
| `modules/db.bicep`          | Postgres Flex B1ms; writes `database-url` (with `?sslmode=require`) and `postgres-admin-password` into Key Vault; firewall rule for Azure services                                                                                                                                                                                                                                           |
| `modules/app.bicep`         | Container Apps env + main app; system-assigned managed identity + RBAC for AcrPull on the registry + Key Vault Secrets User on the vault; secret references via `keyVaultUrl`; liveness + readiness probes on `/healthz`; `publicAppUrl` defaults to the Azure FQDN until `customDomain` is set                                                                                              |
| `modules/migrate-job.bicep` | Container Apps Job with `command: ['npm', 'run', 'db:migrate']`; same managed-identity RBAC pattern as the app                                                                                                                                                                                                                                                                               |
| `modules/ml-job.bicep`      | Container Apps Job for the daily ML probability pipeline. `triggerType: Schedule` with cron `30 2 * * *` (daily 02:30 UTC, 30 min ahead of the Node app's 03:00 UTC fixture sync). Provisions the `ml-pipeline-password` Key Vault secret from the `mlPipelinePassword` Bicep param; consumes that + `database-url` via managed-identity secret refs. Image lives in ACR repo `scorecast-ml` |
| `modules/dns.bicep`         | Conditional Azure DNS zone (only when `customDomain` is non-empty). Currently unused for production because Cloudflare handles `bantryx.com`                                                                                                                                                                                                                                                 |

Resource names use `uniqueString(resourceGroup().id)` so re-deploys are idempotent and globally unique.

#### Secret resolution path

```
Container App + Container Apps Jobs (each has its own system-assigned managed identity)
  └─► Key Vault (RBAC role: Key Vault Secrets User on each identity)
        ├─ jwt-secret             ◄── seeded once via `az keyvault secret set`
        ├─ database-url           ◄── written by db.bicep at deploy time
        ├─ resend-api-key         ◄── placeholder; replace with real key when ready
        ├─ postgres-admin-password ◄── written by db.bicep (kept for break-glass access)
        └─ ml-pipeline-password    ◄── written by ml-job.bicep from the `mlPipelinePassword` Bicep param
```

The Container App's `secrets:` block references each Key Vault entry via `keyVaultUrl` + `identity: 'system'`. At container start, Container Apps resolves the references, sets the values as environment variables (e.g. `JWT_SECRET`, `DATABASE_URL`), and starts the process. The app reads them as plain `process.env.X` — no Key Vault SDK call in app code.

#### CD pipeline ([.github/workflows/deploy.yml](.github/workflows/deploy.yml))

Triggers on push to `main` or `workflow_dispatch`. Three sequential jobs:

1. **`build-and-push`** — `npm ci` (with `HUSKY=0`) → `npm run lint` → `npm run build` → `azure/login@v2` via OIDC → `az acr login` → `docker build/push` with tags `<github-sha>` and `latest`. Outputs `image_tag` for later jobs.
2. **`migrate`** — `azure/login@v2` → `az containerapp job update --image <new>` → `az containerapp job start scorecast-migrate` → polls `az containerapp job execution show` until `Succeeded`. **Fails the workflow on `Failed`/`Degraded`/timeout** — no traffic shift if migrations didn't apply.
3. **`deploy`** — `azure/login@v2` → `az containerapp update --image <new>` → polls revision until `runningState: Running` → smokes `GET https://bantryx.com/healthz` and fails the workflow on non-200. Traffic shifts to the new revision automatically (single-revision mode).

Typical run time: **5–8 min**. Failures keep the old revision live; rollback is "revert + push."

#### Auth for CD

GitHub Actions OIDC + Azure workload identity federation. The federated credential at `scorecast-github-cd` trusts the issuer `https://token.actions.githubusercontent.com` for the subject `repo:vindevoudit/scorecast:ref:refs/heads/main`. No long-lived service-principal password exists. The SP has:

- `Contributor` on the `scorecast-prod` resource group
- `AcrPush` on the ACR

GitHub repo secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (no `AZURE_CLIENT_SECRET` — OIDC replaces it).

#### Custom domain + TLS (Tier 9.8)

`bantryx.com` is registered on Cloudflare Registrar and served by Cloudflare DNS:

| Cloudflare record       | Value                                                                                 | Proxy                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `bantryx.com` CNAME     | Container Apps FQDN                                                                   | DNS only (grey-cloud — orange-cloud would terminate TLS at Cloudflare and break Azure's managed cert validation) |
| `asuid.bantryx.com` TXT | Container Apps env's `customDomainVerificationId`                                     | DNS only                                                                                                         |
| `www.bantryx.com` CNAME | `bantryx.com`                                                                         | Proxied (orange-cloud) so the redirect rule can fire                                                             |
| Redirect rule           | `https://www.bantryx.com/*` → `https://bantryx.com/${1}` (301, preserve query string) | —                                                                                                                |

Container Apps issues + binds a free Azure managed cert via HTTP-01 ACME validation (Container Apps platform serves `/.well-known/acme-challenge/*` automatically). Cert auto-renews every 6 months.

#### Operational realities & one caveat

- **MIGRATE_ON_BOOT is `false` in prod.** Migrations run **only** as a one-shot Container Apps Job before each roll-out; the app server never auto-migrates in cloud.
- **`pino-pretty` isn't shipped to prod.** The runtime image is built with `npm ci --omit=dev`; the logger emits JSON when `NODE_ENV === 'production'` (which is set by both `app.bicep` and `docker-compose.yml`).
- **Scale-to-zero cold-start** — first request after idle takes ~3–5 s. Acceptable for now; flip `min=1` in `app.bicep` (~$15/mo) if user complaints arrive.
- **No managed Redis yet** — leaderboard cache + rate-limit + lockout counters are in-process. Single-instance scale only. Tier 10.4 will add managed Redis when horizontal scale becomes useful.
- **Bicep custom domain — reconciled (Tier 9-followup, 2026-05-16)**: the `bantryx.com` hostname binding + managed cert (`mc-scorecast-env--bantryx-com-8689`) + `CORS_ORIGINS`/`PUBLIC_APP_URL` env-var overrides are now captured in Bicep. [infra/modules/app.bicep](infra/modules/app.bicep) writes `properties.configuration.ingress.customDomains: [{name, bindingType:'SniEnabled', certificateId}]` when `customDomain` is non-empty; the env vars pivot on the same `customDomain` param. Full IaC reapply requires `customDomain=bantryx.com`, `customDomainCertId=<discovered>`, `pgAdminPassword=<live-pw>`, `imageTag=<live SHA>`, and `vapidPublicKey=<live key>` (5 params post-Tier-17). Discovery commands in [README.md §Full IaC reapply](README.md). DNS stays on Cloudflare — the `dns.bicep` module that would create an Azure DNS zone is gated behind a `useAzureDns=false` default. **Empirically validated 2026-05-24** — a full `az deployment group create` against live state ran 2m 5s, `provisioningState: Succeeded`, no net resource changes, deployment history captured (initial confidence came from `az deployment group what-if`; the actual apply is now also locked in).

---

## 12. Known Limitations & Technical Debt

| Area                               | Issue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Tier                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Tests below E2E                    | Playwright covers 270 tests across 22 specs (10 UI/flow + 14 per-endpoint API + 2 panel smokes); no unit / integration tests below the Playwright layer. Tradeoff acknowledged — the API suite hits the real route stack against a real DB, so the unit-test gap is mostly philosophical                                                                                                                                                                                                                                         | future                    |
| Pick types                         | Only winner picks; no spread / over-under / score prediction. Deferred from Tier 4b after live-score UX bedded in. Draws now award partial credit (post-draw-scoring tier) but the pick semantic stays `home`/`away` only                                                                                                                                                                                                                                                                                                        | future (post-4b)          |
| Match minute is approximate        | football-data.org free tier doesn't expose `minute` / `injuryTime`. Client estimates from kickoff + `halfTimeReached` + `phase` signals. Soft by ~5 min around halftime. Swap to paid provider via [lib/footballApi.js](lib/footballApi.js) for an authoritative timer                                                                                                                                                                                                                                                           | future (provider swap)    |
| Upstream filter staleness          | football-data.org's `?status=LIVE,IN_PLAY,PAUSED` filter has been observed to lag the canonical `?ids=` endpoint by 90+ min (incident 2026-05-19, AFC Bournemouth vs Manchester City sourceId 538145 — full postmortem in §8.22). Mitigated by the 3-min `reconcileInProgressGames` job (Tier 18 default; was 5-min on free tier) which polls `?ids=` for every local in-progress game; worst-case stuckness ≤3 min. If BOTH endpoints stale simultaneously (rare), admin manual override is the only path                       | future (provider swap)    |
| Streaks                            | Deferred — concurrent kickoffs make "consecutive correct" ambiguous (revisits when streak badges become a real product ask)                                                                                                                                                                                                                                                                                                                                                                                                      | future                    |
| Audit log before-state             | Middleware records `after` payload only; `before` for updates/deletes would need per-entity pre-fetch hooks. Auth-failed admin attempts (401/403 thrown before middleware runs) are not audited                                                                                                                                                                                                                                                                                                                                  | future                    |
| Real-time                          | No WebSocket/SSE; everything is HTTP polling at 30 s. Reaction count changes don't propagate across viewers in real time. Live-score updates land via the 60-s server cron + next-`refreshGames` on the client                                                                                                                                                                                                                                                                                                                   | 7                         |
| Notification spam                  | Bulk-setResult + live-score auto-finalization fan-out per-pick on result transition — no batching/dedup. A big upset on a popular fixture produces many notifications in one request                                                                                                                                                                                                                                                                                                                                             | 7                         |
| Cache scope                        | `leaderboardCache` + fixture cache + rate-limit + lockout counters are all in-process Maps. A multi-instance deploy would see stale reads across replicas. Refresh-token rows are in Postgres so sessions survive a restart, but the in-memory caches don't. Today the app runs single-instance so this is fine                                                                                                                                                                                                                  | Tier 10.4 (Redis backend) |
| Server-side log shipping           | pino → stdout → Container Apps → Log Analytics workspace (Tier 9.6). Application Insights resource is provisioned but its SDK isn't wired into app code yet. Sentry covers errors but not access logs                                                                                                                                                                                                                                                                                                                            | Tier 10.6                 |
| Health / readiness probes          | `/healthz` exists (Tier 9.4) and is used by Container Apps liveness + readiness probes — but it doesn't ping the DB or Redis. A real readiness check (`/readyz` with DB ping) is still pending                                                                                                                                                                                                                                                                                                                                   | Tier 10.1                 |
| Metrics                            | No `prom-client` / `/metrics` endpoint; no request-duration histogram, no cache hit/miss counters                                                                                                                                                                                                                                                                                                                                                                                                                                | Tier 10.3                 |
| Graceful shutdown                  | No SIGTERM drain. `tini` forwards SIGTERM; Node exits when the event loop drains. In-flight requests + scheduler ticks aren't given a grace window                                                                                                                                                                                                                                                                                                                                                                               | Tier 10.5                 |
| Multi-device session listing       | `refresh_tokens.userAgent` is captured, but there's no UI for "active sessions" or "sign me out of all devices" — the latter is implemented as `revokeAllUserRefreshTokens` but only triggered by password reset + in-session password change today                                                                                                                                                                                                                                                                              | future                    |
| Reused-recovery-code warning       | A second use of an already-consumed recovery code returns generic 400; no alert/notification to the user that someone else may have used a stolen code                                                                                                                                                                                                                                                                                                                                                                           | future                    |
| TypeScript migration               | No TS yet; whole codebase JavaScript + JSX. Parked at end of roadmap                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Tier 9.10                 |
| Storybook                          | No component sandbox. Visual changes verified by running the dev server + Playwright `screenshots/mobile.spec.js`. Parked at end of roadmap                                                                                                                                                                                                                                                                                                                                                                                      | Tier 9.11                 |
| Token-rule lint                    | The "components must use design tokens, not raw `slate-*`/`cyan-*` literals" rule is review-only; no ESLint plugin enforces it                                                                                                                                                                                                                                                                                                                                                                                                   | future                    |
| Friends' picks privacy             | `GET /api/picks/friends` (Tier 18 Chunk 4) returns every pick a friend made on a game in the ±30-day window — including picks that have not yet been resolved. A friend who realizes they don't want their pre-result picks visible to friends can't opt out of just this surface; their only lever is `users.profileVisibility = 'friends'` which masks them in leaderboards (not picks). Acceptable today because the social contract of "friends see friends' picks" is the feature; revisit if user feedback shows otherwise | future                    |
| Terms acceptance version is global | Bumping `CURRENT_TERMS_VERSION` re-prompts every user on next visit. There's no targeted re-prompt for users in a specific jurisdiction or with a specific consent gap. If a future material change only affects EU users (for example), the blunt approach would still prompt everyone. Acceptable today (single jurisdiction, single English-language audience)                                                                                                                                                                | future                    |
| Legal page versioning is silent    | The "Last updated" date inside the legal pages is hand-edited; there is no consent migration tooling to inspect what version any given user accepted. The `users.termsAcceptedVersion` integer is the only record. Acceptable today because we ship version 1; if multiple bumps stack up we'd want a `terms_versions` audit table that snapshots the full text per version                                                                                                                                                      | future                    |
| ML — single-league models          | PL only at launch. Architecture supports multi-league via `(name, leagueId)` unique index + per-league `MODEL_PATHS`. La Liga / Bundesliga / Serie A / Ligue 1 each need own CSV corpus + reconcile-map extension + seeder extension + training run                                                                                                                                                                                                                                                                              | future                    |
| ML — no isotonic calibration       | Tier 17 dropped Phase 2's calibration to keep the JS runtime zero-dep. Probabilities may be slightly miscalibrated at extremes (>70%). Re-introducing it would mean porting `IsotonicRegression.predict` to JS (binary search through piecewise constants exported as JSON arrays) — ~30 LOC follow-up if it ever matters                                                                                                                                                                                                        | future                    |
| ML — no monotonicity               | Tree models over a 2-feature space can have small non-monotonic kinks across narrow Elo ranges (a 20-pt Elo drop occasionally INCREASES a team's win probability by 1–3pp). Eliminable via `monotone_constraints={'home_elo':1, 'away_elo':-1}` in the Python trainer — one-line config addition if needed                                                                                                                                                                                                                       | future                    |

---

## 13. Roadmap

The live forward roadmap is in `C:\Users\vinde\.claude\plans\ROADMAP.md` (Tiers 7, 10, 12, 14, 15, 16). The original tier plan lives at `C:\Users\vinde\.claude\plans\go-through-this-codebase-warm-cloud.md` for historical context.

Summary:

- ✅ **Tier 1** — Foundational hardening (bcrypt, RBAC, rate-limit, zod, JWT secret, unique pick index).
- ✅ **Tier 2** — UX completions (outcome display, full leaderboards, my-picks, sections, countdown, skeletons, confirm, mobile, a11y floor).
- ✅ **Tier 3** — Social/engagement (profiles, badges, friends, public groups, comments, notifications).
- ✅ **Tier 4a** — Admin UI for game CRUD + user moderation.
- ✅ **Tier 4b** — External football data + leagues/seasons + audit log. Shipped 2026-05-16/17 across 3 chunks: football-data.org v4 client + leagues/seasons schema + manual sync + LeagueManager admin tab (Chunk 1); node-cron scheduler with Postgres advisory locks + daily fixture sync + 60-s live-score poll with reconcile pass + live-minute estimate from kickoff + halfTime/phase signals + live-score game card (Chunk 2); audit-log middleware + paginated admin view + public `/api/leagues` + league/season picker on the games view + `games.leagueId NOT NULL` tightening (Chunk 3). Picks remain winner-only (multi-kind deferred). Cost: $0/mo via the free tier. See §8.16.
- ✅ **Tier 5 (core)** — Ops & reliability: migrations framework (5.1), leaderboard caching (5.2), transactional cascades (5.3), structured logging (5.4), N+1 elimination (5.7), HTTP compression (5.6).
- ✅ **Tier 5.4b** — Frontend error reporting: React `ErrorBoundary`, `POST /api/client-errors`, window listeners + reporter, `X-Request-Id` capture, Sentry SDK opt-in. See §6.7.
- ✅ **Tier 5.5** — Playwright E2E. Three original specs: `pick-and-result`, `group-lifecycle`, `comment-reaction`. CI job with cached Chromium + trace upload on failure. Rate limiters share a `skipInTest` predicate.
- ✅ **Tier 5.5b** — Playwright coverage expansion. Five new specs (`auth-security`, `friend-system`, `notifications-badges`, `leaderboard-scoring`, `admin-panel`) + shared helpers. Covers Tier 6.6 lockout, Tier 6.4/6.8 password reset, Tier 6.7 CSRF reject, Tier 5.3 cascade delete, Tier 5.2 cache invalidation, probability-weighted scoring, badge unlocks, notification bell.
- ✅ **Tier 6** — Security hardening: CORS allowlist (6.1), helmet (6.2), email service (6.3), password reset (6.4), email verification on register (6.5), account lockout (6.6), CSRF double-submit (6.7), HttpOnly cookie auth + rotating refresh tokens (6.8), TOTP 2FA (6.9), per-route rate limits (6.10), dropped `nedb-promises` (6.11). See §8.15.
- ❌ **Tier 7** — Real-time & engagement: scheduler-driven notifications, WebSocket/SSE, web push, email digests, prefs.
- ✅ **Tier 8** (less 8.6) — User capabilities: group lifecycle (leave/transfer/delete), pick deletion, avatars, search, profile bio + displayName, comment edit + reactions, leaderboard sort + pagination, bulk admin actions.
- ✅ **Tier 8.6** — Profile privacy. Shipped 2026-05-16: `users.profileVisibility` ENUM (public/friends/private); `UserService.getProfileByUsername` gate; `LeaderboardService.getOverallForViewer` / `getForGroupForViewer` masking; ProfileView Settings radio; ProfileDrawer "private" sheet; 5-test profile-privacy.spec.js. See §8.18.
- ✅ **Tier 9** (less 9.10 TS + 9.11 Storybook) — DX, packaging & cloud deploy: ESLint + Prettier + Husky + lint-staged (9.1), frontend code-splitting (9.2), OpenAPI from zod (9.3, dev-only), Dockerfile + docker-compose + `/healthz` (9.4), GitHub Actions CI (9.5), Bicep IaC for Azure (9.6), Key Vault secrets wiring (9.9), CD workflow with OIDC (9.7), custom domain `bantryx.com` + Azure managed TLS (9.8). **App is live at https://bantryx.com.** See §11.6.
- 🟡 **Tier 9 follow-ups** — TypeScript migration (9.10) and Storybook (9.11) parked at end of roadmap; Bicep ↔ custom-domain reconciliation shipped 2026-05-16 (see §11.6).
- ❌ **Tier 10** — Observability & scale: `/readyz` (10.1), Prometheus metrics (10.3), managed Redis (10.4, replaces single-process leaderboard cache), graceful SIGTERM shutdown (10.5), cloud log shipping wired into App Insights SDK (10.6).
- ✅ **Tier 11** — UI/UX overhaul (4 chunks). **Chunk 1**: CSS-variable design tokens (`:root` dark + `:root[data-theme='light']` light); Tailwind config wires tokens through `rgb(var(--c-<name>) / <alpha-value>)`; semantic utility names (`bg-base`, `text-fg`, `border-default`, `text-accent`, etc.); Radix UI primitive wrappers under [src/components/ui/](src/components/ui/); ThemeToggle in top utility bar. **Chunk 2**: Sidebar nav replaces horizontal tab row (collapsible desktop / off-canvas mobile); UserMenu dropdown; Landing marketing page (with returning-user `sc_visited` localStorage gate); SignInModal + InlineGatePanel + AuthGateContext; anonymous browse mode (every public-read endpoint switched to `optionalAuth` + `publicReadLimiter`; `loadAnonDashboard` parallel-fetch path; per-component anon branches; back-to-landing pill; logout-to-landing). **Chunk 3**: removed `system` theme mode (binary light/dark only; legacy values normalize to dark); iOS Safari 16 px form-input fix in [src/index.css](src/index.css). **Chunk 4**: foundational accessibility (skip-to-content link; `<main>` landmarks; `<nav aria-label>` on Sidebar; `useReducedMotion` + `useFocusOnRouteChange` in [src/lib/a11y.js](src/lib/a11y.js); public [ACCESSIBILITY.md](ACCESSIBILITY.md)); first-run OnboardingTour (4-step Radix Dialog; `users.onboardingCompletedAt`; idempotent `POST /api/me/onboarding-completed`). See §6.8, §6.9, §8.20, §8.21, §10.4.
- ❌ **Tier 12** — Paid tier launch (parked).
- ✅ **Tier 13** — Codebase cleanup / modularization (six chunks). `server.js` 2262 → 157 LOC. `src/App.jsx` 1308 → 71 LOC. Routes / services / contexts / hooks split. New lint rules: backend `no-console` (with `lib/instrument.js` carve-out) + ban deep relative imports. Pure refactor — Playwright green on every chunk.
- ❌ **Tier 14 / 15 / 16** — Forward roadmap items (see plans/ROADMAP.md).
- ✅ **Draw scoring** (standalone, shipped 2026-05-17) — `games.drawProbability DECIMAL(3,2) NOT NULL DEFAULT 0` + result enum extended to `'draw'`. Three-branch `scorePick` (both [lib/scoring.js](lib/scoring.js) + [src/utils/scoring.js](src/utils/scoring.js)). Frontend rendering: `outcomeBadge` Drew branch, `LockedPickChip` Drew variant (warning tone), `PayoutMatrix` Draw row, `winningSide` narrowed to home/away (draws un-dim both team boxes), Drew notification text "Drew +N pts". ML pipeline rewired to `to_three_way` writing all three probabilities. Calibrator clip floor at 0.01 / ceiling at 0.99 (prevents isotonic's lower-bound 0 mapping from reaching the DB after DECIMAL(3,2) rounding). Picks stay winner-only; `winRate` semantic preserved (literal `choice === result`). See §8.1.
- ✅ **Security hardening batch** (standalone, shipped 2026-05-18) — 12 fixes: H1 `trust proxy 1` (real client IPs through Cloudflare → Azure); H2 constant-time login (`LOGIN_DUMMY_HASH`); H3 `currentPassword` required on `PATCH /me/email` + `POST /me/2fa/setup`; M1 `setImmediate` for forgot-password token INSERT + email send (closes timing-based enumeration); M3 Sentry PII redaction (`sendDefaultPii:false` + `beforeSend` redacts password/secret/token/recovery/otp/totp/cookie/set-cookie/authorization/csrf/api-key keys); M4 `algorithms:['HS256']` pinned on every `jwt.verify`; M5 new `POST /api/me/password` + `ChangePasswordPanel` (calling client stays signed in, every other refresh-bearing device kicked out); L3 Permissions-Policy header; L4 `bodyParser.json({limit:'32kb'})`; L5 constant-time recovery-code verify (`Promise.all(codes.map(bcrypt.compare))`); L6 `displayName`/`bio` reject bidi-override + zero-width + control codepoints (ZWJ U+200D intentionally allowed for emoji); L8 CI `npm audit --audit-level=high --omit=dev` + Dependabot weekly grouped PRs. See §10.2.
- ✅ **Per-endpoint API test suite** (standalone, shipped 2026-05-18) — ~250 new Playwright tests under [tests/e2e/api/](tests/e2e/api/) — one spec per route file covering happy path + 401 + admin-403 + CSRF-403 + 400 + 404 + ownership for every one of the 68 endpoints. New helper [apiAssertions.js](tests/e2e/helpers/apiAssertions.js) collapses per-test boilerplate. Plus two UI smokes ([change-email-panel.spec.js](tests/e2e/change-email-panel.spec.js) + [change-password-panel.spec.js](tests/e2e/change-password-panel.spec.js)). Total suite now 270 tests across 22 specs. See §10.6.
- ✅ **Leaderboard league + season filters** (standalone, shipped 2026-05-18) — `GET /api/leaderboard?leagueId=&seasonId=` scopes overall + per-group blocks. Builders `buildGroupLeaderboard(groupId, {leagueId, seasonId})` + `buildUserSummary({leagueId, seasonId})` add `where: gameWhere` on Game.findAll. In-memory pick loop's existing `if (!gameById.has(pick.gameId)) continue` guard drops out-of-scope picks from both numerator AND denominator → winRate scopes automatically. Cache key extended via `LeaderboardService.buildKey(scope, {leagueId, seasonId})` to `overall:l:<id|*>:s:<id|*>` and `group:<groupId>:l:<id|*>:s:<id|*>`. New `lib/leaderboardCache.js invalidatePrefix(prefix)` required because one logical scope now spans many keys. New [LeaderboardFiltersBar](src/components/LeaderboardFiltersBar.jsx) + `?lbLeague=&lbSeason=` URL keys (separate axis from games-view) + `DataContext.leaderboardFilters` slot. Mounts on Leaderboard + My Picks tabs (one global "stats scope" filter).
- ✅ **ML probability pipeline (Phase 1–3 history)** — Phase 1 (PL only, manual, shipped 2026-05-17): standalone Python project at [ml/](ml/) producing `(homeProbability, awayProbability)` via Elo + XGBoost. 5-season train (2004/05–2008/09) → 15-season held-out test (2010/11–2024/25, 5,700 OOS matches): mlogloss 0.992 vs baseline 1.065 (-0.073), accuracy 51.9% vs 44.9% (+7pp). Phase 2 (isotonic calibration, shipped 2026-05-17): per-class IsotonicRegression fit on val; clip every class to [0.01, 0.99] before renormalization; 70-80% bucket overconfidence pulled from -7pp to -2pp. Phase 3 (Azure deployment, shipped 2026-05-17 → daily 2026-05-18): `scorecast-ml-job` Container Apps Job on a daily 02:30 UTC cron, image-baked trained bundle, idempotent skip-existing. **All three Phase 1/2/3 deployment-side pieces were retired by Tier 17** (see below).
- ✅ **Tier 17 — Reactive Elo cascade + JS-native inference + retire Python pipeline** (shipped 2026-05-23 across 6 PRs). Inverts the daily-cron probability writer into an event-driven cascade triggered by every captured result. **PR A** (`teams` table + Elo bootstrap seeder); **PR B** (zero-dep JS XGBoost tree walker + Elo math + normalize, 39 unit tests via `node --test`); **PR C** (`PredictionService.onResultUpdated` + `rePredictFutureFixtures` wired into `GameService.setResult`/`bulkSetResult`/`applyLiveUpdate`); **PR D** (deleted Container Apps Job + ACR repo + `ml-deploy.yml` + `ml-job.bicep` + `ml-pipeline-password` KV secret + `ml_pipeline` DB user + 24 Python files; slimmed trainer to single `train` subcommand emitting `booster.save_model('PL_elo_<date>.json')`); **PR E** (fix XGBoost 2.x hex-encoded `base_score` parse → NaN poisoning every cascade prediction + defensive non-finite guard); **PR F** (idempotent + reversible cascade via per-game pre-match Elo snapshot — `games.{homeEloPre, awayEloPre, appliedResult}`; same result re-saved no-ops; result change reverses prior delta against snapshot + applies new delta against SAME snapshot; result clear reverses and drops snapshot; round-trip is bit-identical). Production model: `lib/ml/models/PL_elo.json` (615 trees, val mlogloss 0.944). Bicep reapply param count dropped 7 → 5. Operator scripts under [scripts/](scripts/): `query-teams.mjs`, `find-game.mjs`, `repair-test-game-elo.mjs`, `backfill-probabilities.mjs`. See §8.17 for the full architecture.
- ✅ **Tier 18 — UX & trust polish** (shipped 2026-05-23 to 2026-05-26 across 6 chunks). Daily-use friction grab-bag plus the legal/consent foundation.
  - **Chunk 1** (2026-05-26) — Chrome polish: BANTRYX wordmark becomes a clickable home-button when authed (cyan everywhere, white on hover except on the Games tab where it stays cyan); PWA manifest name shortened to `"Bantryx"` (was `"Bantryx — ScoreCast"`); mobile sidebar drawer + DialogPrimitive content gain `pt-safe` + `safe-bottom` so the iPhone notch + home indicator don't eat content; new `.pt-safe` utility = `max(0.5rem, env(safe-area-inset-top))`.
  - **Chunk 2** (2026-05-23) — Live-score cadence upgrade for paid football-data.org TIER_ONE plan. `RATE_LIMIT_PER_MINUTE` now env-driven (default 20, was hardcoded 10); `LIVE_SCORE_SYNC_CRON` default flipped to `'*/30 * * * * *'` (30 s, was 1 min); `IN_PROGRESS_RECONCILE_CRON` default flipped to `'*/3 * * * *'` (3 min, was 5 min). Probe of `GET /v4/competitions/PL` confirmed `x-requests-available-minute: 19` after 1 call ⇒ 20/min budget; `minute`/`injuryTime` STILL not exposed at TIER_ONE (client-side `useMatchMinute()` stays in). Cost: €19/mo.
  - **Chunk 3** (2026-05-26) — `<GamesCalendar />` 7-day fixed window viewer replacing the 3-section "live / upcoming / completed" cascade. URL `?date=YYYY-MM-DD` sync via `history.replaceState`. ±7-day arrow paging. "Back to today" pill with live red dot when in-progress today. `useGames.byDay` Map + exported `dayKey(value)` helper. Picks-history Draws filter chip. Compact `LeaderboardCard` (top-3 + self + friends + "Show all N" toggle) — `friendUserIds` prop wires DataContext.friends into the compact view. See §8.24.
  - **Chunk 4** (2026-05-26) — Friends' picks visibility. New `GET /api/picks/friends?gameId=<uuid>` endpoint (±30-day horizon, 500-row cap, server-side scored via `scorePick` honoring Tier 17 pick-time snapshots, passed through Tier 8.6 `applyMasking`). New `DataContext.friendsPicks` slot loaded in `loadDashboard` + `revalidate`. New `useFriendsPicks` selector with memoized `byGame` Map. New `<FriendPicksPanel />` mounted in every `GameCard` (won = green ✓+pts; **draw = warning yellow** (not green); missed = "✗ Missed" not "+0"). New `[Mine]/[Friends]` segmented toggle on My Picks tab with shared `comparePicksByPendingThenRecent` comparator (unresolved kickoff ASC then resolved kickoff DESC). Friend dropdown filter positioned LEFT of `LeaderboardFiltersBar`. Pill label "Friends" no apostrophe; section heading "Friends' Picks" keeps apostrophe (deliberate distinction). See §8.25.
  - **Chunk 5** (2026-05-26) — Group running comments. `comments` schema flips `gameId` to NULLABLE + adds `groupId` UUID NULLABLE → groups(id) CASCADE + partial index `comments_group_idx` + DB-level CHECK `comments_one_scope_chk` enforcing exactly one scope per row. `CommentService` refactored to scope-agnostic `list({gameId, groupId}, viewerId)` + `create({gameId, groupId, userId, body})` with `assertSingleScope` guards at the service layer. Group-comment fan-out via new `fanOutGroupComment({comment, author, group})` — every OTHER group member gets a `'group-comment'` push/bell notification (title `"<author> commented in <group name>"`, body capped at 160 chars, link `/?view=groups&groupId=<id>`). New `GET /api/groups/:id/comments` (anon-readable for public, 404 for non-members of private to avoid existence leak) + `POST /api/groups/:id/comments` (membership enforced in service, 403 for non-members even on public groups — write is member-only by design). `CommentThread` generalized to `{scope, scopeId}` props with backwards-compat `gameId` shim. `GroupCard` mounts `<CommentThread scope="group" scopeId={group.id} />` for members + owner. `GroupService.cascadeDelete` explicitly destroys group comments + reactions inside the transaction (defensive against `sync({alter:false})` bootstrap paths where the FK might have landed as NO ACTION). `PUSH_NOTIFICATION_TYPES` + `PushSettingsPanel` `NOTIFICATION_TYPES` both gain the `group-comment` entry. See §8.7.
  - **Chunk 6** (2026-05-26) — Notification deep-links + error toast cleanup + legal pages + terms acceptance. **6a deep-links**: every `NotificationService.notify(...)` call site now populates the 5th positional `link` arg (convention table in §6.2); `DataContext.consumeDeepLinks` runs ONCE between data-load and bootDone, recognizes `?view=` / `?gameId=` / `?groupId=`, writes synthetic `?date=` for the gameId path so GamesCalendar picks it up on first mount, strips consumed params via `history.replaceState`. **6b errors**: `useRequest` marks 4xx errors with `err.wasHandled = true`; `clientErrorReporter.reportClientError` short-circuits on the flag (skips both DOM event AND server POST); `NotificationContext` has defense-in-depth listener check; AuthView swallows `handleLogin` re-throw (closes documented Tier 5.5b race that clobbered "Invalid credentials" with the generic toast); `FRIENDLY_ERROR_CODES` wraps `football_api_rate_limit` / `rate_limited` into one-line user-facing copy. **6c legal pages**: new `src/components/legal/` with `LegalLayout` + `Terms` / `Privacy` / `Copyright` / `CookiePolicy` — plain-English copy grounded in app data flows but deliberately trimmed (no cookie-name tables, no exact retention windows, no named sub-processors, no specific security mechanisms) so we're not publishing an attacker-friendly inventory; T&T Data Protection Act 2011 reference. `App.jsx` short-circuits on `/terms` / `/privacy` / `/copyright` / `/cookies` pathnames before any auth/boot logic. New `<Footer />` on Landing + DashboardView. **6c terms acceptance**: migration `20260526000002` adds `users.{termsAcceptedAt, termsAcceptedVersion}` (nullable). `CURRENT_TERMS_VERSION = 1` constant in [validation/schemas.js](validation/schemas.js) + mirrored in [src/lib/terms.js](src/lib/terms.js). `registerSchema` requires literal `acceptedTerms: true` + matching version; `RegisterForm` gates submit on required checkbox with inline `/terms` + `/privacy` links opening in new tab; `routes/auth.js POST /api/register` stamps both columns on `User.create` so new users never see the modal. New `POST /api/me/accept-terms` rejects stale versions with 400. New `<TermsAcceptanceModal />` is a Radix Dialog with ALL dismissal vectors blocked (`onEscapeKeyDown` + `onPointerDownOutside` + `onInteractOutside` all preventDefault'd + no-op `onOpenChange`); only actions are "I accept" or "Sign out"; mounted in App.jsx when `user && !browseAsGuest && needsTermsAcceptance(user)`; suppresses `OnboardingTour` while open. Seed users pre-accepted in `fixtures/seed.js`; `registerViaUI` helper ticks `#register-accept-terms`; 5 API-level `/api/register` calls updated. See §8.26 + §8.27.

---

## 14. Glossary

| Term                                                        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------- |
| **Pick**                                                    | A user's prediction `'home' \| 'away'` for a single game. Unique per `(userId, gameId)`.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Result**                                                  | The actual outcome of a game, set by an admin: `'home' \| 'away' \| null`. `null` means the game hasn't been resolved (or was unresolved).                                                                                                                                                                                                                                                                                                                                                                                             |
| **Probability**                                             | Implied win-chance for one team in `[0,1]`. Home + away must sum to 1.0 ±0.01. Drives the scoring formula.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Upset bonus**                                             | Mechanic where picking the underdog (lower probability) pays more. Mathematically baked into `round((1 − probability) × 100)`.                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Group**                                                   | A user-created pool of members with its own scoped leaderboard. May be `private` (invite-only) or `public` (joinable).                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Invite**                                                  | A pending request, stored by username, that grants a user the right to accept membership in a group.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Friendship**                                              | An unordered pair of users in `pending` or `accepted` state. One row per pair, enforced by a functional unique index.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Badge**                                                   | A milestone achievement awarded server-side. Defined in [badges/catalog.js](badges/catalog.js); awarded by `evaluateBadges()`.                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Notification**                                            | An in-app feed item created by the `notify()` helper. Polled every 30 s by `NotificationBell`.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Drawer**                                                  | The right-side overlay panel that shows another user's `ProfileView`. Opened by clicking any leaderboard row.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Tab**                                                     | The pseudo-routing primitive in `DashboardView`. Tabs are strings (`'games'                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 'mypicks' | ...`) stored in the `view`slot of`DataContext`. |
| **Sync**                                                    | (Tier 4, deferred) The act of pulling fixtures + results from an external football API.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Tier**                                                    | Roadmap grouping. Tiers 1–3, 4a, 5 (core), and 8 (minus 8.6) are shipped; Tiers 4b, 6, 7, 8.6, 9 remain.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Migration**                                               | A versioned file under `migrations/` (Tier 5.1) that evolves the schema. Applied by sequelize-cli (`npm run db:migrate`) or by umzug on dev boot. Statements should be idempotent so they're safe against DBs that pre-existed the framework.                                                                                                                                                                                                                                                                                          |
| **Cascade transaction**                                     | (Tier 5.3) A `sequelize.transaction()` block wrapping a `cascadeDeleteUser/Game/Group()` call, so a mid-cascade failure rolls back every prior `destroy()` rather than leaving orphans.                                                                                                                                                                                                                                                                                                                                                |
| **Leaderboard cache key**                                   | `'overall'` for the global block; `group:<groupId>` per group. Invalidated on every mutation that affects standings. See §8.14.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Request ID**                                              | A UUID v4 assigned by [middleware/requestId.js](middleware/requestId.js) on every request, attached to `req.id`, echoed in the response's `X-Request-Id` header, and included in every log line produced by `req.log`. Honored inbound `X-Request-Id` headers (≤200 chars) are reused instead of generating a new one — useful for client-side correlation.                                                                                                                                                                            |
| **ErrorBoundary**                                           | (Tier 5.4b) React class component in [src/components/ErrorBoundary.jsx](src/components/ErrorBoundary.jsx) that wraps `<App />` in `main.jsx`. Catches _render-phase_ errors below it via `componentDidCatch`, swaps in a slate/rose fallback card, and reports through `reportClientError` + Sentry `captureException`. Does **not** catch errors thrown from event handlers, async code, or `setTimeout` callbacks — those go through the window-level listeners in [src/lib/clientErrorReporter.js](src/lib/clientErrorReporter.js). |
| **clientErrorReporter**                                     | (Tier 5.4b) Module in [src/lib/clientErrorReporter.js](src/lib/clientErrorReporter.js) that installs `window.error` and `unhandledrejection` listeners, throttles reports to 5 per 60 s, posts to `POST /api/client-errors`, and dispatches a `scorecast:client-error` DOM event for `NotificationContext` to toast. Exports `reportClientError({...})` for explicit calls and `setLastRequestId(id)` to record the most recent server reqId observed via response headers.                                                            |
| **`/api/client-errors`**                                    | (Tier 5.4b) Public endpoint accepting `{message, stack?, componentStack?, url?, reqId?, userAgent?, level?}` (zod-validated, all string fields capped — stack at 8 KB). Soft-decodes the JWT to attach `userId` if present, else logs anonymously. Rate-limited 30/5 min per IP. Always returns 204.                                                                                                                                                                                                                                   |
| **`SENTRY_DSN` / `VITE_SENTRY_DSN`**                        | (Tier 5.4b) Opt-in env vars enabling server-side and browser-side Sentry capture respectively. Both are no-ops when unset (server exports stubs; Vite tree-shakes the dynamic `@sentry/react` import). `VITE_SENTRY_DSN` is read at Vite build time — change requires `npm run build`.                                                                                                                                                                                                                                                 |
| **`sc_access` / `sc_refresh` / `sc_csrf` / `sc_challenge`** | (Tier 6.8 / 6.7 / 6.9) The four cookies that drive auth. `sc_access` is a 15-min HttpOnly access JWT (Path=/). `sc_refresh` is a 30-day HttpOnly opaque token (Path=/api/auth) whose SHA-256 hash is stored in `refresh_tokens`. `sc_csrf` is JS-readable 30-day random token used by the double-submit pattern. `sc_challenge` is a 5-min HttpOnly JWT issued between password-OK and 2FA-code-OK when the user has 2FA enabled.                                                                                                      |
| **Refresh-then-retry**                                      | (Tier 6.8) The frontend `useRequest()` hook's behavior on 401: try `POST /api/auth/refresh` once, then re-fetch the original. `/api/auth/*` paths are exempted from the retry to prevent recursion. This is what makes 15-min access tokens invisible to the user — they live 30 days from one login.                                                                                                                                                                                                                                  |
| **CSRF double-submit**                                      | (Tier 6.7) Defence against cross-site request forgery. The frontend reads the (non-HttpOnly) `sc_csrf` cookie via `getCookie('sc_csrf')` and echoes it as the `X-CSRF-Token` header on every state-changing request. Server compares the two via `crypto.timingSafeEqual`. Relies on same-origin policy preventing cross-origin reads of the cookie.                                                                                                                                                                                   |
| **EXEMPT_PATHS**                                            | (Tier 6.7) The set in [middleware/csrf.js](middleware/csrf.js) listing routes that skip CSRF enforcement. Only **pre-auth or anonymous** mutation endpoints belong here (login, register, refresh, verify-email, forgot/reset, client-errors). Adding any **post-auth** endpoint to this set is a security mistake.                                                                                                                                                                                                                    |
| **Token storage pattern**                                   | (Tier 6) Single-use tokens (verify-email, password-reset, refresh) are 32 random bytes hex, SHA-256-hashed on insert (`tokenHash` column), and looked up via that hash's unique index. Raw values only exist in transit. Recovery codes are the exception (low entropy → bcrypt).                                                                                                                                                                                                                                                      |
| **Account lockout**                                         | (Tier 6.6) After 5 failed password attempts against a single user, `users.lockedUntil = NOW + 15min`. Subsequent attempts return a generic 401 regardless of password correctness. State clears on successful login or password reset.                                                                                                                                                                                                                                                                                                 |
| **TOTP challenge cookie**                                   | (Tier 6.9) `sc_challenge` — a short-lived signed JWT (`{id, type: '2fa-pending'}`) issued by `POST /api/login` when the user has 2FA enabled. The next step in the flow, `POST /api/auth/2fa/verify`, reads this cookie + a TOTP code or recovery code, and only on success issues the real auth cookies.                                                                                                                                                                                                                              |
| **Recovery code**                                           | (Tier 6.9) A human-typable 10-character string (format `XXXXX-XXXXX`). 10 codes generated at 2FA setup, shown once, bcrypt-hashed (rounds 8) in `users.totpRecoveryCodes` JSONB. Single-use — consumed codes are spliced out of the array.                                                                                                                                                                                                                                                                                             |
| **`lib/email.send()`**                                      | (Tier 6.3) Pluggable transport wrapper. Loads Resend lazily when `RESEND_API_KEY` is set; otherwise emits structured `info`-level logs with the email payload (dev-log mode). **Never throws** — failures are logged and signaled by the returned `{delivered: false}` shape, so calling code can fire-and-forget.                                                                                                                                                                                                                     |
| **Design tokens**                                           | (Tier 11 Chunk 1) CSS custom properties in [src/index.css](src/index.css) under `:root` (dark) and `:root[data-theme='light']` (light overrides). Tailwind maps every utility through `rgb(var(--c-<name>) / <alpha-value>)`. Components MUST use tokenized utilities (`bg-base`, `text-fg`, `text-accent`, `border-default`, etc.) instead of raw `slate-*`/`cyan-*` literals — raw literals bypass the theme switch.                                                                                                                 |
| **Anonymous browse mode**                                   | (Tier 11) Read-only mode for visitors without an account. `AuthContext.browseAsGuest` (persisted to `localStorage.sc_browse_as_guest`) + `middleware/optionalAuth.js` + `publicReadLimiter`. Mutations open `<SignInModal>` (button actions) or render `<InlineGatePanel>` (composer surfaces). See §6.9 + §8.19.                                                                                                                                                                                                                      |
| **`AuthGateContext.gate(label)`**                           | (Tier 11) Helper that opens `<SignInModal>` with a contextual label ("Sign in to pick", "Sign in to react", etc.). Used for button-style anon actions. Composer surfaces use `<InlineGatePanel>` directly instead.                                                                                                                                                                                                                                                                                                                     |
| **OnboardingTour**                                          | (Tier 11 Chunk 4) Four-step Radix Dialog walking new users through picks → scoring → leaderboard → groups. Mounts when `user && !browseAsGuest && user.onboardingCompletedAt == null && view === 'games' && games.length > 0`. Skip + Done both `POST /api/me/onboarding-completed` (idempotent).                                                                                                                                                                                                                                      |
| **profileVisibility**                                       | (Tier 8.6) Per-user ENUM(`public` / `friends` / `private`). Gates `/api/users/:username/profile` (identical 404 for friends-gated-out and private — no friend-graph probing). Drives leaderboard masking. Within a group's per-group leaderboard, members never see each other masked (group implicit social contract). Admins always see unmasked.                                                                                                                                                                                    |
| **League / Season**                                         | (Tier 4b Chunk 1) Composition primitives over `games`. League has `(sourceProvider, sourceLeagueId)` unique — `sourceLeagueId` is the provider's competition code (e.g. `PL`, `BSA`) and is **what the frontend URL uses** so links are shareable across DB rebuilds. Season has `(leagueId, year)` unique with `current` boolean. `games.leagueId` is NOT NULL post Tier 4b Chunk 3.                                                                                                                                                  |
| **Status enum / Live update**                               | (Tier 4b Chunk 1+2) `games.status ∈ ('scheduled', 'in-progress', 'finished', 'postponed', 'cancelled')`. Live updates land via [lib/jobs/syncLiveScores.js](lib/jobs/syncLiveScores.js) (60-s cron + reconcile pass). `GameService.applyLiveUpdate` writes transactionally + fires notify/badge/cache-invalidate OUTSIDE the tx. Result only DERIVED if `localGame.result === null`. Mapping single source of truth at [lib/fixtureStatus.js](lib/fixtureStatus.js).                                                                   |
| **Live-minute estimate**                                    | (Tier 4b Chunk 2) Client-side computed in [src/utils/time.js](src/utils/time.js) `matchMinute(kickoff, {halfTimeReached, phase})` — football-data.org free tier doesn't expose `minute`/`injuryTime`. Refined by `games.halfTimeReached BOOLEAN` (monotonic) + `games.phase VARCHAR(20)` (`regular`/`extra-time`/`penalty-shootout`).                                                                                                                                                                                                  |
| **Reconcile pass**                                          | (Tier 4b Chunk 2) Second half of the live-score job. After the global LIVE call, batch-fetch via `getMatchesByIds([...])` for local games whose `sourceId` is missing from LIVE (catches IN_PLAY → FINISHED) or whose kickoff > 15 min ago (catches missed SCHEDULED → IN_PLAY). Load-bearing — without it, finished matches stay stale until the next daily sync.                                                                                                                                                                     |
| **Audit log**                                               | (Tier 4b Chunk 3) `audit_log` table + `auditMutation(action, entityType)` middleware factory. Records via `res.on('finish')` (captures real `statusCode`). NEVER throws back into the request lifecycle. Payloads >4KB truncated to `{_truncated, _bytes, preview}`. `actorUserId` SET NULL on user delete. Action strings follow `admin.<entity>.<verb>`.                                                                                                                                                                             |
| **Draw scoring**                                            | (Shipped 2026-05-17) `games.result` extended to include `'draw'`. Picks remain winner-only (`pick.choice ∈ {'home','away'}`). Draws award partial credit `pts = round(P_d × opposite_team_prob / (P_h + P_a) × 100)`. Strict `winRate` semantic preserved (literal `choice === result` only). Migration does NOT backfill legacy `result=null + status='finished'` rows (preserves leaderboard history).                                                                                                                               |
| **Sentinel probabilities**                                  | The ML pipeline's "untouched by anyone" defaults. Post-draw-scoring: `(0.50, 0.00, 0.50)` for `(home, draw, away)`. The pipeline's `nudge_off_triple_sentinel` ensures writes never emit the sentinel.                                                                                                                                                                                                                                                                                                                                 |
| **Calibration clip**                                        | (ML Phase 2) Isotonic regression maps low raw values to literal 0 at the bottom edge of its training range; DECIMAL(3,2) DB precision rounds anything <0.005 to 0.00. Clip floor at 0.01 / ceiling at 0.99 inside `ModelBundle.predict_proba` keeps the rounded floor at 0.01 so we never emit "literal 0% chance" writes. Locked in by `test_calibrated_output_clipped_off_zero_and_one`.                                                                                                                                             |
| **270-test suite**                                          | Current Playwright total — 10 UI/flow specs + 14 per-endpoint API specs + 2 panel smokes + visual regression, 22 spec files, ~5 min runtime. API specs cover happy path + 401 + admin-403 + CSRF-403 + 400 + 404 + ownership for every one of the 68 endpoints. See §10.6.                                                                                                                                                                                                                                                             |
| **Constant-time login**                                     | (Security batch H2) Login always runs `bcrypt.compare` against either the real user hash or `LOGIN_DUMMY_HASH` (generated once at module load). No observable response-time difference between "user doesn't exist" and "user exists, wrong password".                                                                                                                                                                                                                                                                                 |
| **`POST /api/me/password`**                                 | (Security batch M5) In-session password change. Bcrypt-compares `currentPassword`, saves new (Sequelize beforeUpdate re-hashes), then `revokeAllUserRefreshTokens` followed by `setAuthCookies` — calling client stays signed in but every OTHER refresh-bearing device is kicked out.                                                                                                                                                                                                                                                 |
| **Tier 11 Chunks**                                          | UI/UX overhaul. Chunk 1: design tokens + Radix primitives + light/dark theme + ThemeToggle. Chunk 2: Sidebar + UserMenu + Landing + SignInModal + InlineGatePanel + AuthGateContext + anonymous browse mode. Chunk 3: binary light/dark (removed `system`) + iOS 16 px form-input fix. Chunk 4: a11y infrastructure (skip link, `<main>` landmarks, `useReducedMotion`) + OnboardingTour. See §6.8, §6.9, §8.20, §8.21, §10.4.                                                                                                         |           |
