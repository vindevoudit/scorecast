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

| Layer              | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend framework | **React 18** with hooks-only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Familiar, easy hiring, no SSR needs                                                                                                                                                                                                                                                                                                                                                                                                              |
| Build tool         | **Vite 5**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Fastest DX for vanilla React; dev proxy avoids CORS in development                                                                                                                                                                                                                                                                                                                                                                               |
| Styling            | **Tailwind CSS 3**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Utility classes keep components self-contained; no design-token sprawl                                                                                                                                                                                                                                                                                                                                                                           |
| HTTP client        | **`fetch`** (no axios)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Standard; the wrapper handles JSON + auth header + 401                                                                                                                                                                                                                                                                                                                                                                                           |
| State              | **React Context + custom hooks** (Tier 13.6/13.7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Four providers: `NotificationContext` (toast banner), `AuthContext` (user + auth flow + `browseAsGuest` flag), `AuthGateContext` (anonymous-action sign-in gate — SignInModal + InlineGatePanel), `DataContext` (games/picks/groups/leaderboard/friends/profile/`gameFilters`/`leaderboardFilters` + every mutation). Selector hooks (`useGames`/`usePicks`/`useGroups`/`useLeaderboard`/`useFriends`) keep components narrow. No Redux/Zustand. |
| Backend            | **Node 18+ / Express 4**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Tiny surface, no router framework, easy to read                                                                                                                                                                                                                                                                                                                                                                                                  |
| ORM                | **Sequelize 6**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Predictable, supports raw SQL escape hatches                                                                                                                                                                                                                                                                                                                                                                                                     |
| Migrations         | **sequelize-cli + umzug** (Tier 5.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | sequelize-cli for `npm run db:*` scripts; umzug for programmatic dev-boot execution. Versioned files under `migrations/`. See §7.3                                                                                                                                                                                                                                                                                                               |
| DB                 | **PostgreSQL**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Need ENUMs, partial unique indexes, and `LEAST/GREATEST` functional indexes — all Postgres-specific                                                                                                                                                                                                                                                                                                                                              |
| Auth               | **HttpOnly cookie auth** (Tier 6.8): 15-min access JWT (HS256) + 30-day rotating refresh token, both via `res.cookie()`. Refresh tokens are SHA-256 hashed in `refresh_tokens` table. Bearer-header auth was removed in the same tier — there is **no token in the body** of login/register/refresh responses.                                                                                                                                                                                                                                                                          |
| 2FA                | **TOTP** (Tier 6.9) via `speakeasy` + `qrcode`. Opt-in per user. 10 single-use recovery codes (bcrypt-hashed, rounds 8). 5-min `sc_challenge` cookie issued between password-OK and code-OK.                                                                                                                                                                                                                                                                                                                                                                                            |
| Password hashing   | **bcryptjs** (cost 10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pure-JS, no native build step needed on Windows                                                                                                                                                                                                                                                                                                                                                                                                  |
| CSRF               | **Double-submit cookie** (Tier 6.7) via [middleware/csrf.js](middleware/csrf.js). `sc_csrf` cookie (readable) must match `X-CSRF-Token` header on POST/PUT/PATCH/DELETE; constant-time compare. Exempt list for unauthenticated mutation endpoints (login, register, password-reset, etc.). See §5.3 + §10.x.                                                                                                                                                                                                                                                                           |
| Security headers   | **helmet** (Tier 6.2) — CSP tuned for Vite/Tailwind (inline styles allowed; `data:` URIs for Avatars and fonts; Sentry endpoints in `connectSrc`; HMR `ws://localhost:5173` in dev only), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. COEP/COOP/CORP disabled to avoid breaking third-party assets.                                                                                                                                                                                                                               |
| CORS               | **Env allowlist** (Tier 6.1) via `CORS_ORIGINS` (comma-separated). Server **throws on boot** when unset in production. Dev falls back to `origin: true` if unset. `credentials: true` always.                                                                                                                                                                                                                                                                                                                                                                                           |
| Email              | **Resend SaaS** behind a pluggable abstraction at [lib/email.js](lib/email.js) (Tier 6.3). When `RESEND_API_KEY` is unset, `send()` logs the rendered payload to stdout — dev users grab verify/reset links from the server log. `send()` **never throws** (failures only log).                                                                                                                                                                                                                                                                                                         |
| Validation         | **zod**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Schema-first request validation; emits structured error JSON                                                                                                                                                                                                                                                                                                                                                                                     |
| Rate limiting      | **express-rate-limit**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Per-IP, in-memory. Limiters: `loginLimiter` (5/15min), `registerLimiter` (3/h), `clientErrorLimiter` (30/5min), `commentLimiter` (10/min), `friendRequestLimiter` (10/5min), `pickLimiter` (30/min), `forgotPasswordLimiter` (3/h). Account lockout (5 fails → 15-min lock) layered on top — see §8.x.                                                                                                                                           |
| Logging            | **pino + pino-http** (Tier 5.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Structured JSON in prod, `pino-pretty` in dev. Every request gets `req.id` (UUID or inbound `X-Request-Id`) and a `req.log` child logger                                                                                                                                                                                                                                                                                                         |
| HTTP compression   | **`compression`** (Tier 5.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Gzip middleware mounted before static + body parser; ~75% size reduction on the JS bundle                                                                                                                                                                                                                                                                                                                                                        |
| Leaderboard cache  | **In-memory Map** with 30 s TTL (Tier 5.2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | No Redis dependency; appropriate for the current single-process deployment. See §8.14                                                                                                                                                                                                                                                                                                                                                            |
| Error reporting    | **React `ErrorBoundary` + window listeners → `POST /api/client-errors`** (Tier 5.4b); **Sentry SDK** (`@sentry/node` + `@sentry/react`) gated behind `SENTRY_DSN` / `VITE_SENTRY_DSN` (lazy on both sides). See §6.7 + §10.1                                                                                                                                                                                                                                                                                                                                                            |
| Design system      | **CSS-variable design tokens** (Tier 11 Chunk 1) defined in [src/index.css](src/index.css) — `:root` carries the dark palette, `:root[data-theme='light']` overrides for light mode. Tailwind config wires every semantic token through `rgb(var(--c-<name>) / <alpha-value>)` so utilities like `bg-base/80` keep working with theme switches. **All `src/components/**` MUST use tokenized utilities** (`bg-base`, `bg-elevated`, `text-fg`, `text-accent`, `border-default`, etc.) — raw `slate-_`/`cyan-_`/`text-white` literals are forbidden because they bypass the theme switch |
| UI primitives      | **Radix UI** (`@radix-ui/react-dialog`, `-dropdown-menu`, `-popover`, `-select`, `-switch`, `-tabs`, `-toast`, `-tooltip`, etc.) wrapped under [src/components/ui/](src/components/ui/) (`Button`, `Card`, `Dialog`, `DropdownMenu`, `Input`, `PasswordInput`, `Radio`, `Select`, `Spinner`, `Tabs`, `Toast`, `Tooltip`, `Switch`, `Textarea`, `Popover`, `Avatar`, `Badge`, `Checkbox`, `Skeleton`). Keyboard interaction + ARIA semantics live in the primitive; ScoreCast components consume the wrapper, never raw `<button>`s for interactive surfaces                             |
| Theming            | **Binary light/dark** (Tier 11 Chunk 3 — `system` mode removed); managed by [src/lib/theme.js](src/lib/theme.js) `applyTheme` / `getStoredTheme` / `setStoredTheme`. Theme is applied **synchronously in [main.jsx](src/main.jsx) before React mounts** so no FOUC. Persisted to `localStorage.sc_theme`; legacy `'system'` values normalize to `'dark'` on read. Toggle UI: [src/components/ThemeToggle.jsx](src/components/ThemeToggle.jsx) in the top utility bar                                                                                                                    |
| Anonymous browse   | First-class read-only mode (no account required) — see §8.18. Gate UX via [src/contexts/AuthGateContext.jsx](src/contexts/AuthGateContext.jsx) (`gate(label)` helper), [src/components/SignInModal.jsx](src/components/SignInModal.jsx) (button-style actions), [src/components/InlineGatePanel.jsx](src/components/InlineGatePanel.jsx) (replaces composer surfaces)                                                                                                                                                                                                                   |
| Background jobs    | **node-cron** ([lib/scheduler.js](lib/scheduler.js)) with `pg_try_advisory_lock(crc32(jobName))` for multi-replica safety. Two scheduled jobs ([lib/jobs/syncFixtures.js](lib/jobs/syncFixtures.js): daily 03:00 UTC; [lib/jobs/syncLiveScores.js](lib/jobs/syncLiveScores.js): every 60 s). No-op when `NODE_ENV=test`. See §8.16                                                                                                                                                                                                                                                      |
| External data      | **football-data.org v4** free tier (10 req/min) behind a provider-agnostic surface at [lib/footballApi.js](lib/footballApi.js); status/result normalization in [lib/fixtureStatus.js](lib/fixtureStatus.js); response cache in [lib/cache.js](lib/cache.js). See §8.16                                                                                                                                                                                                                                                                                                                  |
| Audit log          | **`auditMutation(action, entityType)` middleware** (Tier 4b Chunk 3) wraps every `/api/admin/*` mutation; records via `res.on('finish')` through [services/AuditLogService.js](services/AuditLogService.js) with 4KB payload truncation; never throws back into the request lifecycle. See §8.16                                                                                                                                                                                                                                                                                        |
| ML pipeline        | **Python project under [ml/](ml/)**, deployed as a separate Azure Container Apps Job (`scorecast-ml-job`, daily cron 02:30 UTC). XGBoost `multi:softprob` + Elo + isotonic calibration → writes `(homeProbability, drawProbability, awayProbability)` via `PUT /api/admin/games/:id`. See §8.17                                                                                                                                                                                                                                                                                         |
| Tests              | **Playwright** (`@playwright/test`) — 22 specs, **270 tests** total. UI/flow specs at [tests/e2e/](tests/e2e/); per-endpoint boundary specs at [tests/e2e/api/](tests/e2e/api/) (one file per route file). See §10.6                                                                                                                                                                                                                                                                                                                                                                    |
| Container          | **Multi-stage Dockerfile** (`node:20-alpine`, non-root uid 1001, `tini`, `HEALTHCHECK /healthz`) — Tier 9.4. `docker-compose.yml` for local Postgres 16 + Redis 7 stack                                                                                                                                                                                                                                                                                                                                                                                                                 |
| CI / CD            | **GitHub Actions** ([.github/workflows/ci.yml](.github/workflows/ci.yml): lint + format-check + `npm audit` + build + migrations smoke + Playwright; [deploy.yml](.github/workflows/deploy.yml): build → migrate → roll out on push to main, OIDC-authed; [ml-deploy.yml](.github/workflows/ml-deploy.yml): rebuilds the ML image on `ml/**` changes). Dependabot opens weekly grouped PRs for npm / pip / github-actions / docker                                                                                                                                                      |
| Cloud              | **Azure** — Container Apps (Consumption) + Container Apps Jobs (migrate + ml) + Azure DB for PostgreSQL Flexible Server (B1ms) + Container Registry + Key Vault (RBAC) + Log Analytics + App Insights. Bicep IaC under [infra/](infra/). Cloudflare DNS + Azure managed TLS                                                                                                                                                                                                                                                                                                             |

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
│   └── 20260518000008-games-add-draw-scoring.js    # draw-scoring tier: games.drawProbability DECIMAL(3,2) NOT NULL DEFAULT 0 + games.result enum extended to ('home','away','draw')
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
│   ├── footballApi.js                   # Tier 4b: football-data.org v4 client. getCompetitions / getFixtures / getLiveMatches / getMatchesByIds. Sliding-window rate-limit (10 req/min). Provider-agnostic surface — swap by replacing this file
│   ├── fixtureStatus.js                 # Tier 4b: STATUS_MAP + mapUpstreamStatus(raw) → 'scheduled'/'in-progress'/'finished'/'postponed'/'cancelled'; deriveResultFromFixture(fixture, localStatus) → 'home'/'away'/'draw'/null. Single source of truth shared by manual sync + live-score job
│   ├── scheduler.js                     # Tier 4b Chunk 2: node-cron wrapper. register(name, cron, handler) → wraps handler in pg_try_advisory_lock(crc32(jobName)). start() is a no-op when NODE_ENV=test
│   └── jobs/                            # Scheduled job handlers, each exporting {run}
│       ├── syncFixtures.js              # Daily 03:00 UTC. Iterates active leagues → LeagueService.syncFixtures(leagueId). Early-returns when FOOTBALL_DATA_API_KEY unset
│       └── syncLiveScores.js            # Every 60 s. Global ?status=LIVE,IN_PLAY,PAUSED call → GameService.applyLiveUpdate per match. Reconcile pass via ?ids= catches IN_PLAY → FINISHED transition + SCHEDULED → IN_PLAY missed kickoffs
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
│   ├── LeagueService.js                 # Tier 4b: CRUD + ensureSeason(leagueId, year) + upsertFixture(league, season, apiMatch) + syncFixtures(leagueId) — idempotent upsert by (leagueId, sourceId)
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
├── ml/                                  # Standalone Python ML pipeline (Tier 4b post-launch). Separate Docker image, scheduled daily 02:30 UTC. See §8.17
│   ├── Dockerfile                       # 3-stage: base → train (runs `python -m scorecast_ml train` against committed CSV corpus, seed=42 → PL_<date>.joblib) → runtime (non-root uid 1001, tini, CMD predict-and-write)
│   ├── README.md, ONBOARDING.md         # per-league playbook (PL → La Liga / Bundesliga / Serie A / Ligue 1)
│   ├── data/raw/PL_*.csv                # Public-domain Football-Data.co.uk corpus, ~3 MB, committed to git via .gitignore negation `!ml/data/raw/*.csv`
│   ├── scorecast_ml/                    # ingest/, reconcile/, elo/, features/, train/, inference/, db/
│   └── tests/                           # pytest (~48 tests: Elo determinism, normalize sum-to-1, calibrator clip, reconcile aliasing)
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

There is **no separate worker process**, **no PM2 wrapper**. Restart = lose the in-memory rate-limit counters, lockout counters, leaderboard cache, fixture cache, and any pending in-flight cron tick (next tick recovers — fixture sync is idempotent, live-score self-recovers via the reconcile pass). There is **no graceful SIGTERM shutdown** logic yet (Tier 10.5) — `tini` forwards SIGTERM; the process exits when Node's event loop drains.

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
   - `POST /api/register` — accepts `{username, password, email}`. Body response: `{user}` only (auth cookies set via `setAuthCookies`). Fires `sendVerificationEmail` fire-and-forget.
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
   - `GET /api/me` — returns `{id, username, role, displayName, bio, email, emailVerifiedAt, twoFactorEnabled, profileVisibility, onboardingCompletedAt, joinedGroups, pendingInvites}`. Drives auth-state inference on the client.
   - `PUT /api/me` — `{displayName?, bio?, profileVisibility?}` edit. Body validated by `editProfileSchema` (display/bio reject bidi-override + zero-width + control codepoints — security batch L6 — while still allowing ZWJ for emoji like 👨‍💻). Invalidates leaderboard cache `'all'` when `displayName` OR `profileVisibility` actually changes (Tier 8.6 masking layer's view of stale visibility).
   - **`POST /api/me/onboarding-completed`** (Tier 11 Chunk 4) — sets `users.onboardingCompletedAt = NOW()` if null (idempotent). Called by both Skip and Done buttons in OnboardingTour.
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

5. **Picks** — [routes/picks.js](routes/picks.js): `POST /api/picks` + `GET /api/picks` + **`DELETE /api/picks/:id`** (Tier 8 — undo pick).

6. **Groups** — [routes/groups.js](routes/groups.js), in this order:
   - `GET /api/groups` (authed: caller's joined groups; anon: 401)
   - **`GET /api/groups/discover`** (`optionalAuth` + `publicReadLimiter`) — **must come before `/:groupId`** so Express doesn't match `discover` as a path param. Anon sees all public groups; authed sees public groups they're not in.
   - `GET /api/groups/:groupId` (`optionalAuth`). Anon: 404 if private (avoids leaking existence); public: returns group with `maskMembersForAnon` projection.
   - `POST /api/groups` + invite/accept/decline endpoints + `POST /api/groups/:groupId/join` + `POST /api/groups/:groupId/leave` + `POST /api/groups/:groupId/transfer` + `DELETE /api/groups/:groupId` + `POST /api/groups/:groupId/visibility`.

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

15. **Health** — [routes/health.js](routes/health.js): `GET /healthz` (mounted at root, no `/api` prefix). Used by Container Apps liveness + readiness probes. Currently does not ping the DB or Redis — Tier 10.1 will add `/readyz`.

16. **API docs (dev only)** — [routes/docs.js](routes/docs.js): `GET /api/openapi.json` + `GET /api/docs` (Swagger UI). Mounted ONLY when `NODE_ENV !== 'production'`.

17. **API 404 sentinel** — `app.use('/api', (req, res) => res.status(404).json({error: 'Not found'}))` so unknown `/api/*` paths return JSON 404 instead of falling through to the SPA HTML catch-all.

18. **Catch-all**: `app.get('*')` → `dist/index.html` (client-side routing).

**⚠ Route ordering matters for path-param shadowing.** `/api/groups/discover` is registered before `/api/groups/:groupId`. Any future sibling route under `/api/groups/*` must follow the same convention.

**⚠ OpenAPI dev-gating** — the `/api/openapi.json` + `/api/docs` mounts are gated on `NODE_ENV !== 'production'` so the public API surface isn't published from the live site (attack-surface reduction). The `app.use('/api', 404)` sentinel sits between those routes and the SPA catch-all so unknown `/api/*` paths never resolve to the SPA HTML.

### 5.5 Side-Effect Helpers (lib/ + services/ after Tier 13)

Tier 13 extracted every cross-handler helper out of `server.js` into `lib/` (pure infra) or `services/` (domain logic). The table below tracks the canonical home of each helper today plus where it's invoked from. **Side-effects always fire OUTSIDE owning transactions** so a rollback never produces ghost notifications or badges.

| Helper                                                                              | Home                                                               | Purpose                                                                                                                                                                                                                                                                                                     | Called from                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scorePick(pick, game)`                                                             | [lib/scoring.js](lib/scoring.js)                                   | Authoritative scoring formula (home/away/draw branches per the draw-scoring tier)                                                                                                                                                                                                                           | `lib/users.js buildUserSummary`, `lib/groups.js buildGroupLeaderboard`, `UserService.getProfileByUsername`, `GameService.setResult/bulkSetResult/applyLiveUpdate`                                                                                                                                                                         |
| `NotificationService.notify(userId, type, title, body?, link?)`                     | [services/NotificationService.js](services/NotificationService.js) | Creates a `Notification` row; swallows errors with a warn-log                                                                                                                                                                                                                                               | `PickService`, `GameService`, `GroupService`, `BadgeService.awardBadge` (badge-earned), friend-accept                                                                                                                                                                                                                                     |
| `BadgeService.awardBadge(userId, slug)`                                             | [services/BadgeService.js](services/BadgeService.js)               | Inserts a `Badge` row (unique-constrained); fires a `badge` notification                                                                                                                                                                                                                                    | `BadgeService.evaluateBadges` only                                                                                                                                                                                                                                                                                                        |
| `BadgeService.evaluateBadges(userId, ctx?)`                                         | [services/BadgeService.js](services/BadgeService.js)               | Re-runs all badge unlock conditions for a user; idempotent                                                                                                                                                                                                                                                  | `PickService.createPick`, `GroupService.create`, per-user inside `GameService.setResult/bulkSetResult/applyLiveUpdate`                                                                                                                                                                                                                    |
| `getFriendshipBetween(a, b)` / `friendStatusFrom(...)`                              | [lib/friends.js](lib/friends.js)                                   | Finds the single row (either direction); maps to `'self' \| 'none' \| 'pending-in' \| 'pending-out' \| 'friends'`                                                                                                                                                                                           | `UserService.getProfileByUsername`, friend-request guards                                                                                                                                                                                                                                                                                 |
| `getViewerFriendIdSet(viewerId)`                                                    | [lib/friends.js](lib/friends.js)                                   | One-query lookup of accepted-friend ids for a viewer; Tier 8.6 masking input                                                                                                                                                                                                                                | `LeaderboardService.{getOverallForViewer,getForGroupForViewer}`                                                                                                                                                                                                                                                                           |
| `buildUserSummary({leagueId, seasonId})`                                            | [lib/users.js](lib/users.js)                                       | Overall leaderboard rows (includes displayName + profileVisibility + winRate). Optional filter args (post-Tier-4b) scope to picks on games in that league/season                                                                                                                                            | `LeaderboardService.getOverall`                                                                                                                                                                                                                                                                                                           |
| `buildGroupLeaderboard(groupId, {leagueId, seasonId})`                              | [lib/groups.js](lib/groups.js)                                     | Group-scoped rows (same shape + scoped to group members)                                                                                                                                                                                                                                                    | `LeaderboardService.getForGroup`                                                                                                                                                                                                                                                                                                          |
| `sortLeaderboard(rows, orderBy)`                                                    | [lib/scoring.js](lib/scoring.js)                                   | Sort by `points / winRate / username`, attach `rank`                                                                                                                                                                                                                                                        | Group leaderboard pagination path inside the route handler                                                                                                                                                                                                                                                                                |
| `LeaderboardService.invalidate('all' \| key)` / `invalidatePrefix(prefix)`          | [services/LeaderboardService.js](services/LeaderboardService.js)   | Cache invalidation. `invalidatePrefix` is required for group scopes (one logical group spans many `(leagueId,seasonId)` filter variants)                                                                                                                                                                    | `PickService.{create,delete}` ('all'), `GameService.{setResult,bulkSetResult,bulkDelete,deleteGame,applyLiveUpdate}` ('all'), `GroupService.{acceptInvite,joinPublic,leave,deleteGroup}` (`invalidatePrefix('group:<id>')`), `UserService.{deleteUserById,bulkAction}` ('all'), `PUT /api/me` if displayName or profileVisibility changes |
| `UserService.cascadeDelete(target, {transaction})`                                  | [services/UserService.js](services/UserService.js)                 | 9-step user cascade (groups owned, tokens, picks, comments, friendships, memberships, invites, notifications, badges, then user). Tier 5.3: tx-aware. Post-Tier-11 fix-up: also destroys verify/reset/refresh/notification/badge rows explicitly inside the tx (see CLAUDE.md "Cascade-delete fix-up")      | `DELETE /api/admin/users/:id`, `POST /api/admin/users/bulk`                                                                                                                                                                                                                                                                               |
| `GameService.cascadeDelete(game, {transaction})`                                    | [services/GameService.js](services/GameService.js)                 | Pick + comment cleanup, then game. Tier 5.3: tx-aware                                                                                                                                                                                                                                                       | `DELETE /api/admin/games/:id`, `POST /api/admin/games/bulk`                                                                                                                                                                                                                                                                               |
| `GroupService.cascadeDelete(group, {transaction})`                                  | [services/GroupService.js](services/GroupService.js)               | Members + invites + group                                                                                                                                                                                                                                                                                   | `DELETE /api/groups/:groupId`                                                                                                                                                                                                                                                                                                             |
| `GameService.applyLiveUpdate(localGame, apiMatch)`                                  | [services/GameService.js](services/GameService.js)                 | Tier 4b Chunk 2: transactional live-score writer. Computes `(status, score, result, halfTimeReached, phase)` from upstream; early-returns if unchanged. Notify + badge + cache fan-out fires OUTSIDE the tx. Result only DERIVED if `localGame.result === null` (admin-entered results are never clobbered) | `lib/jobs/syncLiveScores.js`                                                                                                                                                                                                                                                                                                              |
| `LeagueService.upsertFixture(league, season, apiMatch)` / `.syncFixtures(leagueId)` | [services/LeagueService.js](services/LeagueService.js)             | Idempotent upsert by `(leagueId, sourceId)`; daily sync orchestrator                                                                                                                                                                                                                                        | Manual admin endpoint + `lib/jobs/syncFixtures.js`                                                                                                                                                                                                                                                                                        |
| `AuditLogService.record({...})`                                                     | [services/AuditLogService.js](services/AuditLogService.js)         | Single audit-log row insert with 4KB payload truncation. NEVER throws back into caller                                                                                                                                                                                                                      | `middleware/auditLog.js` `res.on('finish')` handler                                                                                                                                                                                                                                                                                       |
| `scheduler.register(name, cron, handler)` / `.start()`                              | [lib/scheduler.js](lib/scheduler.js)                               | Registers a node-cron tick. Each invocation acquires `pg_try_advisory_lock(crc32(jobName))`. No-op when `NODE_ENV=test`                                                                                                                                                                                     | `server.js` boot (after route mount, before `app.listen`)                                                                                                                                                                                                                                                                                 |
| `createAccessToken(user)`                                                           | [lib/auth.js](lib/auth.js)                                         | 15-min HS256 JWT with `{id, username, role}`                                                                                                                                                                                                                                                                | `setAuthCookies` only                                                                                                                                                                                                                                                                                                                     |
| `setAuthCookies(res, user, {userAgent})`                                            | [lib/auth.js](lib/auth.js)                                         | Signs access JWT, generates random refresh token, inserts a `RefreshToken` row, sets both cookies on `res`. Async                                                                                                                                                                                           | `POST /api/login`, `/api/register`, `/api/auth/refresh`, `/api/auth/2fa/verify`, `POST /api/me/password`                                                                                                                                                                                                                                  |
| `clearAuthCookies(res)`                                                             | [lib/auth.js](lib/auth.js)                                         | `res.clearCookie` for `sc_access` + `sc_refresh` at their correct paths                                                                                                                                                                                                                                     | `POST /api/auth/logout`, refresh-failure paths                                                                                                                                                                                                                                                                                            |
| `revokeAllUserRefreshTokens(userId)`                                                | [lib/auth.js](lib/auth.js)                                         | Sets `revokedAt = NOW()` on every non-revoked row for the user                                                                                                                                                                                                                                              | `POST /api/auth/reset-password`, `POST /api/me/password`                                                                                                                                                                                                                                                                                  |
| `generateRawToken()` / `hashToken(raw)`                                             | [lib/auth.js](lib/auth.js)                                         | 32 random hex bytes; SHA-256 hex digest                                                                                                                                                                                                                                                                     | All three token issuers + verifiers (verify-email, password-reset, refresh)                                                                                                                                                                                                                                                               |
| `sendVerificationEmail(user)`                                                       | [lib/emailHelpers.js](lib/emailHelpers.js)                         | Generates a token row + dispatches verify email via `lib/email`. Fire-and-forget                                                                                                                                                                                                                            | `POST /api/register`, `PATCH /api/me/email`                                                                                                                                                                                                                                                                                               |

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
- `useGames` — `{ games, upcomingGames, liveGames, completedGames, refreshGames }` (the segmentation `useMemo` moved here from App.jsx)
- `usePicks` — `{ picks, pickMap, submitPick, removePick }` (pickMap built here)
- `useGroups` / `useLeaderboard` / `useFriends` — projections on `useData()`

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
          <App>                            // Tier 13 Chunk 6: layout shell only (~71 LOC)
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
                  │   │     <GameCard>*          // uses usePicks for submit/remove + pickMap
                  │   │       ├── live pill (status='in-progress'): "Live · 67'" (useMatchMinute)
                  │   │       ├── <PayoutMatrix> // 2×3 preview matrix on upcoming games
                  │   │       └── <CommentThread>
                  │   │             ├── authed: composer + reaction buttons
                  │   │             └── anon:   <InlineGatePanel> composer; reaction click → gate('Sign in to react')
                  │   │     sidebar: <LeaderboardRow>* (clickable → opens drawer; honors entry.isMasked)
                  │   │
                  │   ├── view === 'mypicks':
                  │   │     <LeaderboardFiltersBar>   // ?lbLeague=&lbSeason= URL sync
                  │   │     <PicksHistory>           // filtered client-side by leaderboardFilters
                  │   │
                  │   ├── view === 'groups':
                  │   │     create form (with visibility radio)
                  │   │       anon: replaced by <InlineGatePanel label="Sign in to create a group">
                  │   │     Discover list
                  │   │       anon: row "Join" button → gate(...)
                  │   │     <FriendsList>             // returns null for anon viewers
                  │   │     pending invites           // authed only
                  │   │     <GroupCard>*
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
                      ├── <OnboardingTour>          // Tier 11 Chunk 4; gated on !onboardingCompletedAt
                      └── <ProfileDrawer>
                            └── <ProfileView>
                                  ├── <Avatar>
                                  └── <BadgeWall>

<CommentThread> renders:
  <CommentRow>* — each with <Avatar>, edit form (author only), 5-emoji reaction strip
```

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

| Column                  | Type                                                         | Notes                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | UUID PK                                                      |                                                                                                                                                                                                                       |
| `username`              | STRING UNIQUE NOT NULL                                       | Case-insensitive lookup via `iLike`. Regex `^[A-Za-z0-9_]+$` (validation/schemas.js — **underscores yes, hyphens no**; affects ML pipeline service account name)                                                      |
| `password`              | STRING NOT NULL                                              | bcrypt hash (cost 10); the model's `beforeCreate`/`beforeUpdate` hooks auto-hash anything not already matching `^\$2[aby]\$`                                                                                          |
| `role`                  | ENUM('user','admin') NOT NULL DEFAULT 'user'                 | Added via migration                                                                                                                                                                                                   |
| `displayName`           | VARCHAR(60) NULLABLE                                         | Tier 8. Used in place of username everywhere when set                                                                                                                                                                 |
| `bio`                   | TEXT NULLABLE                                                | Tier 8. Length-capped at 280 by zod, no DB-level constraint                                                                                                                                                           |
| `email`                 | VARCHAR(254) NULLABLE                                        | Tier 6.5. Private (not exposed except on `GET /api/me`). Functional unique index `users_email_lower_unique` on `LOWER(email) WHERE email IS NOT NULL` for case-insensitive uniqueness that tolerates legacy null rows |
| `emailVerifiedAt`       | TIMESTAMPTZ NULLABLE                                         | Tier 6.5. Required to be non-null before `/api/auth/forgot-password` will dispatch a reset link                                                                                                                       |
| `loginAttempts`         | INTEGER NOT NULL DEFAULT 0                                   | Tier 6.6. Incremented per bad password; cleared on success or password reset                                                                                                                                          |
| `lockedUntil`           | TIMESTAMPTZ NULLABLE                                         | Tier 6.6. When `> NOW()`, login returns generic 401                                                                                                                                                                   |
| `totpSecret`            | TEXT NULLABLE                                                | Tier 6.9. base32-encoded TOTP secret. Populated by `/api/me/2fa/setup` but enabled only after `/api/me/2fa/confirm`                                                                                                   |
| `totpEnabledAt`         | TIMESTAMPTZ NULLABLE                                         | Tier 6.9. `IS NOT NULL` ⇔ 2FA is required for this user's logins                                                                                                                                                      |
| `totpRecoveryCodes`     | JSONB NULLABLE                                               | Tier 6.9. Array of bcrypt-hashed (rounds 8) single-use recovery codes. Used codes are spliced out                                                                                                                     |
| `profileVisibility`     | ENUM('public','friends','private') NOT NULL DEFAULT 'public' | Tier 8.6. Gates `GET /api/users/:username/profile` (identical 404 for friends-gated-out and private — no friend-graph probing). Drives leaderboard masking via `LeaderboardService.getOverallForViewer`               |
| `onboardingCompletedAt` | TIMESTAMPTZ NULLABLE                                         | Tier 11 Chunk 4. NULL ⇒ first-run OnboardingTour fires on first valid render condition. Skip + Done both POST `/api/me/onboarding-completed` (idempotent — preserves existing timestamp)                              |
| `createdAt`             | TIMESTAMPTZ NOT NULL DEFAULT NOW                             |                                                                                                                                                                                                                       |

**Cascade behavior**: `users` → `badges`, `notifications`, `email_verification_tokens`, `password_reset_tokens`, `refresh_tokens` are `ON DELETE CASCADE` at the DB level. Post-Tier-11 [migration 20260516000002-cascade-user-fks.js](migrations/20260516000002-cascade-user-fks.js) retrofits this on prod DBs where the FKs were stuck at `NO ACTION` due to the original `sync({alter:false})` bootstrap path running before migrations (see CLAUDE.md "Cascade-delete fix-up"). Group ownership (`groups.ownerId`), picks, comments, friendships, group_members, and invites (by username) are **app-level cleanup** in `UserService.cascadeDelete` because they need ordering / disambiguation logic the DB can't express.

#### `games`

| Column                                                    | Type                                                                        | Notes                                                                                                                                                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                      | UUID PK                                                                     |                                                                                                                                                                                                                                   |
| `homeTeam` / `awayTeam`                                   | STRING NOT NULL                                                             |                                                                                                                                                                                                                                   |
| `date`                                                    | TIMESTAMPTZ NOT NULL                                                        | UTC; the kickoff time                                                                                                                                                                                                             |
| `homeProbability` / `drawProbability` / `awayProbability` | DECIMAL(3,2) NOT NULL                                                       | All three required; `drawProbability` defaults to 0 for backward compat. Validator enforces `home + draw + away = 1.0 ± 0.01`. Default for fresh fixtures: `(0.50, 0.00, 0.50)` (ML pipeline sentinel)                            |
| `result`                                                  | ENUM('home','away','draw') NULLABLE                                         | `NULL` = not yet resolved; `'draw'` (post-draw-scoring tier) awards partial credit via `scorePick`'s draw branch                                                                                                                  |
| `leagueId`                                                | UUID NOT NULL → `leagues(id)` (Tier 4b Chunk 1; tightened NOT NULL Chunk 3) | Backfilled to a synthetic `Legacy / Imported` league for pre-tier rows                                                                                                                                                            |
| `seasonId`                                                | UUID NULLABLE → `seasons(id)`                                               | Tier 4b Chunk 1. Created on demand by `LeagueService.ensureSeason` during sync                                                                                                                                                    |
| `sourceId`                                                | VARCHAR NULLABLE                                                            | Tier 4b Chunk 1. football-data.org's internal match id. Used by `applyLiveUpdate` to look up local rows. Partial unique index `(leagueId, sourceId) WHERE sourceId IS NOT NULL` — hand-entered rows skip the constraint           |
| `status`                                                  | ENUM('scheduled','in-progress','finished','postponed','cancelled') NOT NULL | Tier 4b Chunk 1. Set by `LeagueService.upsertFixture` (manual + daily sync) and `GameService.applyLiveUpdate` (60-s live poll). `GameService.setResult` flips `status` alongside `result` so manual admin entries stay consistent |
| `homeScore` / `awayScore`                                 | INTEGER NULLABLE                                                            | Tier 4b Chunk 1. Final score on `status='finished'`; live score on `status='in-progress'`                                                                                                                                         |
| `kickoffTz`                                               | VARCHAR(64) NULLABLE                                                        | Tier 4b Chunk 1. Stadium-local timezone string (informational only; UI renders in user's local TZ)                                                                                                                                |
| `halfTimeReached`                                         | BOOLEAN NOT NULL DEFAULT false                                              | Tier 4b Chunk 2. Flips to true once upstream populates `score.halfTime`. **Monotonic** in `applyLiveUpdate` (never reverts on upstream blip)                                                                                      |
| `phase`                                                   | VARCHAR(20) NULLABLE                                                        | Tier 4b Chunk 2. `regular` / `extra-time` / `penalty-shootout` (from upstream `score.duration`). Drives `matchMinute`'s ET/PEN display branches                                                                                   |

**Result derivation invariant**: `result` is only set automatically (by `applyLiveUpdate` or `upsertFixture`) when `localGame.result === null`. Admin-entered results are never clobbered by upstream updates. See `lib/fixtureStatus.js deriveResultFromFixture` for the upstream → local mapping (prefers `score.winner` over score comparison so penalty-shootout knockouts resolve correctly).

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

| Column      | Type                                          | Notes                                                                                           |
| ----------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`        | UUID PK                                       |                                                                                                 |
| `gameId`    | UUID NOT NULL → games(id) ON DELETE CASCADE   |                                                                                                 |
| `userId`    | UUID NOT NULL → users(id) ON DELETE NO ACTION | Cleaned up in admin user-delete                                                                 |
| `body`      | TEXT NOT NULL                                 | Validation: trim, 1–500 chars                                                                   |
| `createdAt` | TIMESTAMPTZ DEFAULT NOW                       |                                                                                                 |
| `editedAt`  | TIMESTAMPTZ NULLABLE                          | Tier 8. Set on every successful `PUT /api/comments/:id`. Frontend renders `(edited)` in the row |

**Index**: `comments_game_idx (gameId)` for fast thread fetch.

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

| Column      | Type                                        | Notes                                                                                                                                        |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | UUID PK                                     |                                                                                                                                              |
| `userId`    | UUID NOT NULL → users(id) ON DELETE CASCADE |                                                                                                                                              |
| `type`      | STRING NOT NULL                             | Free-form: `invite`, `pick-scored`, `friend-request`, `group-join`, `badge`. **Not an ENUM** so adding new types doesn't require a migration |
| `title`     | STRING NOT NULL                             |                                                                                                                                              |
| `body`      | TEXT NULLABLE                               |                                                                                                                                              |
| `link`      | STRING NULLABLE                             | Reserved for deep-linking; not yet rendered                                                                                                  |
| `read`      | BOOLEAN NOT NULL DEFAULT false              |                                                                                                                                              |
| `createdAt` | TIMESTAMPTZ DEFAULT NOW                     |                                                                                                                                              |

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
| `leagues` → `games`                                                                                          | `SET NULL` historically; post-Tier-4b Chunk 3 `games.leagueId NOT NULL` — deletion of a league with active games requires admin-side migration first                                                                                                                  |

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
edited (user re-submits)  ──┘
                          ▼
                  game.date passes
                          │
                          ▼
              admin sets game.result
                          │
                          ▼
              scorePick(pick, game) returns N
              evaluateBadges(userId) fires (correct counters update)
              notify(userId, 'pick-scored', ...) fires
```

**Lock rules** (enforced in `POST /api/picks` and `DELETE /api/picks/:id`):

- `game.date <= now` → 400 `Picks can only be created or changed for upcoming games` (POST) / `Picks can only be removed before kickoff` (DELETE)
- `game.result !== null` → same error in both directions

**Pick deletion** (Tier 8.2): `DELETE /api/picks/:id` lets a user **undo** their own pick before kickoff. The frontend [GameCard.jsx](src/components/GameCard.jsx) renders an "Undo pick" link only when the game is upcoming and the user has a pick. Admin user-delete still cascades picks for departed users.

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

`type` is a free-form string (not ENUM). Today's types: `invite`, `pick-scored`, `friend-request`, `group-join`, `badge`. Adding a new type is a one-line change at the call site — no schema migration, no frontend change (the bell renders by `title`/`body`/`createdAt`).

**Polling**: `NotificationBell` calls `GET /api/notifications` (which returns `{items, unreadCount}`) every 30 s. The unread count drives a red badge on the bell icon. Marking-as-read is local-then-remote: the UI optimistically dims the item and decrements the count, then fires `POST /api/notifications/:id/read`.

**`read-all`** clears every unread notification for the caller in a single `UPDATE notifications SET read=true WHERE userId=... AND read=false`.

### 8.7 Comments Subsystem

Per-game thread, rendered as a collapsible section at the bottom of every `GameCard`. Pulled lazily: the first open of a thread issues `GET /api/games/:gameId/comments` (newest first, capped at 50). New comments are appended optimistically to the local state.

The `GET` endpoint enriches every comment row with the Tier 8 reaction summary:

- `editedAt` — nullable; frontend shows `(edited)` next to the timestamp when set
- `reactionCounts: {emoji: N}` — counts across all reactors
- `yourReactions: [emoji...]` — the _caller's_ reactions only, so the UI can highlight toggled buttons

Authorization:

- **Post**: any authenticated user.
- **Edit** (Tier 8): author only via `PUT /api/comments/:id`. Sets `editedAt = NOW`.
- **Delete**: author **or** any admin. The frontend hides the edit/delete buttons unless `comment.userId === currentUserId`, but the server is the actual gate. Cascades comment_reactions.

**Reactions** (Tier 8): a fixed palette of 5 emojis — 👍 ❤️ 😂 😮 🔥 — defined as `ALLOWED_EMOJIS` in [validation/schemas.js](validation/schemas.js) and `REACTION_EMOJIS` in [CommentThread.jsx](src/components/CommentThread.jsx). The two arrays must stay in sync.

- `POST /api/comments/:id/reactions` is idempotent: the unique `(commentId, userId, emoji)` constraint catches duplicate inserts and the handler returns 200.
- `DELETE /api/comments/:id/reactions/:emoji` is a no-op when no such row exists (still returns 200).
- The frontend [CommentThread.jsx](src/components/CommentThread.jsx) optimistically updates `reactionCounts` and `yourReactions` locally, then issues the request; on failure it calls `load()` to resync.

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

Rate-limit budget on the free tier is **10 req/min, no daily cap**. The client keeps a 60-s sliding window of request timestamps and bails out early (with a 429-shaped `AppError`) when 9/10 is reached, so admin manual syncs don't starve the cron jobs. Responses are cached via [lib/cache.js](lib/cache.js) — fixture lists 1h, live-match queries 30s. The 1h fixture cache means repeated admin "Sync" clicks within an hour read from cache; cache is per-process and cleared on restart.

The free tier does NOT expose `minute` / `injuryTime`. The client surfaces what it can — `score.winner` (HOME_TEAM / AWAY_TEAM / DRAW), `score.halfTime` presence, `score.duration` (REGULAR / EXTRA_TIME / PENALTY_SHOOTOUT) — and the frontend estimates the match minute from those plus wall-clock-since-kickoff.

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

Two jobs ship today, both skipped silently when `FOOTBALL_DATA_API_KEY` is unset:

- **[syncFixtures.js](lib/jobs/syncFixtures.js)** — daily `0 3 * * *` UTC. Iterates active leagues (`active=true` on `leagues` table), calls `LeagueService.syncFixtures(leagueId)` for each. One league failure does not stop the rest.
- **[syncLiveScores.js](lib/jobs/syncLiveScores.js)** — every 60 s. Two phases:
  1. Single global `getLiveMatches()` call, filtered to active-league `competition.code`s. Each match routed through `GameService.applyLiveUpdate(localGame, apiMatch)`.
  2. **Reconcile pass**: find local games where `status='in-progress'` whose `sourceId` did **not** appear in the LIVE response — these likely transitioned to FINISHED between ticks (and so fell off the LIVE filter). Batch-fetch via `getMatchesByIds(ids)` and apply the final state. Without this, a finished match would stay locally `status='in-progress'` indefinitely.

Override defaults via env: `FIXTURE_SYNC_CRON='*/2 * * * *'` for dev rapid iteration; `LIVE_SCORE_SYNC_CRON='*/30 * * * * *'` for 30-s polling (note: 7-field cron format).

**Live update transactional flow** ([services/GameService.js](services/GameService.js) `applyLiveUpdate`)

Per the Tier 5.3 invariant, the write is transactional and the fan-out runs OUTSIDE the transaction so a rollback never produces ghost notifications:

```
applyLiveUpdate(localGame, apiMatch):
  newStatus       = mapUpstreamStatus(apiMatch.status)
  newResult       = deriveResultFromFixture(apiMatch, newStatus)  // only if result was null
  changed?        = status / homeScore / awayScore / result / halfTimeReached / phase differ
  if !changed → return early (60-s polls don't churn the DB)

  BEGIN
    update localGame { status, homeScore, awayScore, result, halfTimeReached, phase }
  COMMIT

  if transitioned to finished (result null → set):
    for each pick on this game:
      NotificationService.notify(pick.userId, 'pick-scored', ...)
      BadgeService.evaluateBadges(pick.userId)
    LeaderboardService.invalidate('all')
```

Result is only DERIVED if `localGame.result === null` — admin-entered results are never clobbered by upstream updates.

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

### 8.17 ML Probability Pipeline ([ml/](ml/))

#### Why it exists — the value to Bantryx

Bantryx's scoring formula is `round((1 − p_winning) × 100)`. Picking the team that wins pays `(1 - probability of that team winning) × 100`. **Without per-game probabilities, every pick pays a flat 50 pts** because `LeagueService.upsertFixture` writes the sentinel `(homeProbability=0.50, drawProbability=0.00, awayProbability=0.50)` to every fixture as it lands from football-data.org. A user picking heavy favorites and a user picking heavy underdogs both clear the same payout. The game has no edge to find.

The ML pipeline fills in real probabilities, which:

1. **Activates the upset bonus** — a 25%/75% underdog pick is worth 75 pts when it lands, while the corresponding favorite pick is worth 25. Skill at picking value emerges in the leaderboard standings.
2. **Activates draw scoring** — a pick where `pick.choice ∈ {'home', 'away'}` but the match ends as `result='draw'` now pays partial credit weighted by `drawProbability × opposite_team_prob / (homeProbability + awayProbability)`. Without `drawProbability > 0`, draws are a flat zero (the pre-tier behavior).
3. **Drives the `PayoutMatrix` preview UI** — each upcoming `GameCard` renders a 2×3 matrix showing what each pick would pay under each outcome (Home Win / Draw / Away Win). The preview is only meaningful when probabilities aren't all sentinel.

**Architectural promise**: the Node app is untouched by ML. The pipeline is a **consumer** of `lib/footballApi.js` outputs (read via the DB, not over HTTP) and a **producer** to `PUT /api/admin/games/:id` (the same admin endpoint a human admin would use through the GameManager UI). No new tables, no new endpoints, no new auth surface — the pipeline authenticates as a regular `role='admin'` user named `ml_pipeline` and every write lands in the `audit_log` table via the existing `auditMutation('admin.game.update', 'game')` middleware.

**Why a separate Python service** — XGBoost + scikit-learn + pandas are the natural toolchain; equivalent Node ML libraries are immature. Isolation also means the Python deps (~600 MB with xgboost / scikit-learn / numpy / pyarrow) never bloat the Node container. The two services share a database, not a runtime.

#### Architecture overview

```
                  ┌────────────────────────────────────────────────────┐
                  │ Football-Data.co.uk public CSVs (~30y history)     │
                  │   public domain; ~3 MB for PL committed to git     │
                  └─────────────────────────┬──────────────────────────┘
                                            │ ingest (one-time per season)
                                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                              ml/                                          │
│                                                                           │
│  ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────────────┐   │
│  │ ingest   │───▶│ reconcile │───▶│  elo     │───▶│  features        │   │
│  │ FDCO CSV │    │ aliases   │    │ K=20     │    │ 11 cols, as-of   │   │
│  │ → cache  │    │ teams.json│    │ HFA=0    │    │ < match date     │   │
│  └──────────┘    └───────────┘    └──────────┘    └─────────┬────────┘   │
│                                                              │            │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────────┴────────┐   │
│  │  train   │◀───┤ time-split   │◀───┤  X, y  →  XGBoost              │   │
│  │  (Phase  │    │ 15s train +  │    │  multi:softprob, ES on val     │   │
│  │   2 isotonic │ 1s val +     │    │  IsotonicRegression(per-class) │   │
│  │   cal'n) │    │ 1s held-out  │    │  → ModelBundle.joblib          │   │
│  └────┬─────┘    └──────────────┘    └────────────────────────────────┘   │
│       │                                                                    │
│       │ bundle baked into ml/data/models/ at image build time              │
│       ▼                                                                    │
│  ┌──────────┐    ┌──────────────────┐    ┌─────────────────────────┐      │
│  │  predict │───▶│ to_three_way     │───▶│  db/writer (httpx)      │      │
│  │  (rebuild│    │  round to DEC    │    │   POST /api/login       │      │
│  │   Elo +  │    │  rebalance       │    │   PUT  /api/admin/games │      │
│  │   form on│    │  nudge off       │    │        /:id    × N      │      │
│  │   DB +CSV│    │  (0.50,0.00,0.50)│    │  WriteResult{written,   │      │
│  │   merge) │    │  sentinel        │    │   skipped, failed}      │      │
│  └──────────┘    └──────────────────┘    └────────────┬────────────┘      │
└─────────────────────────────────────────────────────── │ ──────────────────┘
                                                         │ HTTPS
                                                         ▼
                  ┌────────────────────────────────────────────────────┐
                  │ Node app — Postgres `games.{home,draw,away}Probability` │
                  │   audit_log row per write via auditMutation        │
                  │   GameCard payouts re-render on next refreshGames  │
                  └────────────────────────────────────────────────────┘
```

**Package layout** under [ml/scorecast_ml/](ml/scorecast_ml/):

| Subpackage   | Responsibility                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingest/`    | Download + cache Football-Data.co.uk CSVs (`football_data_uk.py`); season-range parser (`seasons.py`)                                                          |
| `reconcile/` | Bridge FDCO team names to football-data.org canonicals via [reconcile/teams.json](ml/scorecast_ml/reconcile/teams.json) (`team_mapping.py`)                    |
| `elo/`       | Pure Elo engine — `expected_score`, `update`, `batch_compute` (`engine.py`); on-disk snapshot helpers (`snapshot.py`)                                          |
| `features/`  | 11-column feature matrix builder (`build.py`); rolling-form-as-of helpers with the load-bearing `< as_of` filter (`form.py`)                                   |
| `train/`     | Train/val/test split (`dataset.py`); XGBoost wrapper + `ModelBundle` joblib serializer (`model.py`); mlogloss + accuracy + majority-class baseline (`eval.py`) |
| `inference/` | 3-class probability prediction (`predict.py`); 3-class → DECIMAL(3,2) rounding + sentinel-nudge (`normalize.py`)                                               |
| `db/`        | Postgres connection (`connection.py`); read-only SELECTs for upcoming + completed games (`queries.py`); HTTP writer with cookie auth (`writer.py`)             |
| (root)       | `cli.py` (typer commands), `config.py` (pydantic-settings), `logging.py` (structlog), `__main__.py`                                                            |

**Scripts** at [ml/scripts/](ml/scripts/) — runnable diagnostics, not part of the pipeline:

- `demo_predict_one.py` — single Liverpool-vs-Arsenal prediction with full feature trace (useful for end-to-end sanity check).
- `compare_hfa.py` — HFA=0 vs HFA=65 ablation against a held-out test set. The script that locked in the `home_field_advantage=0` default.
- `backtest_2526.py` — walk-forward eval on the in-progress 25/26 season pulled from the live DB. The honest OOS check (val metrics are by construction optimistic post-Phase-2 calibration).

#### Pipeline stages — detailed

**1. Ingest** ([ingest/football_data_uk.py](ml/scorecast_ml/ingest/football_data_uk.py))

- URL: `https://www.football-data.co.uk/mmz4281/{season}/{fdco_code}.csv`. Free, public-domain, ~30 years of major European league history.
- `LEAGUE_CODE_MAP` maps ScoreCast league codes (matching `leagues.sourceLeagueId` for football-data.org rows) to FDCO codes: `PL→E0`, `PD→SP1`, `BL1→D1`, `SA→I1`, `FL1→F1`. Only PL is actively trained today; the other four are mapped but await per-league `teams.json` extensions.
- Cache path: `ml/data/raw/{league}_{season_code}.csv` — keyed by ScoreCast code (`PL`), NOT FDCO code (`E0`), so provider swaps don't move the cache.
- HTTP fetch wrapped in `tenacity.retry` (4 attempts, exponential backoff 2–15 s) to absorb upstream blips. Idempotent — re-runs hit cache unless `--force-redownload` is passed.
- Parser uses stdlib `csv` (not pandas) so historical CSVs with ragged trailing columns (e.g. 2003/04 added mid-season odds providers; later seasons added xG columns) still parse cleanly. Pandas's C/python engines would drop those rows.
- For each row, normalizes columns into `(date, home, away, fthg, ftag, ftr, league, season)` shape. `ftr ∈ {H, D, A}` (Full-Time Result).
- A SHA-256 of the response body is logged (first 12 chars) so anomalies in the upstream CSV can be detected after the fact.

**2. Reconcile** ([reconcile/team_mapping.py](ml/scorecast_ml/reconcile/team_mapping.py))

Bridges Football-Data.co.uk's short names ("Man United", "Spurs") to football-data.org's canonical names ("Manchester United FC", "Tottenham Hotspur FC"). The two providers must agree on team identity or inference would treat the same club as different teams.

- Aliases live in [reconcile/teams.json](ml/scorecast_ml/reconcile/teams.json), one block per league.
- Three-tier resolution: (1) exact alias match, (2) exact canonical match, (3) `rapidfuzz` fuzzy match. Score thresholds:
  - `≥ 92` → auto-match with WARN log.
  - `75 ≤ score < 92` → ERROR with the score in the message.
  - `< 75` → ERROR with "likely a new promotion — extend teams.json".
- The loud-error path on unknown names is the design — silently auto-matching at low fuzzy scores is how naive pipelines drift across preseasons when promoted teams arrive with names that resemble already-mapped clubs.

**3. Elo** ([elo/engine.py](ml/scorecast_ml/elo/engine.py))

Vanilla Elo math:

```
expected_score(r_home, r_away, hfa) = 1 / (1 + 10^((r_away - (r_home + hfa)) / 400))
update(r, expected, actual, K) = r + K · (actual - expected)
actual_score_from_ftr('H') = (1.0, 0.0)
actual_score_from_ftr('D') = (0.5, 0.5)
actual_score_from_ftr('A') = (0.0, 1.0)
```

`EloConfig` defaults: `initial_rating=1500`, `k_factor=20`, `home_field_advantage=0`, `promoted_team_strategy='min_rating'`. Two non-vanilla knobs:

- **`home_field_advantage` defaults to `0`** (not the conventional 65). The ablation in [ml/scripts/compare_hfa.py](ml/scripts/compare_hfa.py) showed HFA is a structural no-op for XGBoost: trees absorb the constant `elo_diff` shift in split thresholds, and the home/away feature-pair structure (`home_elo` + `away_elo` as separate columns) carries the actual home-advantage signal. Test-set mlogloss diff was ~0.001 — within noise. Pass `--hfa 65` to reproduce the legacy training.
- **`promoted_team_strategy='min_rating'`** — once `len(seasons_seen) > 1`, any team first appearing enters at `min(current ratings)` instead of `initial_rating=1500`. Captures the empirical reality that promoted teams underperform the bottom of the league they joined. On the very first match of a brand-new league, everyone defaults to `initial_rating` since there's no "current league" to peg against.

`batch_compute(matches, config)` walks the chronologically-sorted match DataFrame and:

1. For each row, before initializing any new team in this match, **snapshots `min(current ratings)`** — otherwise a brand-new home team would influence the away team's starting rating in the same row.
2. Records each team's PRE-match rating into two new columns: `home_elo_pre`, `away_elo_pre`. These are exactly what a feature engineer would have at prediction time (no leakage).
3. Applies the match outcome to both ratings via `update()`.
4. Tracks `matches_played` + `last_match_date` per team in a `TeamState` dict.

Returns `(augmented_dataframe, snapshot_dict)`. The snapshot is what `predict-and-write` uses to look up team ratings for upcoming fixtures.

**Determinism**: same input + same config → same output. Locked in by [ml/tests/test_elo_engine.py](ml/tests/test_elo_engine.py).

**4. Features** ([features/build.py](ml/scorecast_ml/features/build.py) + [features/form.py](ml/scorecast_ml/features/form.py))

`FEATURE_NAMES` is the 11-column feature matrix (column order matters — XGBoost binds to it):

```
elo_diff           = home_elo_pre + HFA - away_elo_pre
home_elo, away_elo = raw pre-match Elo ratings
home_ppg_last5, away_ppg_last5     = points-per-game over the last 5 matches
home_gf_last5, away_gf_last5       = goals-for over the last 5 matches
home_ga_last5, away_ga_last5       = goals-against over the last 5 matches
home_days_rest, away_days_rest     = days since last match, capped at 14
```

Label: `_ftr_to_label('H'→0, 'D'→1, 'A'→2)` — same column order as XGBoost's `multi:softprob` output.

**The load-bearing leakage-prevention line** is in [features/form.py](ml/scorecast_ml/features/form.py) `compute_form(team_history, as_of, last_n)`:

```python
prior = team_history[team_history['date'] < as_of]  # strict less-than
window = prior.tail(last_n)
```

If you accidentally pass today's date, you include matches that hadn't been played yet at prediction time — the canonical data leak. The function signature exists explicitly so callers must commit to an `as_of` value.

**XGBoost handles NaN natively** — early-season matches with no prior form pass through unmodified, so the first 5 matches of every team's season aren't artificially zero-filled.

The SAME builder runs at training (per-match chronological) and inference (per upcoming fixture). At inference, `history_for_form` is the **CSV history + completed current-season DB rows** (synthesized as CSV-shaped frames with `season='db'`) so rolling form stays current.

**5. Train** ([train/](ml/scorecast_ml/train/))

XGBoost defaults ([train/model.py](ml/scorecast_ml/train/model.py)):

```python
DEFAULT_PARAMS = {
    'objective':           'multi:softprob',
    'num_class':           3,
    'max_depth':           4,             # shallow trees — pre-existing tabular wisdom
    'learning_rate':       0.05,
    'subsample':           0.8,
    'colsample_bytree':    0.8,
    'reg_lambda':          1.0,
    'min_child_weight':    3,
    'tree_method':         'hist',        # fastest histogram-based
    'eval_metric':         'mlogloss',
    'seed':                42,            # determinism
}
DEFAULT_NUM_BOOST_ROUND       = 400
DEFAULT_EARLY_STOPPING_ROUNDS = 30        # patience on val mlogloss
```

**Time-based train/val/test split (NEVER random)** — random k-fold gives flattering log-loss because the model peeks at its own season's future. Production split (baked into the Dockerfile build):

- **Train**: 15 seasons (2009/10 → 2023/24) — `--train-from-season 0910 --train-last-season 2324`.
- **Val**: 2024/25 (1 season). Used for early stopping AND for fitting the isotonic calibrators (Phase 2).
- **Test**: `--test-season 2526` is set, but the 25/26 CSV isn't in the committed corpus (the season is still in progress). `train` gracefully skips the test-set metrics when the CSV is missing; honest OOS evaluation runs separately via [ml/scripts/backtest_2526.py](ml/scripts/backtest_2526.py) which pulls 25/26 finished games from the live DB.

**Walk-forward backtest results** (5-season train 2004/05–2008/09 + 1-season val 2009/10 + 15-season held-out test 2010/11–2024/25, 5,700 OOS matches): **mlogloss 0.992 vs majority-class baseline 1.065 (−0.073)**, **accuracy 51.9% vs 44.9% (+7 pp)**. On the live 25/26 season via the DB-backed backtest: mlogloss 1.037 vs baseline 1.080 (−0.043), accuracy 47.6% vs 42.4% (+5.3 pp).

**`fit_calibrators(bundle, X_val, y_val)`** (Phase 2) fits three independent `IsotonicRegression(y_min=0, y_max=1, out_of_bounds='clip')` calibrators on the raw val proba — one per class. Why hand-rolled instead of sklearn's `CalibratedClassifierCV(cv='prefit')`: that wrapper expects an estimator with `fit`, `predict_proba`, and `classes_` (sklearn API). The bundle wraps an `xgb.Booster` which doesn't satisfy that contract. The hand-rolled three-class loop is ~5 lines and we keep control of out-of-bounds clipping.

**Why val metrics are optimistic** — the calibrators are fit on the same val set early stopping used. The `val_uncalibrated` metric is captured before calibration and reported alongside the post-calibration `val` so reviewers can see the shift. The honest evaluation lives in `backtest_2526.py`.

**6. Inference + write** ([inference/](ml/scorecast_ml/inference/) + [db/writer.py](ml/scorecast_ml/db/writer.py))

The CLI `_build_inference_context(league)` does the heavy lifting:

1. `load_latest_bundle(league)` — finds the most recent `{league}_YYYY-MM-DD.joblib` matching the **strict canonical regex**. Suffixed variants (`{league}_YYYY-MM-DD_hfa0.joblib` from `--model-suffix hfa0` runs) are **deliberately ignored** — they're A/B artifacts, not production. To load one explicitly, call `load_bundle(path)`.
2. Reads cached CSVs for the league via `parse_csv` → `reconcile_dataframe`.
3. Opens a Postgres connection and:
   - `fetch_league_by_code(conn, code='PL')` — looks up by `sourceLeagueId` (the football-data.org code), NOT internal UUID. Same code the frontend's URL uses.
   - `fetch_completed_for_league` — `status='finished' AND homeScore IS NOT NULL`. Returns dict rows via `psycopg.rows.dict_row`.
   - `fetch_upcoming_for_league(horizon_days=10_000)` — `status='scheduled' AND date > now() AND date < now() + horizon`. The CLI clips the result downstream to `horizon_days=7` by default.
4. Synthesizes DB completed rows as CSV-shaped frames (with `season='db'`) and concatenates with CSV history.
5. Walks Elo over the FULL chronological history (CSV + DB combined) — sub-second on ~6 seasons. **No incremental snapshot today** — Phase 2 / future work could swap to a cached snapshot + incremental tail update.
6. Returns `(bundle, bundle_path, upcoming_df, full_history, elo_state)`.

Then `predict_upcoming(...)` ([inference/predict.py](ml/scorecast_ml/inference/predict.py)):

1. Builds inference features for each upcoming row via `build_inference_features` (same code path as training).
2. Calls `bundle.predict_proba(X)` which:
   - Calls `predict_proba_raw` first (uncalibrated XGBoost).
   - If `bundle.calibrators` is set: applies each per-class isotonic regression.
   - **Clips every probability to `[0.01, 0.99]`** — the 0.01 floor is exactly the DECIMAL(3,2) DB column floor. Without this clip, isotonic's lower-bound 0 mapping (which fires on lopsided matches like Arsenal-vs-Burnley) reaches the DB as a literal `0.00`. Locked in by [ml/tests/test_calibration.py](ml/tests/test_calibration.py) `test_calibrated_output_clipped_off_zero_and_one`.
   - **Renormalizes per row** so probabilities sum to 1.0 after the clip.
3. For each prediction, calls `to_three_way(p_h, p_d, p_a)` which:
   - Validates each value is in `[0, 1]`.
   - Tolerates up to 5% drift from sum-to-1 and silently re-normalizes (post-calibration imprecision); raises on >5% drift (broken model output).
   - Rounds each class to 2 decimals; the rounding residual is absorbed by **the class with the largest RAW probability** (not the largest rounded value — preserves the model's intended ordering through close-rounded ties).
   - Nudges off the `(0.50, 0.00, 0.50)` sentinel if the rounded trio lands there (direction taken from the raw pre-rounding pair; home-favored by default).
4. Returns a DataFrame with the original upcoming columns plus `p_home`, `p_draw`, `p_away` (raw) and `home_out`, `draw_out`, `away_out` (write values).

**HTTP writer** ([db/writer.py](ml/scorecast_ml/db/writer.py)) — `write_probabilities(rows, *, overwrite_existing, dry_run) → WriteResult`:

```
@dataclass
class WriteResult:
    written: int                                       # successful PUTs
    skipped: int                                       # sentinel non-match
    failed: int                                        # HTTP errors / non-200
    failures: list[tuple[game_id, status, body_snippet]]
    skipped_ids: list[str]
```

Auth flow mirrors [tests/e2e/helpers/api.js](tests/e2e/helpers/api.js) `apiLogin`:

1. **`_login(client)`** — POST `/api/login` once per `write_probabilities()` call. The response sets `sc_access` (HttpOnly) + `sc_refresh` + `sc_csrf` cookies on the `httpx.Client`. Extract the `sc_csrf` cookie value into the writer's static header dict. `/api/login` is rate-limited at 5/15 min/IP so **looping login per row would 429 the job** — the single-login pattern is load-bearing.
2. For each row, **sentinel check** via `_is_sentinel(home, draw, away)` against the DB-current probabilities (read in step 3 of `_build_inference_context`). Tolerance `_SENTINEL_TOL = 0.001`. If non-sentinel and `not overwrite_existing` → skip + record in `skipped_ids`.
3. **PUT `/api/admin/games/:id`** with `X-CSRF-Token: <sc_csrf>` header. `httpx.Client` carries the auth cookies automatically.
4. HTTP timeout 15 s. Connection errors and non-200 responses are recorded in `failures[]` and don't block subsequent rows. The CLI surfaces the first 5 failures to the operator and exits non-zero if any failure occurred.

**Dry-run mode** (`--dry-run`) — runs the sentinel check, logs what would be written, but issues no HTTP requests. Login is skipped too. Useful for verifying skip-existing logic without touching the API.

#### CLI surface ([scorecast_ml/cli.py](ml/scorecast_ml/cli.py))

Invocation: `python -m scorecast_ml <subcommand>` or `cd ml && python -m scorecast_ml <subcommand>`. Built on `typer`; `--help` works on every subcommand.

| Subcommand                                                                                                                                                            | What it does                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingest --league PL --seasons 9394-2425 [--force-redownload]`                                                                                                         | Download + cache Football-Data.co.uk CSVs for a season range. `--seasons` accepts a range (`9394-2425`) or a single code (`2425`)                                                                    |
| `reconcile --league PL [--dry-run]`                                                                                                                                   | Walk every team name in the cached CSVs against `teams.json`. **Fails loudly** (exit 2) on any unmatched name. `--dry-run` prints the full mapping table without erroring                            |
| `elo --league PL`                                                                                                                                                     | Compute Elo from cached CSVs and save a snapshot to `data/elo/{league}_{as_of}.parquet`. Prints top-5 teams by rating                                                                                |
| `train --league PL [--train-from-season 0910] [--train-last-season 2324] [--val-season 2425] [--test-season 2526] [--hfa 0] [--no-calibration] [--model-suffix hfa0]` | Train a model. Time-based split. Saves `{league}_{data_through}.joblib` + `.meta.json`. `--model-suffix` appends to the filename — useful for ablations that `load_latest_bundle` should NOT pick up |
| `predict --league PL [--horizon-days 7] [--out predictions.json]`                                                                                                     | Predict upcoming fixtures. **No DB writes**. Prints a table; optional `--out` writes JSON                                                                                                            |
| `predict-and-write --league PL [--horizon-days 7] [--dry-run] [--overwrite-existing]`                                                                                 | Predict + push via `PUT /api/admin/games/:id`. Skips non-sentinel rows unless `--overwrite-existing` is set                                                                                          |

There is **no `pipeline` composite command** — each step runs separately so failures are surfaced early and intermediate state stays inspectable on disk.

#### Configuration ([scorecast_ml/config.py](ml/scorecast_ml/config.py))

`pydantic-settings`-based `Settings`, env-prefix `SCORECAST_`, optionally loads `.env` from the working directory:

| Env var                  | Default                 | Purpose                                                                                                                                                                                                  |
| ------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCORECAST_ML_USERNAME`  | `ml_pipeline`           | Admin user the writer authenticates as. **Must match `^[A-Za-z0-9_]+$`** — the Node API's regex rejects hyphens, so `ml-pipeline` would 400 at registration. Older docs that say `ml-pipeline` are wrong |
| `SCORECAST_ML_PASSWORD`  | `""`                    | Password for the admin user. Writer raises `RuntimeError` if empty rather than attempting an empty-password login                                                                                        |
| `SCORECAST_API_BASE_URL` | `http://localhost:3000` | Base URL for the writer's HTTP client. Set to `https://bantryx.com` in the prod Container Apps Job; the Bicep module also accepts the FQDN fallback before custom-domain is set                          |
| `SCORECAST_DB_URL`       | `""`                    | Same connection string as the Node app's `DATABASE_URL`. Includes `?sslmode=require` against Azure Postgres                                                                                              |
| `SCORECAST_LOG_FORMAT`   | `""` (auto)             | `pretty` or `json`. structlog picks `json` automatically in prod                                                                                                                                         |
| `SCORECAST_DATA_ROOT`    | `""` (auto)             | Override for `ml/data/`. Default resolves relative to the package                                                                                                                                        |

The `Settings` instance is cached via `get_settings()` (module-level singleton).

#### Model bundle + metadata format

`ModelBundle` ([train/model.py](ml/scorecast_ml/train/model.py)) — a dataclass containing the XGBoost booster + everything needed to reproduce a prediction:

- `model`: the trained `xgb.Booster`.
- `feature_names`: list — bound to column order; `predict_proba_raw` re-orders incoming DataFrames to match.
- `trained_at`: ISO 8601 UTC timestamp.
- `data_through_date`: ISO 8601 date — the most recent match in training, used in the filename.
- `league_code`: e.g. `PL`.
- `metrics`: dict carrying `val_uncalibrated`, `val`, `test` (if test set was non-empty), `baseline_test`, `elo_config`, `split_summary`, `calibrated` bool.
- `git_sha`: short git SHA captured at train time (via `subprocess`; tolerates running outside a git workdir).
- `params`: the final XGBoost param dict (DEFAULT_PARAMS merged with overrides).
- `num_boost_round`, `best_iteration`: training caps + early-stopping result.
- `calibrators`: list of 3 `IsotonicRegression` or `None` (graceful `getattr` fallback for pre-Phase-2 pickles).

Saved as **`{league}_{data_through}.joblib`** + sibling **`.meta.json`** under `ml/data/models/`. The `.meta.json` is human-readable so you can diff models without firing up Python — useful for verifying a CD-built model is what you expected.

**`load_latest_bundle(league)` strict canonical regex**: `^{league}_\d{4}-\d{2}-\d{2}\.joblib$`. Suffixed variants are deliberately ignored. The four committed variants in [ml/data/models/](ml/data/models/) — `PL_2025-05-25.joblib` (canonical), `_hfa0`, `_hfa65`, `_5season_uncal` — illustrate the pattern: only the unsuffixed name becomes production via `load_latest_bundle`.

#### Walk-forward correctness invariant

Features for any match are built **from data strictly dated BEFORE that match**:

- Elo's `home_elo_pre` / `away_elo_pre` columns are the pre-match snapshot (captured BEFORE the rating is updated for the current row in `batch_compute`).
- Form's `compute_form(team_history, as_of)` does `team_history[team_history['date'] < as_of]` — strict less-than.

The [ml/scripts/backtest_2526.py](ml/scripts/backtest_2526.py) backtest combines CSV history with DB 25/26 finished games and re-runs Elo across the whole chronological set — each 25/26 prediction uses only matches dated strictly before it.

**Don't shortcut this** — computing form against the full match list as-of-today gives flattering log-loss with no out-of-sample value. This is the canonical data leak.

#### Local invocation workflow

Useful for dry-runs, ablations, and one-off retrains. Production runs in the Container Apps Job; local runs hit your laptop.

1. **Provision an `ml_pipeline` admin user** in the running app (UI Register form, then Admin tab promote to admin). Username regex `^[A-Za-z0-9_]+$` at [validation/schemas.js:11](validation/schemas.js#L11) — underscore is allowed, hyphen is not.
2. **Python env**: `cd ml && python -m venv .venv && pip install -r requirements.txt`. Python 3.14 in prod; 3.11+ locally is fine. Top-level deps: `httpx`, `tenacity`, `pandas`, `numpy`, `pyarrow`, `xgboost`, `scikit-learn`, `joblib`, `rapidfuzz`, `psycopg[binary]`, `pydantic-settings`, `structlog`, `typer`, `python-dateutil`.
3. **`.env`**: copy `.env.example` and fill `SCORECAST_ML_PASSWORD` + `SCORECAST_DB_URL` (same URL as the Node app's `DATABASE_URL`; against local Postgres usually `postgres://postgres:postgres@localhost/scorecast_db`).
4. **Pipeline run**:
   ```bash
   python -m scorecast_ml ingest --league PL --seasons 9394-2425
   python -m scorecast_ml reconcile --league PL
   python -m scorecast_ml elo --league PL
   python -m scorecast_ml train --league PL
   python -m scorecast_ml predict-and-write --league PL --dry-run
   python -m scorecast_ml predict-and-write --league PL
   ```

See [ml/ONBOARDING.md](ml/ONBOARDING.md) for the per-league onboarding playbook (La Liga / Bundesliga / Serie A / Ligue 1).

#### Production deployment (Phase 3, shipped)

Azure Container Apps Job on a daily cron. Three components:

**Image** ([ml/Dockerfile](ml/Dockerfile)) — 3-stage build:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 1 — base (python:3.14-slim)                                    │
│   apt: libgomp1 (xgboost OpenMP runtime) + tini                      │
│   pip: requirements.txt                                              │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 2 — train                                                       │
│   COPY scorecast_ml + data/raw (the CSV corpus)                       │
│   RUN python -m scorecast_ml train --league PL \                      │
│         --train-from-season 0910 --train-last-season 2324 \           │
│         --val-season 2425 --test-season 2526                          │
│   Output: /app/data/models/PL_<date>.joblib + .meta.json              │
│   Deterministic (seed=42 + committed CSVs) → bit-identical models     │
│     on no-op pushes                                                   │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 3 — runtime                                                     │
│   useradd uid=1001 app                                                │
│   COPY scorecast_ml + scripts + data/raw                              │
│   COPY --from=train /app/data/models ./data/models                    │
│   USER app                                                            │
│   ENTRYPOINT ["/usr/bin/tini", "--"]                                  │
│   CMD ["python", "-m", "scorecast_ml", "predict-and-write",           │
│        "--league", "PL", "--horizon-days", "7"]                       │
└─────────────────────────────────────────────────────────────────────┘
```

Built + pushed to ACR repo **`scorecast-ml`** (separate from the Node app's `scorecast` repo) by [.github/workflows/ml-deploy.yml](.github/workflows/ml-deploy.yml) on `ml/**` changes. The two CD workflows never touch each other's repo. **Retraining = rebuilding the image** — deterministic build means git push is the canonical retrain trigger.

**Job** ([infra/modules/ml-job.bicep](infra/modules/ml-job.bicep)) — Azure Container Apps Job:

- Name: `scorecast-ml-job`.
- `triggerType: Schedule` with cron expression `30 2 * * *` (5-field standard cron, UTC) → **daily at 02:30 UTC**.
- System-assigned managed identity with `AcrPull` on the ACR + `Key Vault Secrets User` on the vault.
- Reads `database-url` + `ml-pipeline-password` from Key Vault via `secretRef`. The `ml-pipeline-password` secret is provisioned by the module from the `mlPipelinePassword` Bicep param — **required on every Bicep reapply** (same pattern as `pgAdminPassword`).
- Sets env vars `SCORECAST_DB_URL`, `SCORECAST_ML_PASSWORD`, `SCORECAST_API_BASE_URL`, `SCORECAST_ML_USERNAME=ml_pipeline`.
- Resources: 0.5 vCPU + 1 GiB. Typical execution time <60 s. Logs flow to the shared Log Analytics workspace.

**Cron offset rationale** — 02:30 UTC daily sits:

- **30 min ahead of the Node app's daily fixture sync at 03:00 UTC**, so the two jobs never race on the same row. This is the load-bearing offset — don't move the ML job into the 03:00–03:05 window.
- Outside the 60-s live-score poll's active window (PL kickoffs are 12:00–22:00 UTC; 02:30 is always between fixtures, including midweek competitions).
- Pre-PL-gameweek when run on a Thursday morning (PL fixtures cluster Fri–Sun). Pre-midweek-fixtures when run on a Tue/Wed morning (Champions League etc.). Pre-anything when run any other day.

**Idempotency** — `predict-and-write` skips games whose probabilities aren't the `(0.50, 0.00, 0.50)` sentinel, so re-firing on the same fixtures is a no-op. Daily runs therefore stack cleanly: each one only writes to (a) newly-synced fixtures still on the sentinel and (b) cancelled/postponed fixtures that got rescheduled and reset.

**Cost** — ~$0.07/mo at the daily cadence (~60s × 0.5 vCPU × 1 GiB × 30 runs/mo on Consumption pricing). Up from the weekly's ~$0.01/mo. Trivial.

**Manual ad-hoc runs** work on a Schedule-triggered Job:

```bash
az containerapp job start --name scorecast-ml-job --resource-group scorecast-prod
```

**Custom-args runs** (e.g. `--overwrite-existing`, a different league, longer horizon) — `az containerapp job start --args` does NOT work because the CLI parser greedily eats `--`-prefixed values. Use the `az rest` REST-API recipe in [ml/README.md → Ad-hoc runs with custom args](ml/README.md). Per-execution overrides are a full container replace (not a merge), so the body must carry over `image`, `resources`, AND `env` from the deployed template or the container starts without secret refs and dies on startup.

#### Runtime cadences — three independent moving parts

```
┌──────────────┬────────────────────────────┬──────────────────────────────────┐
│ Part         │ Cadence                    │ Trigger                          │
├──────────────┼────────────────────────────┼──────────────────────────────────┤
│ Elo ratings  │ Every predict-and-write    │ Each Job execution rebuilds      │
│              │ invocation (sub-second)    │ from scratch (CSV + DB completed)│
│              │                            │ → yesterday's finished match     │
│              │                            │   shows up in tomorrow's writes  │
├──────────────┼────────────────────────────┼──────────────────────────────────┤
│ Probabilities│ Daily 02:30 UTC            │ Scheduled Job. Idempotent skip-  │
│              │ (~30 runs/mo)              │ existing → daily stack cleanly,  │
│              │                            │   only new sentinel rows written │
├──────────────┼────────────────────────────┼──────────────────────────────────┤
│ Model bundle │ Every push to main         │ ml-deploy.yml rebuilds the image,│
│              │ touching ml/**             │ Stage 2 retrains. Deterministic  │
│              │                            │ → no-op pushes = bit-identical   │
│              │                            │ Natural retrain: end-of-season   │
│              │                            │ (add new CSV under data/raw/,    │
│              │                            │ roll season flags in Dockerfile) │
└──────────────┴────────────────────────────┴──────────────────────────────────┘
```

Within-season adaptation happens via Elo + form (every day at 02:30 UTC); the XGBoost weights themselves are stable between annual rebuilds. This is the right cadence — the model captures slow structural priors (style of play, squad tier), Elo captures fast match-by-match shifts. Daily probability writes mean a Tuesday-night Champions League result lands in Wednesday's predictions automatically, without a manual ad-hoc trigger.

#### How the writes land in Bantryx

End-to-end daily timeline (the same loop, repeated every 24h):

```
Continuous : Live matches finish → status='in-progress' → 'finished'
             via lib/jobs/syncLiveScores.js (60-s cron). Scores +
             results land in DB throughout the day.

03:00 UTC  : Node app's daily fixture sync (cron `0 3 * * *`) pulls
   (prior     fresh upcoming fixtures from football-data.org. New
    day)      fixtures land in `games` with sentinel probabilities
             (homeProbability=0.50, drawProbability=0.00,
              awayProbability=0.50).

02:30 UTC  : scorecast-ml-job fires (30 min ahead of THAT day's 03:00
             fixture sync; works on fixtures synced the previous day).
             1. Login as ml_pipeline (POST /api/login).
             2. Read upcoming + completed from DB (psycopg).
             3. Rebuild Elo (CSV + DB merge — uses yesterday's
                finished matches automatically).
             4. predict_proba → to_three_way → rounded trios.
             5. For each upcoming fixture (next 7d): sentinel-check,
                PUT /api/admin/games/:id with {home, draw, away}Probability.
                **Already-written fixtures are skipped** — only the
                rows still on the sentinel get the new write. Daily
                cadence stacks cleanly.
             6. Each PUT triggers auditMutation → audit_log row.
             7. PUT to /admin/games/:id flows through GameService
                update; LeaderboardService.invalidate fires as standard
                precaution (no in-flight picks are affected since
                probabilities only matter at result-set time).

Throughout : Users visit Bantryx. GameCard renders:
             - PayoutMatrix preview uses (home, draw, away)Probability
               via expectedWinPoints / expectedDrawPoints in
               src/utils/scoring.js.
             - Pick buttons show "+25 / +75" style preview.
             - Outcome badge on locked picks shows the eventual
               points payout via scorePick.
             User picks lock at game.date.

Post-match : Live matches → finished. scorePick computes per-pick
             points via the now-real probabilities; pick-scored
             notifications fire; leaderboard reflects skill-weighted
             standings.
```

#### Schema additions (post-draw-scoring tier)

- `games.drawProbability DECIMAL(3,2) NOT NULL DEFAULT 0` (migration [20260518000008-games-add-draw-scoring.js](migrations/20260518000008-games-add-draw-scoring.js)).
- `games.result` enum extended to `('home', 'away', 'draw')` via `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'draw'`.

The pipeline writes all three probability columns via the `to_three_way` path. Each write is audit-logged through the existing `audit_log` table via the `auditMutation('admin.game.update', 'game')` middleware already wrapping the `PUT /api/admin/games/:id` route. No new tables, no new endpoints.

The legacy 2-class `to_two_way` + `(0.50, 0.50)` sentinel is preserved in [normalize.py](ml/scorecast_ml/inference/normalize.py) for ablation scripts under [ml/scripts/](ml/scripts/) but is off the live write path.

#### Operator quirks (top of mind)

1. **Username is `ml_pipeline`, NOT `ml-pipeline`** — the Node API's `^[A-Za-z0-9_]+$` regex rejects hyphens. Stale docs that say `ml-pipeline` are wrong; fix on sight.
2. **`load_latest_bundle` is strict** — only matches `{league}_YYYY-MM-DD.joblib`. Suffix variants (`_hfa0`, `_hfa65`, `_5season_uncal`) are ignored. Load by explicit path for ablations.
3. **`--model-suffix` is for A/B work, not production** — it produces non-canonical filenames that `load_latest_bundle` won't pick up. The natural workflow is: train a candidate with `--model-suffix candidate`, eval it manually, drop the suffix and retrain when promoting.
4. **Login is rate-limited; loop ONE login per `write_probabilities()` call** — `/api/login` has `loginLimiter` (5/15 min/IP). The writer does a single login at startup and reuses the cookie jar for all PUTs.
5. **`/api/login` returns CSRF only if the response sets it** — the writer raises if `sc_csrf` isn't on the response. Don't try to fall back to `/api/auth/refresh` here — that path is exempt from CSRF and won't seed the cookie either way.
6. **Calibrator clip is load-bearing**, not defensive — isotonic regression maps low raw values to literal 0 at its training-range floor. DECIMAL(3,2) rounds anything below 0.005 to 0.00. Clipping at 0.01 keeps the rounded floor at 0.01. Locked in by `test_calibrated_output_clipped_off_zero_and_one`.
7. **Val mlogloss reported AFTER calibration is by-design optimistic** — calibration is fit on the same val set. `bundle.metrics.val_uncalibrated` is the unbiased comparator. The honest OOS check is `scripts/backtest_2526.py`.
8. **HFA default is 0** — set deliberately, not by mistake. Pass `--hfa 65` to reproduce conventional Elo. The ablation in `scripts/compare_hfa.py` showed it's a structural no-op for tree-based models.
9. **Promoted-team rating defaults to `min_rating`** — captures the empirical "promoted teams underperform the bottom of their new league." Pass `EloConfig(promoted_team_strategy='initial')` for vanilla Elo.
10. **Pre-Phase-2 bundles don't have `calibrators`** — `getattr(self, 'calibrators', None)` fallback in `predict_proba` handles them gracefully. Don't drop the fallback.
11. **Sentinel skip is on the DB-CURRENT value**, not the new one — `predict-and-write` queries `homeProbability`, `drawProbability`, `awayProbability` from the upcoming row and skips if they're the sentinel. Means a previously-ML-written game won't be rewritten without `--overwrite-existing` even if the new prediction is wildly different.
12. **`az containerapp job start --args` greedily eats `--`-prefixed values** — for ad-hoc custom-arg runs (e.g. `--overwrite-existing`) use the `az rest` REST-API recipe in [ml/README.md](ml/README.md). Per-execution overrides are a full container replace, so the body must carry `image`, `resources`, AND `env` from the deployed template.
13. **Bicep reapply requires `mlPipelinePassword`** — same pattern as `pgAdminPassword`. Skipping it flips the Job back to the placeholder bootstrap image. See CLAUDE.md "Bicep reapply requires 6 params" for the full list.
14. **CSVs in git are tracked**, scratch files aren't — the [.gitignore](.gitignore) negation rule `!ml/data/raw/*.csv` allows CSVs while blocking `ml/data/raw/*.parquet` / `*.json` / etc. **Don't drop non-CSV scratch under `ml/data/raw/`** or it'll silently slip into git.
15. **`scorecast-ml` and `scorecast` are SEPARATE ACR repos** — same Container Registry, different repos. Node's `deploy.yml` only pushes to `scorecast:*`; ML's `ml-deploy.yml` only pushes to `scorecast-ml:*`. The two CDs never collide.
16. **`predict-and-write` writes only to `status='scheduled'` games** — `fetch_upcoming_for_league` filters on status. In-progress / finished / postponed games are never touched.
17. **`fetch_league_by_code` looks up by `sourceLeagueId`** (e.g. `'PL'`), not by internal UUID. Matches the URL-stable identifier used everywhere else.
18. **Test coverage**: 48 tests across [ml/tests/](ml/tests/) — Elo determinism (`test_elo_engine.py`), normalize sum-to-1 + sentinel-nudge (`test_normalize.py`), calibrator clip + sum-to-1 (`test_calibration.py`), reconcile manual/fuzzy/error paths (`test_reconcile.py`). Run via `pytest` from `ml/`.

#### Known limits + forward path

- **Isotonic calibration** ✅ shipped (Phase 2). Per-class `IsotonicRegression` fit on val, attached to `ModelBundle.calibrators`. Applied automatically inside `predict_proba` with `[0.01, 0.99]` clip + renormalize.
- **Automated cron** ✅ shipped (Phase 3, daily as of 2026-05-18). Container Apps Job runs every day at 02:30 UTC.
- **Draw scoring** ✅ shipped (post-tier). Pipeline writes all 3 probabilities via `to_three_way`. Pick semantics stay winner-only.
- **Single-league models** — one model per league, no shared pool. La Liga / Bundesliga / Serie A / Ligue 1 each need their own training runs + `teams.json` alias extension + ingest + reconcile + train + predict-and-write. The pipeline is league-agnostic by design; per-league work is mostly data, not code.
- **No incremental Elo snapshot** — `_build_inference_context` rebuilds Elo from scratch on every prediction. Sub-second on ~6 seasons; would matter at 10x league coverage. Phase N+1 cache invalidation would key on (league, max(completed_match_date)).
- **No pick-type expansion** — winner-only picks. Spread / over-under / score prediction (deferred from Tier 4b) would need their own probability columns + scoring branches. The pipeline's `multi:softprob` output already carries goal-difference signal via Elo; a future GD-prediction model would reuse the same feature pipeline.
- **No xG / lineup features** — Phase N+ might layer xG from a paid provider, or team-strength deltas from injuries / suspensions. Both require provider access; both would land as additional columns in `FEATURE_NAMES`.
- **No per-user calibration** — pipeline outputs are uniform across viewers. A future personalization layer would shift expected payouts per user (e.g. user A consistently picks underdogs; the EV display would change for them).

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

The flow that turns football-data.org events into ScoreCast UI updates. Already covered architecturally in §8.16 + §5.5; this section captures the operational lifecycle.

```
       ┌──────────────────────────────────────────────┐
       │ football-data.org v4                          │
       │   GET /v4/matches?status=LIVE,IN_PLAY,PAUSED  │
       │   GET /v4/matches?ids=...   (reconcile pass)  │
       └─────────────────────┬────────────────────────┘
                             │ (60 s ticks; rate-limited 10 req/min)
                             ▼
       ┌──────────────────────────────────────────────┐
       │ lib/jobs/syncLiveScores.js                    │
       │   • register via scheduler.register()         │
       │   • each tick: pg_try_advisory_lock(crc32)    │
       │   • global LIVE call + filter to active leagues│
       │   • reconcile pass for local 'in-progress'    │
       │     rows whose sourceId is missing from LIVE  │
       │     (catches IN_PLAY → FINISHED) + local      │
       │     'scheduled' rows with kickoff > 15 min ago│
       │     (catches SCHEDULED → IN_PLAY missed ticks)│
       └─────────────────────┬────────────────────────┘
                             │
                             ▼  per match:
       ┌──────────────────────────────────────────────┐
       │ services/GameService.applyLiveUpdate           │
       │   newStatus = mapUpstreamStatus(upstream)      │
       │   newResult = deriveResultFromFixture(...)     │
       │              // only if localGame.result==null │
       │   if (unchanged) return early                  │
       │   BEGIN TX                                     │
       │     update games {status, scores, result,      │
       │                    halfTimeReached, phase}     │
       │   COMMIT                                       │
       │   if transitioned to finished:                 │
       │     for each pick on this game:                │
       │       NotificationService.notify('pick-scored')│
       │       BadgeService.evaluateBadges()            │
       │     LeaderboardService.invalidate('all')       │
       └─────────────────────┬────────────────────────┘
                             │ DB
                             ▼
       Next client refreshGames picks up the new state. NotificationBell's 30s
       poll surfaces the pick-scored notification within ~30 s of the cron tick.
```

**Cost**: $0/mo (free tier — 10 req/min budget; one LIVE call per minute leaves 9 req/min for the daily fixture sync + manual admin syncs).

**Multi-replica safety**: `pg_try_advisory_lock(crc32(jobName))` ensures only one replica runs each tick. `crc32` is deterministic + stable across deploys. Lock always released via `finally`.

**`NODE_ENV=test` opt-out**: `scheduler.start()` is a no-op so Playwright doesn't spawn surprise jobs.

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
        ▼  server:
   game.result = 'home'; game.save()
   for each pick on this game:
     scorePick(pick, game) → N
     notify(pick.userId, 'pick-scored', 'Your pick on X vs Y: ✓ Correct +N pts')
     evaluateBadges(pick.userId)     ───── may award first-win, correct-N, upset-specialist
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
  │     TX: update games {status, homeScore, awayScore, result, halfTimeReached, phase}
  │     POST-COMMIT (outside tx):
  │       if just transitioned to 'finished' AND result was null → now set:
  │         for each pick on this game:
  │           NotificationService.notify('pick-scored', '... Drew/Won/Missed +N pts')
  │           BadgeService.evaluateBadges()
  │         LeaderboardService.invalidate('all')
  └─ reconcile pass: for in-progress local games not in the LIVE response,
       and scheduled local games with kickoff > 15 min ago:
       footballApi.getMatchesByIds([...]) → applyLiveUpdate (same flow)
```

Frontend picks up the update on the next `refreshGames` call (after pick / undo / admin action) or on a manual tab switch. Notifications surface via NotificationBell's 30 s poll. No WebSocket/SSE today.

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
47. **Tier 4b — football-data.org rejects repeated `?status=X&status=Y`**: wants comma-separated `?status=X,Y,Z`. [lib/footballApi.js](lib/footballApi.js) `getLiveMatches()` uses the comma form; switching back to repeated params is a 400.
48. **Tier 4b — `games.leagueId NOT NULL`**: enforced by [migration 20260518000007-games-tighten-league-not-null.js](migrations/20260518000007-games-tighten-league-not-null.js). New games created via admin must always have a `leagueId`. The legacy "synthetic Legacy / Imported league" catches the case where admin forgets, but the schema requires it.
49. **Tier 4b Chunk 3 — `auditMutation(...)` ordering**: wrap routes BEFORE `validate(...)` so the audit trail captures the raw inbound payload (not the zod-coerced version). Action strings use the dotted shape `admin.<entity>.<verb>` — keep the prefix consistent so the audit-log UI can filter cleanly. Auth-failed admin attempts (401/403 thrown before `auditMutation` runs) are NOT audited by design.
50. **Tier 4b Chunk 3 — Audit log `actorUserId` SET NULL on user delete**: history survives admin removal. **Don't change to CASCADE** — losing audit history when admins leave defeats the whole point.
51. **Tier 4b Chunk 3 — `audit_log` payload truncation is 4KB**: [services/AuditLogService.js](services/AuditLogService.js) `truncatePayload()` replaces oversize payloads with `{_truncated: true, _bytes, preview: 'first 512 chars'}`. The middleware fires via `res.on('finish')` and **NEVER throws back into the request lifecycle** — an audit-log outage cannot block a real admin action.
52. **Security batch H1 — `app.set('trust proxy', 1)`**: critical for per-IP rate limiters and lockout to see real client IPs through Cloudflare → Azure Container Apps. **Don't switch to `app.set('trust proxy', true)`** — that trusts every hop in `X-Forwarded-For`, letting an attacker spoof an arbitrary IP. The `1` means "trust one hop" (the Azure ingress).
53. **Security batch H2 — `LOGIN_DUMMY_HASH` is generated once at module load**: the constant-time login path runs `bcrypt.compare` against the real user hash OR the dummy hash. If you ever inline-generate the dummy hash inside the request handler, you reintroduce the timing leak. Same module-load constant pattern would apply to any future "constant-time check" use case.
54. **Security batch M4 — `algorithms: ['HS256']` pinning**: every `jwt.verify` call site MUST pass the algorithm allowlist (`middleware/auth.js`, `middleware/optionalAuth.js`, `routes/auth.js` for 2FA challenge, `routes/client-errors.js`). jsonwebtoken@9 already rejects `alg:none` by default, but pinning is belt-and-braces against future regression.
55. **Security batch L5 — Recovery code verify is constant-time**: `Promise.all(codes.map(bcrypt.compare))` instead of an early-exit `for` loop. **Don't "optimize" to early-exit** — the matched slot would become inferrable from response time.
56. **Per-endpoint API suite — `closeDb()` in afterAll**: spec files MUST NOT call `closeDb()` in `afterAll`. `workers:1` shares the Sequelize pool; closing it stalls every later spec. Each spec only resets the tables it touches via DB helpers in [tests/e2e/helpers/api.js](tests/e2e/helpers/api.js).
57. **Per-endpoint API suite — Seed CSRF cookie before assertUnauthorized**: `assertUnauthorized` for state-changing routes must seed an `sc_csrf` cookie via a throwaway GET first; otherwise the assertion lands on CSRF (403) rather than auth (401). The helper handles this internally — `apiAnon()` returns a context that already has the cookie set.

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
- **Bicep custom domain — reconciled (Tier 9-followup, 2026-05-16)**: the `bantryx.com` hostname binding + managed cert (`mc-scorecast-env--bantryx-com-8689`) + `CORS_ORIGINS`/`PUBLIC_APP_URL` env-var overrides are now captured in Bicep. [infra/modules/app.bicep](infra/modules/app.bicep) writes `properties.configuration.ingress.customDomains: [{name, bindingType:'SniEnabled', certificateId}]` when `customDomain` is non-empty; the env vars pivot on the same `customDomain` param. Full IaC reapply requires `customDomain=bantryx.com`, `customDomainCertId=<discovered>`, and `pgAdminPassword=<live-pw>` (cert ID is discoverable via `az containerapp env certificate list`). DNS stays on Cloudflare — the `dns.bicep` module that would create an Azure DNS zone is gated behind a `useAzureDns=false` default. Verified idempotent against the live state via `az deployment group what-if`.

---

## 12. Known Limitations & Technical Debt

| Area                         | Issue                                                                                                                                                                                                                                                                                                           | Tier                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Tests below E2E              | Playwright covers 270 tests across 22 specs (10 UI/flow + 14 per-endpoint API + 2 panel smokes); no unit / integration tests below the Playwright layer. Tradeoff acknowledged — the API suite hits the real route stack against a real DB, so the unit-test gap is mostly philosophical                        | future                    |
| Pick types                   | Only winner picks; no spread / over-under / score prediction. Deferred from Tier 4b after live-score UX bedded in. Draws now award partial credit (post-draw-scoring tier) but the pick semantic stays `home`/`away` only                                                                                       | future (post-4b)          |
| Match minute is approximate  | football-data.org free tier doesn't expose `minute` / `injuryTime`. Client estimates from kickoff + `halfTimeReached` + `phase` signals. Soft by ~5 min around halftime. Swap to paid provider via [lib/footballApi.js](lib/footballApi.js) for an authoritative timer                                          | future (provider swap)    |
| Streaks                      | Deferred — concurrent kickoffs make "consecutive correct" ambiguous (revisits when streak badges become a real product ask)                                                                                                                                                                                     | future                    |
| Audit log before-state       | Middleware records `after` payload only; `before` for updates/deletes would need per-entity pre-fetch hooks. Auth-failed admin attempts (401/403 thrown before middleware runs) are not audited                                                                                                                 | future                    |
| Real-time                    | No WebSocket/SSE; everything is HTTP polling at 30 s. Reaction count changes don't propagate across viewers in real time. Live-score updates land via the 60-s server cron + next-`refreshGames` on the client                                                                                                  | 7                         |
| Notification spam            | Bulk-setResult + live-score auto-finalization fan-out per-pick on result transition — no batching/dedup. A big upset on a popular fixture produces many notifications in one request                                                                                                                            | 7                         |
| Cache scope                  | `leaderboardCache` + fixture cache + rate-limit + lockout counters are all in-process Maps. A multi-instance deploy would see stale reads across replicas. Refresh-token rows are in Postgres so sessions survive a restart, but the in-memory caches don't. Today the app runs single-instance so this is fine | Tier 10.4 (Redis backend) |
| Server-side log shipping     | pino → stdout → Container Apps → Log Analytics workspace (Tier 9.6). Application Insights resource is provisioned but its SDK isn't wired into app code yet. Sentry covers errors but not access logs                                                                                                           | Tier 10.6                 |
| Health / readiness probes    | `/healthz` exists (Tier 9.4) and is used by Container Apps liveness + readiness probes — but it doesn't ping the DB or Redis. A real readiness check (`/readyz` with DB ping) is still pending                                                                                                                  | Tier 10.1                 |
| Metrics                      | No `prom-client` / `/metrics` endpoint; no request-duration histogram, no cache hit/miss counters                                                                                                                                                                                                               | Tier 10.3                 |
| Graceful shutdown            | No SIGTERM drain. `tini` forwards SIGTERM; Node exits when the event loop drains. In-flight requests + scheduler ticks aren't given a grace window                                                                                                                                                              | Tier 10.5                 |
| Multi-device session listing | `refresh_tokens.userAgent` is captured, but there's no UI for "active sessions" or "sign me out of all devices" — the latter is implemented as `revokeAllUserRefreshTokens` but only triggered by password reset + in-session password change today                                                             | future                    |
| Reused-recovery-code warning | A second use of an already-consumed recovery code returns generic 400; no alert/notification to the user that someone else may have used a stolen code                                                                                                                                                          | future                    |
| TypeScript migration         | No TS yet; whole codebase JavaScript + JSX. Parked at end of roadmap                                                                                                                                                                                                                                            | Tier 9.10                 |
| Storybook                    | No component sandbox. Visual changes verified by running the dev server + Playwright `screenshots/mobile.spec.js`. Parked at end of roadmap                                                                                                                                                                     | Tier 9.11                 |
| Token-rule lint              | The "components must use design tokens, not raw `slate-*`/`cyan-*` literals" rule is review-only; no ESLint plugin enforces it                                                                                                                                                                                  | future                    |
| ML — single-league models    | One trained model per league; no shared pool / multi-task learning. La Liga / Bundesliga / Serie A / Ligue 1 each need their own training run + alias table extension. Pipeline is league-agnostic by design                                                                                                    | future                    |
| ML — calibration honesty     | Train-CLI reports val mlogloss AFTER calibration; that's by-design optimistic since calibration was fit on the same data it's measured on. Honest OOS check is the held-out test set ([ml/scripts/backtest_2526.py](ml/scripts/backtest_2526.py) against the in-progress DB season)                             | acknowledged              |

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
- ✅ **ML probability pipeline** — Phase 1 (PL only, manual, shipped 2026-05-17): standalone Python project at [ml/](ml/) producing `(homeProbability, awayProbability)` via Elo + XGBoost. 5-season train (2004/05–2008/09) → 15-season held-out test (2010/11–2024/25, 5,700 OOS matches): mlogloss 0.992 vs baseline 1.065 (-0.073), accuracy 51.9% vs 44.9% (+7pp). Phase 2 (isotonic calibration, shipped 2026-05-17): per-class IsotonicRegression fit on val; clip every class to [0.01, 0.99] before renormalization; 15-season train + 1-season val + held-out 25/26 test; 70-80% bucket overconfidence pulled from -7pp to -2pp deviation. Phase 3 (Azure deployment, shipped 2026-05-17; daily cadence as of 2026-05-18): `scorecast-ml-job` Container Apps Job, Schedule trigger cron `30 2 * * *` (daily 02:30 UTC, sits 30 min ahead of Node app's 03:00 UTC fixture sync; daily cadence so newly-synced fixtures get probabilities within 24h, idempotent skip-existing keeps re-runs cheap); ml-deploy.yml workflow path-filtered on `ml/**`; CSV training corpus committed to git via `.gitignore` negation; image-baked-in trained bundle. Post-draw-scoring: pipeline writes all 3 probabilities via `to_three_way` + sentinel updated to `(0.50, 0.00, 0.50)`. See §8.17.

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
