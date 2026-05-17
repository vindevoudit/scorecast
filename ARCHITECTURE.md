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

| Layer              | Choice                                                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend framework | **React 18** with hooks-only                                                                                                                                                                                                                                                                                                                              | Familiar, easy hiring, no SSR needs                                                                                                                                                                                                                                                                    |
| Build tool         | **Vite 5**                                                                                                                                                                                                                                                                                                                                                | Fastest DX for vanilla React; dev proxy avoids CORS in development                                                                                                                                                                                                                                     |
| Styling            | **Tailwind CSS 3**                                                                                                                                                                                                                                                                                                                                        | Utility classes keep components self-contained; no design-token sprawl                                                                                                                                                                                                                                 |
| HTTP client        | **`fetch`** (no axios)                                                                                                                                                                                                                                                                                                                                    | Standard; the wrapper handles JSON + auth header + 401                                                                                                                                                                                                                                                 |
| State              | **React Context + custom hooks** (Tier 13.6/13.7)                                                                                                                                                                                                                                                                                                         | Three providers: `AuthContext` (user + auth flow), `DataContext` (games/picks/groups/leaderboard/friends/profile + mutations), `NotificationContext` (toast banner). Selector hooks (`useGames`/`usePicks`/`useGroups`/etc.) keep components narrow. No Redux/Zustand.                                 |
| Backend            | **Node 18+ / Express 4**                                                                                                                                                                                                                                                                                                                                  | Tiny surface, no router framework, easy to read                                                                                                                                                                                                                                                        |
| ORM                | **Sequelize 6**                                                                                                                                                                                                                                                                                                                                           | Predictable, supports raw SQL escape hatches                                                                                                                                                                                                                                                           |
| Migrations         | **sequelize-cli + umzug** (Tier 5.1)                                                                                                                                                                                                                                                                                                                      | sequelize-cli for `npm run db:*` scripts; umzug for programmatic dev-boot execution. Versioned files under `migrations/`. See §7.3                                                                                                                                                                     |
| DB                 | **PostgreSQL**                                                                                                                                                                                                                                                                                                                                            | Need ENUMs, partial unique indexes, and `LEAST/GREATEST` functional indexes — all Postgres-specific                                                                                                                                                                                                    |
| Auth               | **HttpOnly cookie auth** (Tier 6.8): 15-min access JWT (HS256) + 30-day rotating refresh token, both via `res.cookie()`. Refresh tokens are SHA-256 hashed in `refresh_tokens` table. Bearer-header auth was removed in the same tier — there is **no token in the body** of login/register/refresh responses.                                            |
| 2FA                | **TOTP** (Tier 6.9) via `speakeasy` + `qrcode`. Opt-in per user. 10 single-use recovery codes (bcrypt-hashed, rounds 8). 5-min `sc_challenge` cookie issued between password-OK and code-OK.                                                                                                                                                              |
| Password hashing   | **bcryptjs** (cost 10)                                                                                                                                                                                                                                                                                                                                    | Pure-JS, no native build step needed on Windows                                                                                                                                                                                                                                                        |
| CSRF               | **Double-submit cookie** (Tier 6.7) via [middleware/csrf.js](middleware/csrf.js). `sc_csrf` cookie (readable) must match `X-CSRF-Token` header on POST/PUT/PATCH/DELETE; constant-time compare. Exempt list for unauthenticated mutation endpoints (login, register, password-reset, etc.). See §5.3 + §10.x.                                             |
| Security headers   | **helmet** (Tier 6.2) — CSP tuned for Vite/Tailwind (inline styles allowed; `data:` URIs for Avatars and fonts; Sentry endpoints in `connectSrc`; HMR `ws://localhost:5173` in dev only), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. COEP/COOP/CORP disabled to avoid breaking third-party assets. |
| CORS               | **Env allowlist** (Tier 6.1) via `CORS_ORIGINS` (comma-separated). Server **throws on boot** when unset in production. Dev falls back to `origin: true` if unset. `credentials: true` always.                                                                                                                                                             |
| Email              | **Resend SaaS** behind a pluggable abstraction at [lib/email.js](lib/email.js) (Tier 6.3). When `RESEND_API_KEY` is unset, `send()` logs the rendered payload to stdout — dev users grab verify/reset links from the server log. `send()` **never throws** (failures only log).                                                                           |
| Validation         | **zod**                                                                                                                                                                                                                                                                                                                                                   | Schema-first request validation; emits structured error JSON                                                                                                                                                                                                                                           |
| Rate limiting      | **express-rate-limit**                                                                                                                                                                                                                                                                                                                                    | Per-IP, in-memory. Limiters: `loginLimiter` (5/15min), `registerLimiter` (3/h), `clientErrorLimiter` (30/5min), `commentLimiter` (10/min), `friendRequestLimiter` (10/5min), `pickLimiter` (30/min), `forgotPasswordLimiter` (3/h). Account lockout (5 fails → 15-min lock) layered on top — see §8.x. |
| Logging            | **pino + pino-http** (Tier 5.4)                                                                                                                                                                                                                                                                                                                           | Structured JSON in prod, `pino-pretty` in dev. Every request gets `req.id` (UUID or inbound `X-Request-Id`) and a `req.log` child logger                                                                                                                                                               |
| HTTP compression   | **`compression`** (Tier 5.6)                                                                                                                                                                                                                                                                                                                              | Gzip middleware mounted before static + body parser; ~75% size reduction on the JS bundle                                                                                                                                                                                                              |
| Leaderboard cache  | **In-memory Map** with 30 s TTL (Tier 5.2)                                                                                                                                                                                                                                                                                                                | No Redis dependency; appropriate for the current single-process deployment. See §8.14                                                                                                                                                                                                                  |
| Error reporting    | **React `ErrorBoundary` + window listeners → `POST /api/client-errors`** (Tier 5.4b); **Sentry SDK** (`@sentry/node` + `@sentry/react`) gated behind `SENTRY_DSN` / `VITE_SENTRY_DSN` (lazy on both sides). See §6.7 + §10.1                                                                                                                              |

Notable **non-choices**: no TypeScript, no testing framework wired up, no Docker, no CI/CD config. These are deliberate scope decisions documented in [CLAUDE.md](CLAUDE.md).

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
│   └── 20260513000013-user-totp.js                 # Tier 6.9: totpSecret + totpEnabledAt + totpRecoveryCodes JSONB
│
├── seeders/                             # Tier 5.1: idempotent seeders
│   └── 20260513000001-seed-password-backfill.js   # re-hashes any plaintext seed password matching data.json
│
├── lib/                                 # Process-local helpers + cross-cutting infra
│   ├── logger.js                        # Tier 5.4: pino instance (pretty in dev, JSON in prod, LOG_LEVEL env)
│   ├── leaderboardCache.js              # Tier 5.2: getOrBuild/invalidate/stats; 30s TTL in-memory Map
│   ├── instrument.js                    # Tier 5.4b: Sentry.init() — MUST be the very first require() in server.js
│   ├── sentry.js                        # Tier 5.4b: captureException + setupExpressErrorHandler wrappers (no-ops if SENTRY_DSN unset)
│   ├── email.js                         # Tier 6.3: send({to, subject, html, text}) — Resend transport when RESEND_API_KEY set, log-only otherwise. NEVER throws.
│   ├── emailHelpers.js                  # Tier 13.1: sendVerificationEmail (wraps lib/email)
│   ├── auth.js                          # Tier 13.1: cookie + token helpers (JWT_SECRET, ACCESS/REFRESH/CHALLENGE cookies, setAuthCookies, clearAuthCookies, hashToken, generateRawToken)
│   ├── scoring.js                       # Tier 13.1: scorePick + sortLeaderboard (server-side authoritative scorer)
│   ├── users.js                         # Tier 13.1: getUserById, getUserByUsername, buildUserSummary
│   ├── groups.js                        # Tier 13.1: getGroupsForUser, getGroupById, getJoinedGroupIds, getPendingInvites, buildGroupLeaderboard
│   ├── friends.js                       # Tier 13.1: getFriendshipBetween, friendStatusFrom
│   ├── response.js                      # Tier 13.1: attachResponseHelpers middleware (res.ok / res.created / res.noContent)
│   ├── errors.js                        # Tier 13.1: AppError class + factories (notFound, forbidden, badRequest, conflict, …)
│   └── errorMiddleware.js               # Tier 13.1: global Express error handler — translates AppError to JSON response shape
│
├── middleware/
│   ├── requestId.js                     # Tier 5.4: assigns req.id + req.log child; echoes X-Request-Id header
│   ├── csrf.js                          # Tier 6.7: double-submit (sc_csrf cookie + X-CSRF-Token header). EXEMPT_PATHS for unauth mutations. timingSafeEqual compare.
│   ├── auth.js                          # Tier 13.1: authMiddleware + requireAdmin (sc_access cookie → req.user)
│   ├── rateLimit.js                     # Tier 13.1: all 7 express-rate-limit instances + skipInTest predicate
│   └── asyncHandler.js                  # Tier 13.1: wraps async route handlers so thrown AppError flows to errorMiddleware
│
├── routes/                              # Tier 13.2: Express routers mounted at /api (each owns one domain)
│   ├── auth.js                          # /register, /login, /auth/{verify-email, forgot-password, reset-password, refresh, logout, 2fa/verify}
│   ├── client-errors.js                 # /client-errors (CSRF-exempt; logs frontend exceptions)
│   ├── me.js                            # /me, /me/2fa/{setup, confirm, disable}, /me/email
│   ├── games.js                         # /games, /games/:id/result, /games/:id/comments
│   ├── picks.js                         # /picks (CRUD)
│   ├── groups.js                        # /groups (CRUD + invite/accept/decline/transfer/visibility/discover/join/leave)
│   ├── leaderboard.js                   # /leaderboard
│   ├── friends.js                       # /friends + /friends/:id/{accept, decline}
│   ├── users.js                         # /search, /users/:username/profile
│   ├── comments.js                      # /comments/:id (edit/delete) + reactions
│   ├── notifications.js                 # /notifications, /notifications/:id/read, /notifications/read-all
│   ├── admin.js                         # /admin/{games, users, cache-stats} + bulk endpoints
│   ├── health.js                        # /healthz (root path; no /api prefix)
│   └── docs.js                          # /api/openapi.json + /api/docs Swagger UI (dev-only)
│
├── services/                            # Tier 13.4: pure domain logic (no req/res). Routes parse → call → respond.
│   ├── NotificationService.js           # notify (never throws), listForUser, markRead, markAllRead
│   ├── BadgeService.js                  # awardBadge, evaluateBadges (uses NotificationService for badge-earned toasts)
│   ├── LeaderboardService.js            # Wraps lib/leaderboardCache: getOverall, getForGroup, invalidate, stats
│   ├── CommentService.js                # listForGame, create, edit, remove, react, unreact (CommentReaction ops)
│   ├── PickService.js                   # createPick, listForUser, deletePick (calls Badge + Leaderboard hooks)
│   ├── GameService.js                   # CRUD + setResult/bulkSetResult/cascadeDelete (notify + badge eval on result)
│   ├── GroupService.js                  # CRUD + invite/accept/decline/join/leave/transfer/visibility + cascadeDelete
│   └── UserService.js                   # cascadeDelete + admin list/role/delete + bulkAction (filters self id → skipped[])
│
├── models/                              # Sequelize models — one file per table
│   ├── index.js                         # Sequelize init + associations + initDatabase + umzug shim (runMigrations) + seedDatabase
│   ├── User.js                          # bcrypt beforeCreate/beforeUpdate hooks; displayName, bio, email, emailVerifiedAt, loginAttempts, lockedUntil, totpSecret, totpEnabledAt, totpRecoveryCodes
│   ├── Game.js
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
│   └── RefreshToken.js                  # Tier 6.8: userId FK ON DELETE CASCADE, tokenHash unique, expiresAt, revokedAt, userAgent
│
├── badges/
│   └── catalog.js                       # Source of truth for badge slugs/names/emojis (server + frontend)
│
├── validation/
│   ├── schemas.js                       # All zod schemas, one per POST/PUT route
│   └── middleware.js                    # validate(schema) → 400 with structured issues on failure
│
├── src/                                 # React frontend
│   ├── main.jsx                         # React.createRoot bootstrap; provider stack: NotificationProvider → AuthProvider → DataProvider → App (Tier 13.6); mounts ErrorBoundary, installs clientErrorReporter, calls initSentry()
│   ├── App.jsx                          # ~71 LOC after Tier 13 Chunk 6 — pure layout shell: gradient chrome + title + status banner + 3-way switch (Skeleton/Auth/Dashboard view).
│   ├── views/                           # Tier 13 Chunk 6 — view-level components consumed by App.jsx
│   │   ├── SkeletonView.jsx             # placeholder shown while the initial dashboard fetch is in flight
│   │   ├── AuthView.jsx                 # login / register / forgot / reset / 2FA challenge — composes loadDashboard with auth handlers internally
│   │   └── DashboardView.jsx            # the authenticated UI (tabs, games, groups, leaderboard, profile, admin). Consumes useAuth/useData/useGames directly
│   ├── contexts/                        # Tier 13.6 React Context providers
│   │   ├── NotificationContext.jsx      # status banner + scorecast:client-error subscription
│   │   ├── AuthContext.jsx              # user, authData, auth handlers (login/register/forgot/reset), 2FA flow, URL token consumption
│   │   └── DataContext.jsx              # games, picks, groups, leaderboard, friends, discover, invites, profile + every mutation handler. Watches user → null to clear its own slots on logout
│   ├── hooks/                           # Tier 13.7 custom hooks
│   │   ├── useAuth.js, useData.js, useNotifications.js   # re-exports of their context's hook
│   │   ├── useRequest.js                # CSRF + 401 refresh-retry + session-expired (depends on AuthContext)
│   │   ├── useGames.js                  # segmented upcoming/live/completed + refreshGames
│   │   ├── usePicks.js                  # pickMap memo + submit/remove
│   │   ├── useGroups.js, useLeaderboard.js, useFriends.js   # selector hooks on useData
│   ├── index.css                        # @tailwind base/components/utilities
│   ├── lib/
│   │   ├── clientErrorReporter.js       # Tier 5.4b: window error + unhandledrejection listeners; throttled POST to /api/client-errors; dispatches scorecast:client-error DOM event
│   │   ├── sentry.js                    # Tier 5.4b: dynamic import('@sentry/react') gated on VITE_SENTRY_DSN (Vite tree-shakes when unset)
│   │   ├── apiClient.js                 # Tier 13.3: bare apiFetch helper used by AuthContext for /api/auth/* paths (no refresh-retry needed)
│   │   └── cookies.js                   # Tier 6.7: getCookie(name) — reads document.cookie for X-CSRF-Token header injection
│   ├── utils/
│   │   ├── scoring.js                   # MIRROR of server's scorePick; see §8.1
│   │   └── time.js                      # formatCountdown, useCountdown hook, timeAgo
│   └── components/
│       ├── ErrorBoundary.jsx            # Tier 5.4b: class component wrapping <App />; reports via reportClientError + Sentry captureException; raw message gated on import.meta.env.DEV
│       ├── GameCard.jsx                 # Pick UI, outcome badge, countdown chip, undo-pick, CommentThread footer
│       ├── GroupCard.jsx                # Member grid + Avatars, invite form, Public/Private badge, leave/transfer/delete menu
│       ├── GroupLeaderboardCard.jsx     # Sort select + pagination + viewer-row anchor
│       ├── LeaderboardCard.jsx          # Exports LeaderboardRow (Avatar + clickable for profile drawer)
│       ├── InviteRow.jsx
│       ├── LoginForm.jsx                # Tier 6: 'Forgot password?' link + handoff to 2FA challenge on login response
│       ├── RegisterForm.jsx              # Tier 6.5: email field required
│       ├── ForgotPasswordForm.jsx        # Tier 6.4: email input → POST /api/auth/forgot-password → static success message (no enumeration)
│       ├── ResetPasswordForm.jsx         # Tier 6.4: new-password input + token from URL → POST /api/auth/reset-password
│       ├── TwoFactorSetup.jsx            # Tier 6.9: Profile section; idle → setup (QR + recovery codes + .txt download) → confirm; also handles disable flow
│       ├── TwoFactorChallenge.jsx        # Tier 6.9: login challenge UI; TOTP code OR recovery code toggle
│       ├── PicksHistory.jsx
│       ├── EmptyState.jsx
│       ├── Skeleton.jsx                 # SkeletonGameCard + SkeletonLeaderboardRow
│       ├── ConfirmModal.jsx             # Backdrop + Esc-close, used by logout + admin deletes + bulk confirm
│       ├── Avatar.jsx                   # Deterministic initial-on-color circle (FNV-1a → HSL)
│       ├── SearchBar.jsx                # Debounced /api/search, type-grouped dropdown
│       ├── ProfileView.jsx              # Header (Avatar + displayName + username), stats, BadgeWall, recent picks, friend button, inline edit form (own profile)
│       ├── ProfileDrawer.jsx            # Right-side drawer wrapping ProfileView
│       ├── BadgeWall.jsx
│       ├── FriendsList.jsx
│       ├── CommentThread.jsx            # Comments with edit, delete, 5-emoji reactions (per-viewer state)
│       ├── NotificationBell.jsx         # 30s polling, dropdown
│       └── admin/
│           ├── AdminPanel.jsx
│           ├── GameManager.jsx          # Per-row + bulk-select with action bar
│           └── UserManager.jsx          # Per-row + bulk-select with action bar (self auto-skipped)
│
└── dist/                                # `npm run build` output, served as static by server.js
```

---

## 5. Backend Architecture

### 5.1 Process Model

A single Node process listens on `PORT` (default `3000`). It does both:

- **Static file serving** for the built frontend (`dist/`) via `express.static`, plus a catch-all `app.get('*')` that returns `dist/index.html` to support client-side routing.
- **JSON API** at `/api/*`.

There is **no worker process**, **no cron job**, **no PM2 wrapper**. Restart = lose the in-memory rate-limit counters. There is **no graceful shutdown** logic.

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

Defined inline in [server.js](server.js). Reads `req.cookies.sc_access` only — **Bearer-header auth was removed in Tier 6.8**.

Verifies the JWT with `jwt.verify(token, JWT_SECRET)`. On success, attaches the decoded payload `{id, username, role}` to `req.user`. On failure, returns `401 {error: 'Invalid token'}` or `401 {error: 'Authentication required'}`.

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

Routes are registered in [server.js](server.js) in roughly this order:

1. **Auth (Tier 6 expanded)**:
   - `POST /api/register` — accepts `{username, password, email}`. Body response: `{user}` only (auth cookies set via `setAuthCookies`). Fires `sendVerificationEmail` fire-and-forget.
   - `POST /api/login` — accepts `{username, password}`. On lockout, on bad pw, and on unknown user, returns identical 401 `{error: 'Invalid credentials'}`. Lockout state mutates `users.loginAttempts` / `lockedUntil` (Tier 6.6). If `user.totpEnabledAt` is set, issues `sc_challenge` cookie and returns `{challenge: true}` instead of auth cookies (Tier 6.9).
   - **`POST /api/auth/verify-email`** (Tier 6.5) — body `{token}`. Finds the matching `email_verification_tokens` row by SHA-256 hash; sets `users.emailVerifiedAt`; marks the token consumed.
   - **`POST /api/auth/forgot-password`** (Tier 6.4, rate-limited) — body `{email}`. **Always 204** regardless of whether the user exists or is verified; only sends email if both are true. Prevents user enumeration.
   - **`POST /api/auth/reset-password`** (Tier 6.4) — body `{token, password}`. Updates password (hook re-hashes), clears lockout state, **revokes all refresh tokens** for the user.
   - **`POST /api/auth/refresh`** (Tier 6.8) — reads `sc_refresh` cookie; revokes the row; issues a fresh pair. Returns 204 on success, 401 with cookies cleared on failure.
   - **`POST /api/auth/logout`** (Tier 6.8) — reads `sc_refresh`, marks the row revoked, clears both auth cookies. 204.
   - **`POST /api/auth/2fa/verify`** (Tier 6.9) — reads `sc_challenge` cookie (5-min JWT) + body `{code}` or `{recoveryCode}`. On success: clears `sc_challenge`, calls `setAuthCookies`, returns `{user}`. Used recovery codes are spliced out of `users.totpRecoveryCodes`.
   - **`POST /api/client-errors`** (Tier 5.4b) — soft-auth: logs `userId` if cookie token is valid, anonymous otherwise; structured-logs `clientError` payload at `error` or `warn` level per `level` field.
2. **Identity / account management**:
   - `GET /api/me` — returns `{id, username, role, displayName, bio, email, emailVerifiedAt, twoFactorEnabled, joinedGroups, pendingInvites}`. Drives auth-state inference on the client.
   - `PUT /api/me` — displayName + bio edit.
   - **`PATCH /api/me/email`** (Tier 6.5) — body `{email}`. Updates `users.email`, clears `emailVerifiedAt`, fires fresh `sendVerificationEmail`. Used for existing-user remediation banner (`email=null` legacy rows).
   - **`POST /api/me/2fa/setup`** (Tier 6.9) — generates `speakeasy.generateSecret()`, returns `{qrCodeDataUrl, secret, recoveryCodes}`. Stores secret + bcrypt-hashed codes; `totpEnabledAt` stays null.
   - **`POST /api/me/2fa/confirm`** (Tier 6.9) — body `{code}`. Verifies against the pending secret; sets `totpEnabledAt`.
   - **`POST /api/me/2fa/disable`** (Tier 6.9) — body `{code}` or `{recoveryCode}`. Nulls all three `totp*` columns.
3. Games: `GET /api/games`
4. Groups (in order): `GET /api/groups`, **`GET /api/groups/discover`** (must come before `/:groupId`), `GET /api/groups/:groupId`, `POST /api/groups`, invite endpoints, `POST /api/groups/:groupId/join`, `POST /api/groups/:groupId/leave`, `POST /api/groups/:groupId/transfer`, `DELETE /api/groups/:groupId`, `POST /api/groups/:groupId/visibility`
5. Picks: `POST /api/picks`, `GET /api/picks`, **`DELETE /api/picks/:id`** (Tier 8 — undo pick)
6. Search: `GET /api/search?q=&type=` (Tier 8)
7. Leaderboard: `GET /api/leaderboard?groupId=&orderBy=&offset=&limit=` (sort + pagination in Tier 8)
8. Game admin: `POST /api/games/:gameId/result`
9. Profiles: `GET /api/users/:username/profile`
10. Friends: `POST /api/friends/request`, `/accept`, `/decline`, `DELETE`, `GET /api/friends`
11. Comments: `GET/POST /api/games/:gameId/comments`, `PUT /api/comments/:id` (edit), `DELETE /api/comments/:id`, `POST /api/comments/:id/reactions`, `DELETE /api/comments/:id/reactions/:emoji`
12. Notifications: `GET /api/notifications`, `POST /:id/read`, `POST /read-all`
13. Admin: `POST/PUT/DELETE /api/admin/games`, `POST /api/admin/games/bulk`, `GET/POST/DELETE /api/admin/users/...`, `POST /api/admin/users/bulk`
14. Catch-all: `app.get('*')` → `dist/index.html`

**⚠ Route ordering matters for path-param shadowing.** `/api/groups/discover` is registered before `/api/groups/:groupId` so Express doesn't match `discover` as the `:groupId` parameter. Any future sibling route under `/api/groups/*` must follow the same convention.

### 5.5 Side-Effect Helpers (`server.js` internals)

These are pure-Node helpers, not endpoints. They live inside `server.js` and are called from multiple route handlers:

| Helper                                              | Purpose                                                                                                                                                                          | Called from                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `scorePick(pick, game)`                             | Authoritative scoring formula                                                                                                                                                    | `buildUserSummary`, `buildGroupLeaderboard`, profile endpoint, result + bulk-result hooks                               |
| `notify(userId, type, title, body?, link?)`         | Creates a `Notification` row; swallows errors                                                                                                                                    | Invite, accept, friend-request, friend-accept, public-group join, group leave/transfer/delete, badge award, game result |
| `awardBadge(userId, slug)`                          | Inserts a `Badge` row (unique-constrained); fires a `badge` notification                                                                                                         | `evaluateBadges` only                                                                                                   |
| `evaluateBadges(userId, ctx?)`                      | Re-runs all badge unlock conditions for a user; idempotent                                                                                                                       | `POST /api/picks`, `POST /api/groups`, per-user inside the result hook (single + bulk)                                  |
| `getFriendshipBetween(a, b)`                        | Finds the single row (in either direction)                                                                                                                                       | Profile endpoint, friend-request guards                                                                                 |
| `friendStatusFrom(friendship, viewer, target)`      | Returns `'self' \| 'none' \| 'pending-in' \| 'pending-out' \| 'friends'`                                                                                                         | Profile endpoint                                                                                                        |
| `buildUserSummary()`                                | Overall leaderboard rows (includes displayName)                                                                                                                                  | `GET /api/leaderboard`                                                                                                  |
| `buildGroupLeaderboard(groupId)`                    | Group-scoped rows (includes displayName + winRate)                                                                                                                               | `GET /api/leaderboard?groupId=`                                                                                         |
| `sortLeaderboard(rows, orderBy)`                    | Sort by `points / winRate / username`, attach `rank`                                                                                                                             | Group leaderboard pagination path                                                                                       |
| `cascadeDeleteUser(target, {transaction})`          | 9-step user cascade (groups owned, picks, comments, friendships, memberships, invites, then user). Tier 5.3: accepts `{transaction}` and forwards to every internal `destroy()`. | `DELETE /api/admin/users/:id`, `POST /api/admin/users/bulk`                                                             |
| `cascadeDeleteGame(game, {transaction})`            | Pick + comment cleanup, then game. Tier 5.3: tx-aware.                                                                                                                           | `DELETE /api/admin/games/:id`, `POST /api/admin/games/bulk`                                                             |
| `cascadeDeleteGroup(group, {transaction})`          | (Tier 5.3) Members + invites + group. Extracted from the inline body of `DELETE /api/groups/:groupId`.                                                                           | `DELETE /api/groups/:groupId`                                                                                           |
| `createAccessToken(user)` (Tier 6.8)                | 15-min HS256 JWT with `{id, username, role}`. Replaces the 7-day `createToken` from before Tier 6.                                                                               | `setAuthCookies` only                                                                                                   |
| `setAuthCookies(res, user, {userAgent})` (Tier 6.8) | Signs access JWT, generates random refresh token, inserts a `RefreshToken` row, sets both cookies on `res`. Async (writes DB).                                                   | `POST /api/login`, `/api/register`, `/api/auth/refresh`, `/api/auth/2fa/verify`                                         |
| `clearAuthCookies(res)` (Tier 6.8)                  | `res.clearCookie` for `sc_access` + `sc_refresh` at their correct paths.                                                                                                         | `POST /api/auth/logout`, refresh-failure paths                                                                          |
| `revokeAllUserRefreshTokens(userId)` (Tier 6.8)     | Sets `revokedAt = NOW()` on every non-revoked row for the user.                                                                                                                  | `POST /api/auth/reset-password`                                                                                         |
| `generateRawToken()` / `hashToken(raw)` (Tier 6)    | 32 random hex bytes; SHA-256 hex digest. Used for high-entropy single-use tokens (verify-email, password-reset, refresh).                                                        | All three token issuers + verifiers                                                                                     |
| `sendVerificationEmail(user)` (Tier 6.5)            | Generates a token row + dispatches verify email via `lib/email`. Fire-and-forget at the caller.                                                                                  | `POST /api/register`, `PATCH /api/me/email`                                                                             |

`notify` and `evaluateBadges` are **fire-and-forget with `.catch(() => {})`** — a failure inside them never breaks the user-facing response. They also fire **outside** every cascade transaction so a rollback never produces ghost notifications. The trade-off is silent failures; the structured `req.log.warn`/`logger.warn` calls inside `notify()` and `evaluateBadges()` (Tier 5.4) at least leave a trail.

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
src/main.jsx  →  React.createRoot()
              →  <ErrorBoundary>
                   <NotificationProvider>
                     <AuthProvider>
                       <DataProvider>
                         <App />                  // Tier 13: layout shell only
                           → <SkeletonView>       // initial boot
                           → <AuthView>           // unauthenticated
                           → <DashboardView>      // authenticated UI

src/App.jsx + src/views/ + src/contexts/ + src/hooks/ + components/
  →  Vite (esbuild + Rollup)  →  dist/index.html, dist/assets/*.js, *.css
```

`npm run dev` starts Vite's dev server on `localhost:5173` with HMR. The dev server proxies `/api/*` to `localhost:3000` (configured in [vite.config.js](vite.config.js)), so the frontend code can use relative URLs in both dev and prod with no env-var gymnastics.

`npm run build` produces a single-page bundle in `dist/`. There is **no code-splitting beyond Vite's defaults**, **no service worker**, **no preact compat**.

### 6.2 State Management

Tier 13 (Chunks 6.x) moved client state out of `App.jsx` into three React Context providers stacked in [src/main.jsx](src/main.jsx). There is **no Redux, no Zustand, no React Router** — Context + `useState` is sufficient at this scale.

```
<NotificationProvider>     // status banner toast (Tier 13.6)
  <AuthProvider>           // user, authData, authView, 2FA flow (Tier 13.6)
    <DataProvider>         // games, picks, groups, leaderboard, friends, profile + every mutation handler
      <App />              // ~71 LOC layout shell; routes between SkeletonView / AuthView / DashboardView
```

The state slots that used to live in `App.jsx` now live as `useState` inside the appropriate provider:

```
NotificationContext:  status                                              // single toast string
AuthContext:          user, authData, authView, forgotSent, confirmingLogout
                      // authView ∈ 'auth' | 'forgot' | 'reset' | 'twofa'
DataContext:          bootDone, loading, view, games, groups, picks,
                      pendingInvites, leaderboard, groupOrderBy, groupOffset,
                      selectedGroupId, friends, discoverGroups, ownProfile,
                      profileUsername, profile, profileLoading, profileBusy
```

**Cross-context coordination is event-driven, not imperative.** Provider order matters:

- `AuthContext` only manages user state. When the user logs in / out, it flips `user` and calls `showStatus` from `NotificationContext`. It does **not** know about `DataContext`.
- `DataContext` watches `user` via `useEffect`. When `user` flips from null → set (login), it triggers `loadDashboard()`. When it flips back to null (logout / session-expired), it wipes its own slots in a single effect.
- `useRequest` ([src/hooks/useRequest.js](src/hooks/useRequest.js)) is the fetch wrapper consumed by every component that talks to `/api/*`. On a 401, it calls `clearSession` from `AuthContext`, which trips the user → null effect in `DataContext`, which wipes data. No component has to know about teardown.

**Selector hooks** ([src/hooks/](src/hooks/)) let components import the narrow slice they need:

- `useAuth` / `useData` / `useNotifications` — direct re-exports of the context value
- `useGames` — `{ games, upcomingGames, liveGames, completedGames, refreshGames }` (the segmentation `useMemo` moved here from App.jsx)
- `usePicks` — `{ picks, pickMap, submitPick, removePick }` (pickMap built here)
- `useGroups` / `useLeaderboard` / `useFriends` — projections on `useData()`

> **Note on `pickMap`**: it stores the **full pick object** keyed by `gameId`, not just the choice. This was changed in Tier 8.2 so `GameCard` can pass `existingPickId` to the undo-pick handler. Tier 13 moved this `useMemo` into [src/hooks/usePicks.js](src/hooks/usePicks.js).

**No localStorage** (Tier 6.8). Auth state is inferred from `user` (set by a successful `/api/me` boot fetch); the cookies that actually authenticate the user are HttpOnly and invisible to JS. `bootDone` tracks whether the initial `/api/me` round-trip completed so the UI shows the skeleton view until then (instead of briefly flashing the login form to an authenticated user).

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

Routing is **fake**: the URL never changes. The `view` state determines which top-level block renders. Five base tabs (Games, My Picks, Groups, Leaderboards, Profile) plus a conditional Admin tab when `user.role === 'admin'`. Browser back/forward and deep-linking are unsupported.

### 6.5 Polling Patterns

Two timers run inside the app:

- **`NotificationBell`**: `setInterval` calling `GET /api/notifications` every 30 s. Started on mount, cleared on unmount.
- **`useCountdown(date)`** in `time.js`: per-`GameCard` interval that re-formats the countdown label every 30 s. Cheap; the hook returns a string label.

There is **no global polling for game state** today (deferred Tier 4 feature). Leaderboards are computed on each `GET /api/leaderboard` call and refetched on user actions, not on a timer.

### 6.6 Component Hierarchy

```
<ErrorBoundary>                            // Tier 5.4b — render-error fallback wrapping the whole tree
└── <NotificationProvider>                 // Tier 13.6: status banner state
    <AuthProvider>                         // Tier 13.6: user + auth flow
      <DataProvider>                       // Tier 13.6: games/picks/groups/leaderboard/friends + handlers
        <App>                              // Tier 13 Chunk 6: layout shell only (~71 LOC)
        ├── header card + status banner
        └── body:
            ├── <SkeletonView>             // boot / loading state
            ├── <AuthView>                 // unauthenticated — switches on `authView`
            │     authView === 'auth':   <LoginForm> / <RegisterForm>
            │     authView === 'forgot': <ForgotPasswordForm>
            │     authView === 'reset':  <ResetPasswordForm>  (entered via ?resetToken=)
            │     authView === 'twofa':  <TwoFactorChallenge> (Tier 6.9; login returned {challenge: true})
            │
            └── <DashboardView>            // authenticated UI; consumes useAuth/useData/useGames
                ├── header card
                ├── tabs row
                │   ├── <SearchBar>                  // Tier 8.4; consumes useRequest + useData
                │   ├── <NotificationBell>           // consumes useRequest + useNotifications
                │   └── logout button → <ConfirmModal>
                │
                ├── view === 'games':
                │     <GameCard>* (uses usePicks for submit/remove + pickMap)
                │       └── <CommentThread> (uses useRequest + useAuth + useNotifications)
                │     sidebar: <LeaderboardRow>* (clickable → opens drawer)
                │
                ├── view === 'mypicks': <PicksHistory>
                │
                ├── view === 'groups':
                │     create form (with visibility radio)
                │     Discover list
                │     <FriendsList>                  // consumes useFriends + useData
                │     pending invites
                │     <GroupCard>*
                │
                ├── view === 'leaderboard':
                │     <LeaderboardCard>  <GroupLeaderboardCard>
                │
                ├── view === 'profile' (self):
                │     <ProfileView editable />       // consumes useAuth + useData (handlers from hooks, not props)
                │       Avatar header, displayName/bio edit form, <TwoFactorSetup> section (Tier 6.9)
                │
                └── view === 'admin' (admin only): <AdminPanel>
                                                     ├── <GameManager>  (consumes useRequest + useNotifications + useData)
                                                     └── <UserManager>  (consumes useRequest + useAuth + useNotifications)

Overlays (rendered inside <DashboardView>):
├── <ConfirmModal>           (logout, deletions, bulk confirmations)
└── <ProfileDrawer>           (any avatar/leaderboard row click; consumes useData entirely)
        └── <ProfileView>
              ├── <Avatar>
              └── <BadgeWall>

<CommentThread> renders:
  <CommentRow>* — each with <Avatar>, edit form (author only), 5-emoji reaction strip
```

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

**Initial migration set** (all idempotent — they're no-ops against DBs that were upgraded by the old boot-time SQL):

| File                                          | Effect                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `20260513000001-add-user-role.js`             | ENUM `enum_users_role` + `users.role` column                                                                             |
| `20260513000002-pick-unique-index.js`         | `picks_user_game_unique (userId, gameId)`                                                                                |
| `20260513000003-group-visibility-enum.js`     | ENUM `enum_groups_visibility` + `groups.visibility` column                                                               |
| `20260513000004-friendship-pair-unique.js`    | Functional unique index on `LEAST/GREATEST(requesterId, addresseeId)`                                                    |
| `20260513000005-user-displayname-bio.js`      | `users.displayName VARCHAR(60)` + `users.bio TEXT`                                                                       |
| `20260513000006-comment-edited-at.js`         | `comments.editedAt TIMESTAMPTZ`                                                                                          |
| `20260513000007-comment-reactions-table.js`   | `CREATE TABLE comment_reactions IF NOT EXISTS` (existing DBs already had it from `sync({alter:false})`)                  |
| `20260513000008-user-login-attempts.js`       | Tier 6.6: `users.loginAttempts` + `users.lockedUntil`                                                                    |
| `20260513000009-user-email-columns.js`        | Tier 6.5: `users.email` + `users.emailVerifiedAt` + functional unique index `users_email_lower_unique` on `LOWER(email)` |
| `20260513000010-email-verification-tokens.js` | Tier 6.5: `CREATE TABLE email_verification_tokens`                                                                       |
| `20260513000011-password-reset-tokens.js`     | Tier 6.4: `CREATE TABLE password_reset_tokens`                                                                           |
| `20260513000012-refresh-tokens.js`            | Tier 6.8: `CREATE TABLE refresh_tokens` + partial active-rows index                                                      |
| `20260513000013-user-totp.js`                 | Tier 6.9: `users.totpSecret`, `users.totpEnabledAt`, `users.totpRecoveryCodes` JSONB                                     |

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

| Column              | Type                                         | Notes                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | UUID PK                                      |                                                                                                                                                                                                                       |
| `username`          | STRING UNIQUE NOT NULL                       | Case-insensitive lookup via `iLike`                                                                                                                                                                                   |
| `password`          | STRING NOT NULL                              | bcrypt hash; the model's `beforeCreate`/`beforeUpdate` hooks auto-hash anything not already matching `^\$2[aby]\$`                                                                                                    |
| `role`              | ENUM('user','admin') NOT NULL DEFAULT 'user' | Added via migration                                                                                                                                                                                                   |
| `displayName`       | VARCHAR(60) NULLABLE                         | Tier 8. Used in place of username everywhere when set                                                                                                                                                                 |
| `bio`               | TEXT NULLABLE                                | Tier 8. Length-capped at 280 by zod, no DB-level constraint                                                                                                                                                           |
| `email`             | VARCHAR(254) NULLABLE                        | Tier 6.5. Private (not exposed except on `GET /api/me`). Functional unique index `users_email_lower_unique` on `LOWER(email) WHERE email IS NOT NULL` for case-insensitive uniqueness that tolerates legacy null rows |
| `emailVerifiedAt`   | TIMESTAMPTZ NULLABLE                         | Tier 6.5. Required to be non-null before `/api/auth/forgot-password` will dispatch a reset link                                                                                                                       |
| `loginAttempts`     | INTEGER NOT NULL DEFAULT 0                   | Tier 6.6. Incremented per bad password; cleared on success or password reset                                                                                                                                          |
| `lockedUntil`       | TIMESTAMPTZ NULLABLE                         | Tier 6.6. When `> NOW()`, login returns generic 401                                                                                                                                                                   |
| `totpSecret`        | TEXT NULLABLE                                | Tier 6.9. base32-encoded TOTP secret. Populated by `/api/me/2fa/setup` but enabled only after `/api/me/2fa/confirm`                                                                                                   |
| `totpEnabledAt`     | TIMESTAMPTZ NULLABLE                         | Tier 6.9. `IS NOT NULL` ⇔ 2FA is required for this user's logins                                                                                                                                                      |
| `totpRecoveryCodes` | JSONB NULLABLE                               | Tier 6.9. Array of bcrypt-hashed (rounds 8) single-use recovery codes. Used codes are spliced out                                                                                                                     |
| `createdAt`         | TIMESTAMPTZ NOT NULL DEFAULT NOW             |                                                                                                                                                                                                                       |

#### `games`

| Column                                | Type                         | Notes                                                   |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| `id`                                  | UUID PK                      |                                                         |
| `homeTeam` / `awayTeam`               | STRING NOT NULL              |                                                         |
| `date`                                | TIMESTAMPTZ NOT NULL         | UTC; the kickoff time                                   |
| `homeProbability` / `awayProbability` | DECIMAL(3,2) NOT NULL        | Float in `[0,1]`; admin form validates sum-to-1.0 ±0.01 |
| `result`                              | ENUM('home','away') NULLABLE | `NULL` = not yet resolved                               |

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

### 7.5 Cascade Behavior Summary

| Parent → Child                                                                                               | On parent delete                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `games` → `picks`                                                                                            | App-level cleanup in `cascadeDeleteGame()` (single + bulk admin paths)                                                                                             |
| `games` → `comments`                                                                                         | `ON DELETE CASCADE` at DB level **and** app-level cleanup in `cascadeDeleteGame()` (belt-and-braces)                                                               |
| `comments` → `comment_reactions`                                                                             | `ON DELETE CASCADE` at DB level + explicit `CommentReaction.destroy({where: {commentId}})` in `DELETE /api/comments/:id`                                           |
| `users` → `badges`, `notifications`                                                                          | `ON DELETE CASCADE` at DB level                                                                                                                                    |
| `users` → `picks`, `comments`, `friendships`, `group_members`, owned `groups`, `group_invites` (by username) | **App-level cleanup only** in `cascadeDeleteUser()` (single + bulk admin paths). The user-delete handler is the most complex deletion path in the system; see §8.9 |
| `groups` → `group_members`, `group_invites`                                                                  | App-level cleanup in `DELETE /api/groups/:groupId` (Tier 8)                                                                                                        |

---

## 8. Domain Subsystems

### 8.1 Scoring System

```
function scorePick(pick, game):
  if not game.result or not pick: return 0
  winning = (pick.choice == game.result)
  if not winning: return 0
  probability = game.homeProbability if pick.choice == 'home' else game.awayProbability
  return round((1 - probability) * 100)
```

**The formula is intentionally duplicated** in two places:

- [server.js](server.js) — authoritative, used to compute leaderboards and the pre-result preview displayed inside notifications.
- [src/utils/scoring.js](src/utils/scoring.js) — client-side, used by `GameCard` to render the outcome badge (`✓ Correct +N pts`) and by `PicksHistory` to display per-pick points.

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
- `deriveResultFromFixture(fixture, localStatus)` → `'home'` / `'away'` / `null`. Prefers upstream `winner` (handles penalty-shootout knockouts where fullTime is a draw but a winner exists); falls back to score comparison. Draws stay `null` because the existing `result` enum is `'home' | 'away'` only — the UI distinguishes them via `status='finished'`.

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

Standalone Python project under [ml/](ml/) that produces `(homeProbability, awayProbability)` for upcoming fixtures and writes them via the existing admin HTTP API. The Node app is untouched — the pipeline is purely a consumer of `lib/footballApi.js` outputs (read via the DB) and a producer to `PUT /api/admin/games/:id`. Activates ScoreCast's scoring formula `(1 - p_winning) × 100` which is otherwise a no-op while every game sits at the `(0.50, 0.50)` default from `LeagueService.upsertFixture`.

**Why a separate Python service** — XGBoost + Elo state are easier to express in pandas / scikit-learn than in any Node ML library; isolation also means the Python deps (~600 MB with xgboost / scikit-learn / numpy) never bloat the Node container.

**Pipeline stages** (each isolated under `ml/scorecast_ml/<stage>/`):

1. **Ingest** ([ingest/football_data_uk.py](ml/scorecast_ml/ingest/football_data_uk.py)) — downloads Football-Data.co.uk CSVs (free, ~30 years of major European league history). URL pattern `https://www.football-data.co.uk/mmz4281/{season}/{fdco_code}.csv`. CSVs are cached as `ml/data/raw/{league}_{season}.csv` keyed by ScoreCast's own league code (PL etc.), NOT FDCO's (E0), so provider swaps don't move the cache. Parser uses stdlib `csv` (not pandas) so historical CSVs with ragged trailing columns (e.g. 2003/04 added mid-season odds providers) still parse cleanly — pandas's C/python engines drop those rows.

2. **Reconcile** ([reconcile/team_mapping.py](ml/scorecast_ml/reconcile/team_mapping.py)) — bridges Football-Data.co.uk's short names ("Man United") to football-data.org's canonical names ("Manchester United FC") via a committed alias table at [reconcile/teams.json](ml/scorecast_ml/reconcile/teams.json). Three-tier resolution: exact alias, exact canonical, then `rapidfuzz` fallback (score ≥ 92 = auto-match + WARN; 75 ≤ score < 92 = ERROR; < 75 = ERROR with "likely a new promotion" hint). The loud-error path on unknown names is the design — silently auto-matching at low fuzzy scores is how naive pipelines drift across preseasons.

3. **Elo** ([elo/engine.py](ml/scorecast_ml/elo/engine.py)) — vanilla `expected_score(r_h, r_a, hfa) = 1 / (1 + 10^((r_a - (r_h + hfa)) / 400))` + `update(r, expected, actual, K)`. Two non-vanilla knobs:
   - `home_field_advantage` defaults to **0**, not the conventional 65. The ablation in [ml/scripts/compare_hfa.py](ml/scripts/compare_hfa.py) shows HFA is a structural no-op for tree-based models — XGBoost absorbs the constant `elo_diff` shift in split thresholds, and the home/away feature pair structure carries the actual home-advantage signal. Test-set mlogloss diff: 0.001.
   - `promoted_team_strategy = "min_rating"` — a team appearing for the first time AFTER the first season enters at `min(current ratings)`, not the default 1500. Captures the empirical reality that promoted teams underperform the bottom of the league they're joining. `len(seasons_seen) > 1` is the threshold; on the first match of a brand-new league everyone starts at `initial_rating` since there's no "current league" to peg against.

4. **Features** ([features/build.py](ml/scorecast_ml/features/build.py) + [features/form.py](ml/scorecast_ml/features/form.py)) — 11-column matrix: `elo_diff`, raw `home_elo` + `away_elo`, last-5 PPG + GF + GA for each side, `days_rest` capped at 14. **Computed AS-OF the match date, never as-of today** — `compute_form(team_history, as_of, last_n)` filters `prior = team_history[date < as_of]`, the canonical line that prevents future-information leakage. Same builder runs for training (per-match in chronological order) and inference (per upcoming fixture).

5. **Train** ([train/](ml/scorecast_ml/train/)) — XGBoost `multi:softprob` with early stopping on val mlogloss (default 400 rounds, ES patience 30, `max_depth=4`, `lr=0.05`, `tree_method='hist'`, `seed=42`). Time-based train/val/test split (NEVER random — random k-fold gives flattering log-loss because the model sees its own season's future). Production split: 5-season train (2004/05 → 2008/09, 1,900 matches) + 1-season val (2009/10) + 15-season held-out test (2010/11 → 2024/25, 5,700 matches). Achieves **mlogloss 0.992 vs baseline 1.065 (-0.073)** and **accuracy 51.9% vs 44.9% (+7 pp)** across 5,700 OOS matches. Model bundles saved as `{league}_{date}.joblib` + matching `.meta.json`; `load_latest_bundle` matches strictly on the canonical filename so A/B-test artifacts (`--model-suffix hfa0` etc.) don't accidentally become production.

6. **Inference + write** ([inference/](ml/scorecast_ml/inference/) + [db/writer.py](ml/scorecast_ml/db/writer.py)):
   - 3-class output `(P_h, P_d, P_a)` → 2-class `(home_out, away_out)` via the user-confirmed redistribution `home_out = P_h + (P_h / (P_h + P_a)) · P_d`, which is algebraically `home_out = P_h / (P_h + P_a)` — proof in [normalize.py](ml/scorecast_ml/inference/normalize.py).
   - **Round to DECIMAL(3,2)** matching the DB column, then re-balance (larger side keeps its rounded value, smaller = `1.00 - larger`) so the pair sums to exactly 1.00. Without re-balance, ~5% of writes fail the validator's `±0.01` constraint.
   - **Sentinel-avoidance** — never emit `(0.50, 0.50)` (that's `LeagueService.upsertFixture`'s "untouched by anyone" default; emitting it would confuse the next run's skip-existing logic). Nudge to `(0.51, 0.49)` based on which side had the higher pre-rounded probability.
   - **HTTP write** mirrors [tests/e2e/helpers/api.js](tests/e2e/helpers/api.js) `apiLogin` — POST `/api/login`, extract `sc_csrf` cookie, PUT `/api/admin/games/:id` with `X-CSRF-Token` header. Login once per run (`/api/login` is rate-limited). Per-game PUT is independently idempotent — partial failures don't block the rest.

**Walk-forward correctness** — features for any match are built from data strictly dated before that match. Elo's `home_elo_pre` / `away_elo_pre` columns are the pre-match snapshot; form's `< as_of` filter does the same on the rolling-stats side. The [scripts/backtest_2526.py](ml/scripts/backtest_2526.py) backtest combines CSV history with DB 25/26 finished games and re-runs Elo across the whole chronological set — each 25/26 prediction uses only matches dated strictly before it.

**Operator workflow** (Phase 1 — manual local invocation):

1. Provision an `ml_pipeline` admin user (username regex at [validation/schemas.js:11](validation/schemas.js#L11) only allows `[A-Za-z0-9_]+` — **no hyphens**; older docs that say `ml-pipeline` are wrong).
2. `cd ml && python -m venv .venv && pip install -r requirements.txt`.
3. Copy `.env.example` → `.env`, fill `SCORECAST_ML_PASSWORD` and `SCORECAST_DB_URL` (same URL as the Node app's `DATABASE_URL`).
4. `python -m scorecast_ml ingest --league PL --seasons 9394-2425` then `reconcile` then `train` then `predict-and-write --dry-run` then `predict-and-write`.

The cron + Container Apps Job versions land in Phase 3 — see [ml/ONBOARDING.md](ml/ONBOARDING.md) for the full walkthrough + per-league onboarding playbook (La Liga / Bundesliga / Serie A / Ligue 1).

**Schema additions: zero.** The pipeline writes to existing `games.homeProbability` / `games.awayProbability` columns. Audit-logged through the existing `audit_log` table via `auditMutation('admin.game.update', 'game')` already wrapping the route.

**Known limits + forward path**:

- **Isotonic calibration** ✅ shipped (Phase 2). Per-class `IsotonicRegression` fit on val, attached to `ModelBundle.calibrators`. Applied automatically inside `predict_proba`. Live production model trains 15 seasons (2009/10 → 2023/24), validates on 2024/25, calibration measured on the in-progress 25/26 season via `scripts/backtest_2526.py`. 70-80% bucket overconfidence pulled from -7pp to -2pp deviation; the model now reaches >80% confidence on top calls (didn't pre-calibration).
- **Single-league models** — one model per league, no shared pool. La Liga / Bundesliga / etc. need their own training runs. The pipeline is league-agnostic by design; per-league work is mostly extending `teams.json` and `LEAGUE_CODE_MAP`.
- **No automated cron yet** — Phase 1 is manual. Phase 3 adds Azure Container Apps Job + GitHub Actions cron workflow mirroring the existing `infra/modules/migrate-job.bicep`.
- **Pick semantics still winner-only** — draws leave picks at 0 pts (per the existing `result` enum). The "draw partial credit" scoring change (the math is in `ml/scorecast_ml/inference/normalize.py`'s out-of-scope note) is a separate tier touching `PickService.scorePick` + both copies of the scoring formula.

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

### 9.4 Admin Deletes a User

```
Admin opens UserManager → clicks Delete on bob → ConfirmModal → Confirm

DELETE /api/admin/users/<bobId>
        │
        ▼  server (NOT in a transaction — see §8.9):
   if bobId === req.user.id  → 400
   ownedGroups = groups where ownerId = bob
   if ownedGroups:
     DELETE group_members WHERE groupId IN ownedGroups
     DELETE group_invites WHERE groupId IN ownedGroups
     DELETE groups WHERE id IN ownedGroups
   DELETE picks         WHERE userId = bob
   DELETE comments      WHERE userId = bob
   DELETE friendships   WHERE requesterId = bob OR addresseeId = bob
   DELETE group_members WHERE userId = bob
   DELETE group_invites WHERE username = bob.username
   DELETE users         WHERE id = bob  →  CASCADE deletes bob's badges + notifications
   200 { success: true }
```

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

| Concern                      | Status                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password storage             | bcrypt cost 10, enforced via model hooks                                                                                                                                                                        |
| Auth secret                  | JWT_SECRET required in prod; insecure dev fallback never reaches prod                                                                                                                                           |
| Session transport            | **HttpOnly cookie auth** (Tier 6.8): `sc_access` (15-min JWT) + `sc_refresh` (30-day opaque, rotating, hashed in DB). Bearer-header path removed. XSS payloads can't lift either cookie                         |
| Token storage in DB          | SHA-256 hashes of high-entropy random tokens (refresh, verify-email, password-reset); bcrypt for low-entropy recovery codes                                                                                     |
| Brute force                  | Per-route rate limits across login, register, comments, friend-requests, picks, forgot-password, client-errors (Tier 6.10); per-user lockout after 5 failed logins (Tier 6.6); generic 401 to avoid enumeration |
| Input validation             | zod on every body; no trust placed in client-side validation                                                                                                                                                    |
| SQL injection                | Sequelize parameterizes everything; raw SQL in migrations has no user input                                                                                                                                     |
| RBAC                         | `requireAdmin` middleware; admin endpoints under `/api/admin/*` plus the legacy `POST /api/games/:gameId/result`                                                                                                |
| Self-protection              | Admin cannot demote or delete self (server-side, not just UI)                                                                                                                                                   |
| XSS                          | React's default escaping; no `dangerouslySetInnerHTML` anywhere. CSP `default-src 'self'` blocks inline `<script>` injection                                                                                    |
| CSRF                         | **Double-submit cookie** (Tier 6.7): `sc_csrf` cookie + `X-CSRF-Token` header, `crypto.timingSafeEqual` compare. SameSite=Lax is the first wall; double-submit is belt-and-braces                               |
| CORS                         | **Env allowlist** (Tier 6.1) via `CORS_ORIGINS`; server throws on boot in prod when empty                                                                                                                       |
| Security headers             | **helmet** (Tier 6.2) with CSP tuned for Vite+Tailwind+Sentry; HSTS; `X-Frame-Options: DENY`; `Referrer-Policy: no-referrer`; `X-Content-Type-Options: nosniff`                                                 |
| Password reset               | **Email-based** (Tier 6.4): 15-min single-use tokens, always-204 response shape (no enumeration). Reset additionally revokes all refresh tokens (force-logout-everywhere)                                       |
| Email verification           | **Required at register** (Tier 6.5): 24h single-use tokens. `forgot-password` only sends to verified emails                                                                                                     |
| 2FA                          | **Opt-in TOTP** (Tier 6.9) via speakeasy. 10 single-use recovery codes (bcrypt-hashed). 5-min `sc_challenge` cookie between password-OK and code-OK                                                             |
| Audit log                    | None — captured under Tier 4b in the roadmap                                                                                                                                                                    |
| Multi-device session listing | Not implemented today; `refresh_tokens.userAgent` is captured to support a future "active sessions" UI                                                                                                          |

### 10.3 Performance

- **Leaderboard cache (Tier 5.2)**: `GET /api/leaderboard` reads through [lib/leaderboardCache.js](lib/leaderboardCache.js) — a 30 s in-process TTL Map. Sort and pagination layer on top of the cached array, so a single cache entry serves all `orderBy`/`offset`/`limit` combinations. See §8.14 for the invalidation policy. The underlying `buildUserSummary` / `buildGroupLeaderboard` are still O(users × picks) on a miss — caching just bounds the cost to once per 30 s per scope.
- **Profile endpoint**: not cached. Similar shape to leaderboard but bounded to a single user; a Tier 5 follow-up candidate if profile views become hot.
- **N+1 elimination (Tier 5.7)**: `getGroupsForUser` and `getGroupById` now use Sequelize `include: [{model: User}]` to batch-load member usernames in a single query. For a user in 3 groups, this dropped 12 queries to 3.
- **No connection pooling tuning**: Sequelize default of max 5 is fine for a single Node process.
- **HTTP compression (Tier 5.6)**: `compression` middleware mounted before static/body parsing. JS bundle compresses ~75 % on the wire; JSON responses under 1 KB are skipped (default threshold).
- **Bundle size**: the production JS bundle is ~485 KB uncompressed, ~120 KB gzipped on the wire. All from React + Tailwind + business code; future code-splitting (Tier 9.5) could split the admin and profile-drawer trees into separate chunks.

### 10.4 Accessibility

Established floor (Tier 2):

- Every form input has a matching `<label htmlFor=...>` or `aria-label`.
- All interactive elements have `focus-visible:ring-2 focus-visible:ring-cyan-400`.
- Tabs use `aria-current="page"` for the active tab.
- The status toast uses `role="status" aria-live="polite"`.
- The dashboard root has `aria-busy={loading}` during initial fetch.
- Modal dialogs use `role="dialog" aria-modal="true"` and Esc-to-close.

Not yet:

- No keyboard-only audit of the drawer/modal focus traps.
- Skeleton loading states don't announce themselves to screen readers.
- No WCAG color-contrast audit run formally.

### 10.5 Observability (Tier 5.4 + 5.4b)

- **Structured logging**: all backend logs go through pino via [lib/logger.js](lib/logger.js). JSON in production, `pino-pretty` colored output in development. Log level controlled by `LOG_LEVEL` env (`debug` in dev, `info` in prod by default).
- **Request correlation**: [middleware/requestId.js](middleware/requestId.js) assigns `req.id` (UUID v4 or honored inbound `X-Request-Id`), echoes it back on the response, and attaches `req.log = logger.child({reqId})`. Every handler error log line carries the `reqId`, so a client error can be traced back to the exact request.
- **Access log**: `pino-http` emits one structured line per request (`req`, `res`, `responseTime`). `customLogLevel` maps `>=500` to `error` and `>=400` to `warn`, so warn/error filters surface the bad requests automatically.
- **Client-error pipeline (Tier 5.4b)**: see §6.7. Browser failures of any kind flow to `POST /api/client-errors`, get a `req.log.error` line on the server side, and (if `SENTRY_DSN`/`VITE_SENTRY_DSN` are set) also flow into Sentry. The browser sends along the most recent server-side `reqId` it observed via `X-Request-Id`, so each client error can be tied back to the exact server request that rendered the failing page.
- **Sentry (Tier 5.4b)**: opt-in via env. When unset, both server and browser ship without Sentry overhead (server-side `lib/sentry.js` exports no-ops; client-side Vite tree-shakes the dynamic `@sentry/react` import). When set, server uses `@sentry/node` with OpenTelemetry instrumentation (initialized in [lib/instrument.js](lib/instrument.js) _before_ Express is required); browser uses `@sentry/react` with its own window listeners + the ErrorBoundary's explicit `captureException` calls.
- **Still missing**: no `/metrics` endpoint, no APM beyond Sentry, no log shipping to a managed log aggregator (CloudWatch / Application Insights / Loki). Captured under Tier 10 — Observability & scale in the forward roadmap.

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

### 11.5 Backup / Restore

Standard Postgres tooling (`pg_dump`, `pg_restore`). No app-specific export. Seed data is hand-curated in [data.json](data.json) and only re-runs when the users table is empty.

### 11.6 Cloud Deployment (Tier 9)

ScoreCast runs on Azure (`eastus2`) at https://bantryx.com. The whole stack is provisioned via Bicep IaC and updated by GitHub Actions CD on every push to `main`.

#### Resource topology

| Resource                 | Name                           | Role                                                                                                        | Cost/mo             |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------- |
| Resource Group           | `scorecast-prod`               | Container for everything                                                                                    | —                   |
| Container Apps env       | `scorecast-env-p3aaelev7xp52`  | Consumption plan; hosts the app + the migration Job                                                         | $0 idle             |
| Container App            | `scorecast-app`                | The Node/Express server; ingress on `:3000` → `:443`; scale 0→3                                             | $0 idle, ~$1/1k req |
| Container Apps Job       | `scorecast-migrate`            | One-shot `npm run db:migrate` triggered by CD before each roll-out                                          | $0 idle             |
| Container Registry       | `scorecastacrp3aaelev7xp52`    | Stores `scorecast:<sha>` images. Basic SKU, admin disabled, AcrPull via managed identity                    | ~$5                 |
| Postgres Flexible Server | `scorecast-pg-p3aaelev7xp52`   | B1ms (1 vCPU, 2 GB), Postgres 16, 32 GB storage, 7-day backups, public + firewall (`AllowAllAzureServices`) | ~$17                |
| Key Vault                | `scorecast-kv-p3aaelev7xp`     | RBAC mode; holds `jwt-secret`, `database-url`, `postgres-admin-password`, `resend-api-key`                  | ~$0.10              |
| Log Analytics workspace  | `scorecast-logs-p3aaelev7xp52` | Container Apps stdout sink; 1 GB/day cap                                                                    | ~$2                 |
| Application Insights     | `scorecast-appi-p3aaelev7xp52` | APM (currently unwired in app code — env var present, SDK not yet imported)                                 | ~$2                 |
| Azure AD app             | `scorecast-github-cd`          | Federated identity for GitHub OIDC; no client secret                                                        | —                   |
| DNS                      | (Cloudflare, `bantryx.com`)    | Apex CNAME flattened to Container Apps FQDN, `www` proxied for redirect rule                                | $13/yr domain       |

Idle total: **~$30–35/mo**.

#### Bicep modules ([infra/](infra/))

| File                        | What it provisions                                                                                                                                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.bicep`                | Orchestrator; takes `location`, `appName`, `imageTag`, `pgAdminPassword` (`@secure`), `customDomain`                                                                                                                                                                                            |
| `modules/logs.bicep`        | Log Analytics workspace + Application Insights linked to it                                                                                                                                                                                                                                     |
| `modules/registry.bicep`    | ACR Basic, admin disabled, anonymous pull disabled                                                                                                                                                                                                                                              |
| `modules/secrets.bicep`     | Key Vault, RBAC mode, soft-delete 7d                                                                                                                                                                                                                                                            |
| `modules/db.bicep`          | Postgres Flex B1ms; writes `database-url` (with `?sslmode=require`) and `postgres-admin-password` into Key Vault; firewall rule for Azure services                                                                                                                                              |
| `modules/app.bicep`         | Container Apps env + main app; system-assigned managed identity + RBAC for AcrPull on the registry + Key Vault Secrets User on the vault; secret references via `keyVaultUrl`; liveness + readiness probes on `/healthz`; `publicAppUrl` defaults to the Azure FQDN until `customDomain` is set |
| `modules/migrate-job.bicep` | Container Apps Job with `command: ['npm', 'run', 'db:migrate']`; same managed-identity RBAC pattern as the app                                                                                                                                                                                  |
| `modules/dns.bicep`         | Conditional Azure DNS zone (only when `customDomain` is non-empty). Currently unused for production because Cloudflare handles `bantryx.com`                                                                                                                                                    |

Resource names use `uniqueString(resourceGroup().id)` so re-deploys are idempotent and globally unique.

#### Secret resolution path

```
Container App (system-assigned managed identity)
  └─► Key Vault (RBAC role: Key Vault Secrets User)
        ├─ jwt-secret             ◄── seeded once via `az keyvault secret set`
        ├─ database-url           ◄── written by db.bicep at deploy time
        ├─ resend-api-key         ◄── placeholder; replace with real key when ready
        └─ postgres-admin-password ◄── written by db.bicep (kept for break-glass access)
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

| Area                         | Issue                                                                                                                                                                                                                                                                                                                                                                                  | Tier                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Tests                        | Playwright E2E covers 8 specs (pick/result, group lifecycle, comment+reaction, auth-security, friend lifecycle, notifications+badges, leaderboard scoring across odds, admin CRUD/bulk/cascade). No unit / integration tests below the E2E layer yet. Tier 4b additions (league sync, live-score job, audit log, league picker) verified by ad-hoc smokes — no Playwright coverage yet | future                    |
| Pick types                   | Only winner picks; no spread / over-under / score prediction. Deferred from Tier 4b after live-score UX bedded in                                                                                                                                                                                                                                                                      | future (post-4b)          |
| Match minute is approximate  | football-data.org free tier doesn't expose `minute` / `injuryTime`. Client estimates from kickoff + halfTime/phase signals. Soft by ~5 min around halftime. Swap to paid provider via [lib/footballApi.js](lib/footballApi.js) for an authoritative timer                                                                                                                              | future (provider swap)    |
| Streaks                      | Deferred — concurrent kickoffs make "consecutive correct" ambiguous (revisits when streak badges become a real product ask)                                                                                                                                                                                                                                                            | future                    |
| Audit log before-state       | Middleware records `after` payload only; `before` for updates/deletes would need per-entity pre-fetch hooks. Auth-failed admin attempts (401/403 thrown before middleware runs) are not audited                                                                                                                                                                                        | future                    |
| Real-time                    | No WebSocket; everything is HTTP polling at 30 s. Reaction count changes don't propagate across viewers in real time. Live-score updates land via the 60-s cron + 30-s frontend poll                                                                                                                                                                                                   | 7                         |
| Notification spam            | Bulk-setResult can produce many notifications in one request; no batching/dedup. Live-score auto-finalization also fan-outs per-pick on result transition                                                                                                                                                                                                                              | 7                         |
| Cache scope                  | `leaderboardCache` is process-local; a multi-instance deploy would see stale reads across replicas. Refresh-token rows are in Postgres so they survive a restart, but the rate-limit + lockout counters are in-memory. Today the app runs single-process so this is fine                                                                                                               | Tier 10.4 (Redis backend) |
| Server-side log shipping     | pino → stdout → Container Apps → Log Analytics workspace (Tier 9.6). Application Insights is provisioned but its SDK isn't wired into app code yet. Sentry covers errors but not access logs                                                                                                                                                                                           | Tier 10.6                 |
| Health / readiness probes    | `/healthz` exists (Tier 9.4) and is used by Container Apps liveness + readiness probes — but it doesn't ping the DB or Redis. A real readiness check (`/readyz` with DB ping) is still pending                                                                                                                                                                                         | Tier 10.1                 |
| Metrics                      | No `prom-client` / `/metrics` endpoint; no request-duration histogram, no cache hit/miss counters                                                                                                                                                                                                                                                                                      | Tier 10.3                 |
| Multi-device session listing | `refresh_tokens.userAgent` is captured, but there's no UI for "active sessions" or "sign me out of all devices" — the latter is implemented as `revokeAllUserRefreshTokens` but only triggered by password reset today                                                                                                                                                                 | future                    |
| Reused-recovery-code warning | A second use of an already-consumed recovery code returns generic 400; no alert/notification to the user that someone else may have used a stolen code                                                                                                                                                                                                                                 | future                    |

---

## 13. Roadmap

The live forward roadmap is in `C:\Users\vinde\.claude\plans\can-you-confirm-that-reflective-kay.md` (Tiers 4b → 10). The original tier plan lives at `C:\Users\vinde\.claude\plans\go-through-this-codebase-warm-cloud.md` for historical context.

Summary:

- ✅ **Tier 1** — Foundational hardening (bcrypt, RBAC, rate-limit, zod, JWT secret, unique pick index).
- ✅ **Tier 2** — UX completions (outcome display, full leaderboards, my-picks, sections, countdown, skeletons, confirm, mobile, a11y).
- ✅ **Tier 3** — Social/engagement (profiles, badges, friends, public groups, comments, notifications).
- ✅ **Tier 4a** — Admin UI for game CRUD + user moderation.
- ✅ **Tier 4b** — External football data + leagues/seasons + audit log. Shipped 2026-05-16/17 across 3 chunks: football-data.org v4 client + leagues/seasons schema + manual sync + LeagueManager admin tab (Chunk 1); node-cron scheduler with Postgres advisory locks + daily fixture sync + 60-s live-score poll with reconcile pass + live-minute estimate from kickoff + halfTime/phase signals + live-score game card (Chunk 2); audit-log middleware + paginated admin view + public `/api/leagues` + league/season picker on the games view + `games.leagueId NOT NULL` tightening (Chunk 3). Picks remain winner-only (multi-kind deferred). Cost: $0/mo via the free tier. See §8.16.
- ✅ **Tier 5 (core)** — Ops & reliability: migrations framework (5.1), leaderboard caching (5.2), transactional cascades (5.3), structured logging (5.4), N+1 elimination (5.7), HTTP compression (5.6).
- ✅ **Tier 5.4b** — Frontend error reporting: React `ErrorBoundary`, `POST /api/client-errors`, window listeners + reporter, `X-Request-Id` capture, Sentry SDK opt-in. See §6.7.
- ✅ **Tier 5.5** — Playwright E2E. Three original specs in [tests/e2e/](tests/e2e/): `pick-and-result` (register → pick → admin set result → leaderboard updates), `group-lifecycle` (create → invite → accept → transfer → delete), `comment-reaction` (post → edit → react → delete). Deterministic seeder per run; CI job in [.github/workflows/ci.yml](.github/workflows/ci.yml) with cached Chromium and trace upload on failure. Rate limiters share a `skipInTest` predicate (gated on `NODE_ENV=test`) so the suite doesn't 429 itself off shared 127.0.0.1 traffic.
- ✅ **Tier 5.5b** — Playwright coverage expansion. Five new specs (`auth-security`, `friend-system`, `notifications-badges`, `leaderboard-scoring`, `admin-panel`) + two shared helpers ([tests/e2e/helpers/api.js](tests/e2e/helpers/api.js): `apiLogin` / `setGameResult` / `createPick` / `getLeaderboard` HTTP helpers + `resetUserLockout` / `insertPasswordResetToken` / `clearFriendships` / `clearPicksAndBadges` / `clearNotifications` / `clearGameResults` / `getUserId` DB helpers, and [tests/e2e/helpers/admin.js](tests/e2e/helpers/admin.js): `openAdminTab`). Covered invariants: Tier 6.6 lockout (5 bad logins lock; correct password then still 401 with the same message; unknown username same response — no enumeration); Tier 6.4/6.8 password reset (`/?resetToken=...` URL flow + lockout-cascade clear); Tier 6.7 CSRF reject (POST without `X-CSRF-Token` → 403); Tier 5.3 cascade delete (deleted user's owned groups + memberships are wiped in one transaction); Tier 5.2 cache invalidation (`setResult` updates `/api/leaderboard` immediately, not after 30 s TTL); probability-weighted scoring across 50/50 + 60/40 + 40/60 odds verifying `lib/scoring.js` end-to-end (alice 50 favorite pts vs. bob 170 underdog pts in a single deterministic scenario); badge unlocks (`first-pick`, `first-win`) fire `notify('badge', …)` alongside the `pick-scored` notification; bell unread count + mark-read + mark-all paths. Total suite now 8 specs / 15 tests / ~47 s on Chromium.
- ✅ **Tier 6** — Security hardening: CORS allowlist (6.1), helmet (6.2), email service (6.3), password reset (6.4), email verification on register (6.5), account lockout (6.6), CSRF double-submit (6.7), HttpOnly cookie auth + rotating refresh tokens (6.8), TOTP 2FA (6.9), per-route rate limits (6.10), dropped `nedb-promises` (6.11). See §8.15.
- ❌ **Tier 7** — Real-time & engagement: scheduler-driven notifications, WebSocket/SSE, web push, email digests, prefs.
- ✅ **Tier 8** (minus 8.6) — User capabilities: group lifecycle (leave/transfer/delete), pick deletion, avatars, search, profile bio + displayName, comment edit + reactions, leaderboard sort + pagination, bulk admin actions.
- ✅ **Tier 8.6** — Profile privacy. Shipped 2026-05-16: `users.profileVisibility` ENUM (public/friends/private); `UserService.getProfileByUsername` gate; `LeaderboardService.getOverallForViewer` / `getForGroupForViewer` masking; ProfileView Settings radio; ProfileDrawer "private" sheet; 5-test profile-privacy.spec.js.
- ✅ **Tier 9** (less 9.10 TS + 9.11 Storybook) — DX, packaging & cloud deploy: ESLint + Prettier + Husky + lint-staged (9.1), frontend code-splitting (9.2), OpenAPI from zod (9.3, dev-only), Dockerfile + docker-compose + `/healthz` (9.4), GitHub Actions CI (9.5), Bicep IaC for Azure (9.6), Key Vault secrets wiring (9.9), CD workflow with OIDC (9.7), custom domain `bantryx.com` + Azure managed TLS (9.8). **App is live at https://bantryx.com.** See §11.6.
- 🟡 **Tier 9 follow-ups** — TypeScript migration (9.10) and Storybook (9.11) parked at end of roadmap; Bicep ↔ custom-domain reconciliation shipped 2026-05-16 (see §11.6).
- ❌ **Tier 10** — Observability & scale: `/readyz` (10.1), Prometheus metrics (10.3), managed Redis (10.4, replaces single-process leaderboard cache), graceful SIGTERM shutdown (10.5), cloud log shipping wired into App Insights SDK (10.6).
- ✅ **Tier 13** — Codebase cleanup / modularization (six chunks). `server.js` 2262 → 157 LOC (13.1 response/error infra + 13.2 routes/ split, 13.4 services/ + 13.5 helper consolidation). `src/App.jsx` 1308 → 71 LOC (13.6 contexts + 13.7 hooks, Chunk 5 component migration to hooks, Chunk 6 DashboardView/AuthView/SkeletonView extraction). New lint rules: backend `no-console` (with `lib/instrument.js` carve-out) + ban deep relative imports. Pure refactor — Playwright 3/3 green on every chunk. See §6.2, §6.3, §6.6.

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
