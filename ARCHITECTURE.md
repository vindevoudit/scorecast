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
│   localStorage:                          (Bearer token, JSON)         │
│     scorecastToken                                                    │
│                                                                       │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ HTTPS (production) / HTTP (dev)
                         │ /api/* + static assets
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Express server (server.js)                     │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ requestId → pino-http → compression → cors → bodyParser →     │   │
│  │ cookieParser → express.static(dist/)                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ rate-limit   │  │ authMiddleware│ │ validate(zodSchema)       │  │
│  │ (login/regr.)│  │ requireAdmin │ │                            │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                       │
│  Route handlers ─── Sequelize models ─── helper fns                  │
│                          │             (scorePick, notify,           │
│                          │              evaluateBadges,              │
│                          │              cascadeDelete*,              │
│                          │              leaderboardCache, …)         │
│  ┌──────────────────────┴──────────────────────────────────────┐   │
│  │ lib/leaderboardCache (in-process Map, 30s TTL)              │   │
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
            │  SequelizeMeta (umzug bookkeeping)  │
            └─────────────────────────────────────┘
```

There is **one server process**, **one database**, **no message queue**, **no worker**, **no CDN**. A small in-process leaderboard cache lives in the Node heap (Tier 5.2). Notifications and badges are fired synchronously inside the same request that triggers them (in a `.catch(() => {})` to keep the user-facing response from failing if a side-effect errors), and they fire **outside** any transaction so a rollback never produces ghost messages.

---

## 3. Tech Stack & Rationale

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend framework | **React 18** with hooks-only | Familiar, easy hiring, no SSR needs |
| Build tool | **Vite 5** | Fastest DX for vanilla React; dev proxy avoids CORS in development |
| Styling | **Tailwind CSS 3** | Utility classes keep components self-contained; no design-token sprawl |
| HTTP client | **`fetch`** (no axios) | Standard; the wrapper handles JSON + auth header + 401 |
| State | **`useState` + `useMemo` + `useCallback`** | No Redux/Zustand/Context — App.jsx is the single state owner |
| Backend | **Node 18+ / Express 4** | Tiny surface, no router framework, easy to read |
| ORM | **Sequelize 6** | Predictable, supports raw SQL escape hatches |
| Migrations | **sequelize-cli + umzug** (Tier 5.1) | sequelize-cli for `npm run db:*` scripts; umzug for programmatic dev-boot execution. Versioned files under `migrations/`. See §7.3 |
| DB | **PostgreSQL** | Need ENUMs, partial unique indexes, and `LEAST/GREATEST` functional indexes — all Postgres-specific |
| Auth | **JWT (HS256) via `jsonwebtoken`** | Stateless, 7-day expiry, no session table |
| Password hashing | **bcryptjs** (cost 10) | Pure-JS, no native build step needed on Windows |
| Validation | **zod** | Schema-first request validation; emits structured error JSON |
| Rate limiting | **express-rate-limit** | In-memory, per-IP; only applied to `/api/login` and `/api/register` |
| Logging | **pino + pino-http** (Tier 5.4) | Structured JSON in prod, `pino-pretty` in dev. Every request gets `req.id` (UUID or inbound `X-Request-Id`) and a `req.log` child logger |
| HTTP compression | **`compression`** (Tier 5.6) | Gzip middleware mounted before static + body parser; ~75% size reduction on the JS bundle |
| Leaderboard cache | **In-memory Map** with 30 s TTL (Tier 5.2) | No Redis dependency; appropriate for the current single-process deployment. See §8.14 |
| Error reporting | **React `ErrorBoundary` + window listeners → `POST /api/client-errors`** (Tier 5.4b); **Sentry SDK** (`@sentry/node` + `@sentry/react`) gated behind `SENTRY_DSN` / `VITE_SENTRY_DSN` (lazy on both sides). See §6.7 + §10.1 |

Notable **non-choices**: no TypeScript, no testing framework wired up, no Docker, no CI/CD config. These are deliberate scope decisions documented in [CLAUDE.md](CLAUDE.md).

---

## 4. Repository Layout

```
ScoreCast/
├── server.js                            # Single-file Express app (~1550 LOC)
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
│   └── 20260513000007-comment-reactions-table.js
│
├── seeders/                             # Tier 5.1: idempotent seeders
│   └── 20260513000001-seed-password-backfill.js   # re-hashes any plaintext seed password matching data.json
│
├── lib/                                 # Process-local helpers
│   ├── logger.js                        # Tier 5.4: pino instance (pretty in dev, JSON in prod, LOG_LEVEL env)
│   ├── leaderboardCache.js              # Tier 5.2: getOrBuild/invalidate/stats; 30s TTL in-memory Map
│   ├── instrument.js                    # Tier 5.4b: Sentry.init() — MUST be the very first require() in server.js
│   └── sentry.js                        # Tier 5.4b: captureException + setupExpressErrorHandler wrappers (no-ops if SENTRY_DSN unset)
│
├── middleware/
│   └── requestId.js                     # Tier 5.4: assigns req.id + req.log child; echoes X-Request-Id header
│
├── models/                              # Sequelize models — one file per table
│   ├── index.js                         # Sequelize init + associations + initDatabase + umzug shim (runMigrations) + seedDatabase
│   ├── User.js                          # bcrypt beforeCreate/beforeUpdate hooks; displayName + bio
│   ├── Game.js
│   ├── Group.js                         # visibility ENUM('private'|'public')
│   ├── GroupMember.js                   # composite PK (groupId, userId)
│   ├── GroupInvite.js
│   ├── Pick.js                          # unique (userId, gameId)
│   ├── Badge.js                         # unique (userId, slug)
│   ├── Friendship.js                    # pending|accepted; unique pair via functional index
│   ├── Comment.js                       # indexed by gameId; editedAt (Tier 8)
│   ├── CommentReaction.js               # unique (commentId, userId, emoji); indexed by commentId (Tier 8)
│   └── Notification.js                  # indexed by (userId, read, createdAt)
│
├── badges/
│   └── catalog.js                       # Source of truth for badge slugs/names/emojis (server + frontend)
│
├── validation/
│   ├── schemas.js                       # All zod schemas, one per POST/PUT route
│   └── middleware.js                    # validate(schema) → 400 with structured issues on failure
│
├── src/                                 # React frontend
│   ├── main.jsx                         # React.createRoot bootstrap; mounts ErrorBoundary, installs clientErrorReporter, calls initSentry()
│   ├── App.jsx                          # ~1100 LOC; state, tabs, request(), all handlers
│   ├── index.css                        # @tailwind base/components/utilities
│   ├── lib/
│   │   ├── clientErrorReporter.js       # Tier 5.4b: window error + unhandledrejection listeners; throttled POST to /api/client-errors; dispatches scorecast:client-error DOM event
│   │   └── sentry.js                    # Tier 5.4b: dynamic import('@sentry/react') gated on VITE_SENTRY_DSN (Vite tree-shakes when unset)
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
│       ├── LoginForm.jsx
│       ├── RegisterForm.jsx
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
4. cors({ origin: true, credentials: true })             // permissive in dev; tighten for prod (Tier 6.1)
5. bodyParser.json()                                     // parses application/json
6. cookieParser()                                        // populates req.cookies
7. express.static(dist/)                                 // serves built assets if path matches
8. (per-route) rate-limit | authMiddleware | requireAdmin | validate(schema)
9. Route handler                                         // typically async; uses Sequelize models + req.log
10. Response: res.json({...}) or res.status(N).json({error: '...'})
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

#### Authentication — `authMiddleware`
Defined inline in [server.js](server.js). Tries both auth strategies:
- `req.cookies.token` (if present)
- `Authorization: Bearer <jwt>` header (fallback)

Verifies the JWT with `jwt.verify(token, JWT_SECRET)`. On success, attaches the decoded payload `{id, username, role}` to `req.user`. On failure, returns `401 {error: 'Invalid token'}` or `401 {error: 'Authentication required'}`.

**Token issuance** happens in `createToken(user)`:
```js
jwt.sign({ id, username, role }, JWT_SECRET, { expiresIn: '7d' })
```

`JWT_SECRET` resolution:
- Read from `process.env.JWT_SECRET`.
- If absent **and** `NODE_ENV === 'production'` → server throws on startup (refuses to boot).
- If absent in dev → logs a warning and uses the literal `'scorecast-dev-only-do-not-use'`. Tokens issued under this secret are not portable across environments and are not safe in production.

#### Authorization — `requireAdmin`
Trivial: `if (req.user?.role !== 'admin') return 403`. Must always run **after** `authMiddleware`. Used by all `/api/admin/*` routes and by `POST /api/games/:gameId/result`.

#### Validation — `validate(schema)`
Factory in [validation/middleware.js](validation/middleware.js). Runs `schema.safeParse(req.body)`. On failure returns:
```json
{ "error": "Invalid request body",
  "issues": [{"path": "homeProbability", "message": "..."}] }
```
On success it **replaces `req.body` with the parsed (sanitized, defaulted) value** so handlers can trust it. All input mutations from zod (`.trim()`, `.toLowerCase()`, coercions) take effect here.

Schemas live in [validation/schemas.js](validation/schemas.js): `registerSchema`, `loginSchema`, `createGroupSchema` (with optional `visibility`), `inviteSchema`, `pickSchema`, `resultSchema`, `friendRequestSchema`, `visibilitySchema`, `commentSchema`, `createGameSchema`, `updateGameSchema`, `roleSchema`, `transferOwnerSchema`, `editProfileSchema`, `reactionSchema` (emoji ∈ `ALLOWED_EMOJIS`), `bulkGameSchema`, `bulkUserSchema`.

#### Rate limiting
Three limiters from `express-rate-limit`, all configured `standardHeaders: true, legacyHeaders: false`:
- `loginLimiter`: 5 requests / 15 min per IP. Applied to `POST /api/login`.
- `registerLimiter`: 3 requests / hour per IP. Applied to `POST /api/register`.
- `clientErrorLimiter` (Tier 5.4b): 30 requests / 5 min per IP. Applied to `POST /api/client-errors`. Tuned so a runaway client-side throw can't flood the server log.

In-memory store, so a server restart wipes the counters. Acceptable for a single-instance deployment; would need Redis-backed limits for horizontal scaling.

#### CORS
`cors({ origin: true, credentials: true })`. `origin: true` reflects the request's `Origin` header — i.e. allows any origin, which is too permissive for production. Documented in [CLAUDE.md](CLAUDE.md) and tracked as a known issue.

### 5.4 Route Catalogue

Routes are registered in [server.js](server.js) in roughly this order:
1. Auth: `POST /api/register`, `POST /api/login`, **`POST /api/client-errors`** (Tier 5.4b — soft-auth: logs `userId` if token is valid, anonymous otherwise; structured-logs `clientError` payload at `error` or `warn` level per `level` field)
2. Identity: `GET /api/me`, `PUT /api/me` (displayName + bio edit)
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

| Helper | Purpose | Called from |
| --- | --- | --- |
| `scorePick(pick, game)` | Authoritative scoring formula | `buildUserSummary`, `buildGroupLeaderboard`, profile endpoint, result + bulk-result hooks |
| `notify(userId, type, title, body?, link?)` | Creates a `Notification` row; swallows errors | Invite, accept, friend-request, friend-accept, public-group join, group leave/transfer/delete, badge award, game result |
| `awardBadge(userId, slug)` | Inserts a `Badge` row (unique-constrained); fires a `badge` notification | `evaluateBadges` only |
| `evaluateBadges(userId, ctx?)` | Re-runs all badge unlock conditions for a user; idempotent | `POST /api/picks`, `POST /api/groups`, per-user inside the result hook (single + bulk) |
| `getFriendshipBetween(a, b)` | Finds the single row (in either direction) | Profile endpoint, friend-request guards |
| `friendStatusFrom(friendship, viewer, target)` | Returns `'self' \| 'none' \| 'pending-in' \| 'pending-out' \| 'friends'` | Profile endpoint |
| `buildUserSummary()` | Overall leaderboard rows (includes displayName) | `GET /api/leaderboard` |
| `buildGroupLeaderboard(groupId)` | Group-scoped rows (includes displayName + winRate) | `GET /api/leaderboard?groupId=` |
| `sortLeaderboard(rows, orderBy)` | Sort by `points / winRate / username`, attach `rank` | Group leaderboard pagination path |
| `cascadeDeleteUser(target, {transaction})` | 9-step user cascade (groups owned, picks, comments, friendships, memberships, invites, then user). Tier 5.3: accepts `{transaction}` and forwards to every internal `destroy()`. | `DELETE /api/admin/users/:id`, `POST /api/admin/users/bulk` |
| `cascadeDeleteGame(game, {transaction})` | Pick + comment cleanup, then game. Tier 5.3: tx-aware. | `DELETE /api/admin/games/:id`, `POST /api/admin/games/bulk` |
| `cascadeDeleteGroup(group, {transaction})` | (Tier 5.3) Members + invites + group. Extracted from the inline body of `DELETE /api/groups/:groupId`. | `DELETE /api/groups/:groupId` |

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
src/main.jsx  →  React.createRoot()  →  <App />
src/App.jsx + components/  →  Vite (esbuild + Rollup)  →  dist/index.html, dist/assets/*.js, *.css
```

`npm run dev` starts Vite's dev server on `localhost:5173` with HMR. The dev server proxies `/api/*` to `localhost:3000` (configured in [vite.config.js](vite.config.js)), so the frontend code can use relative URLs in both dev and prod with no env-var gymnastics.

`npm run build` produces a single-page bundle in `dist/`. There is **no code-splitting beyond Vite's defaults**, **no service worker**, **no preact compat**.

### 6.2 State Management

`src/App.jsx` is the **single source of truth** for all client state. There is no Context, no Redux, no Zustand. State is held in roughly two dozen `useState` hooks at the top of the component:

```
token, user, games, groups, picks, pendingInvites,
leaderboard, selectedGroupId, view, status, loading,
authData, confirmingLogout, showCompleted,
profileUsername, profile, profileLoading, profileBusy,
friends, discoverGroups, ownProfile,
groupOrderBy, groupOffset                      // Tier 8.8: leaderboard sort + pagination
```

Derived state uses `useMemo` (`pickMap`, `upcomingGames/liveGames/completedGames`, `tabs`).

> **Note on `pickMap`**: it stores the **full pick object** keyed by `gameId`, not just the choice. This was changed in Tier 8.2 so `GameCard` can pass `existingPickId` to the undo-pick handler. The card derives `existingChoice = existingPick?.choice` for the visual state.

`useCallback` is used for the `request` helper and `fetchProfile` — they're passed to children (`NotificationBell`, `CommentThread`) where stable references matter for `useEffect` dependencies.

### 6.3 The `request()` Helper

The heart of frontend-backend communication. Single function, ~20 lines:

```js
const request = useCallback(async (path, options = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { ...(options.headers || {}), ...headers },
  });
  if (response.status === 401 && tokenRef.current) {
    handleSessionExpired();
    throw new Error('Session expired');
  }
  if (response.status === 204) return null;
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error((data && data.error) || 'Request failed');
  return data;
}, []);
```

Important properties:
- **Always sends JSON content-type.** Callers responsible for `JSON.stringify`-ing the body.
- **Uses a `tokenRef`** (not `token` directly) so the closure stays stable across renders while still seeing the latest token value.
- **Auto-handles 401**: when an authenticated request returns 401, it clears the token via `handleSessionExpired` and throws a special `'Session expired'` error. Callers conventionally check `if (error.message !== 'Session expired')` before surfacing the error to the user, to avoid double-toasting.
- **Tolerates empty responses** (`204` and zero-length bodies).
- **Tier 5.4b**: every response's `X-Request-Id` header is captured and pushed into `setLastRequestId()` ([src/lib/clientErrorReporter.js](src/lib/clientErrorReporter.js)) so any subsequent client-error report carries the most recent server reqId. Thrown error objects also get a `.reqId` property attached, so handler `.catch()` sites can include it in their own error reports.

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
└── <App>
    ├── (auth panel) <LoginForm> / <RegisterForm>
    └── (dashboard)
    ├── header card
    ├── tabs row
    │   ├── <SearchBar>                  // Tier 8.4
    │   ├── <NotificationBell>
    │   └── logout button → <ConfirmModal>
    │
    ├── view === 'games':
    │     <GameCard>* (Avatar in comments, undo-pick link, inline <CommentThread>)
    │     sidebar: <LeaderboardRow>* (with Avatar, clickable → opens drawer)
    │
    ├── view === 'mypicks': <PicksHistory>
    │
    ├── view === 'groups':
    │     create form (with visibility radio)
    │     Discover list
    │     <FriendsList>
    │     pending invites
    │     <GroupCard>*  (Avatar member chips + leave/transfer/delete menu)
    │
    ├── view === 'leaderboard':
    │     <LeaderboardCard>  <GroupLeaderboardCard>  (sort + pagination)
    │
    ├── view === 'profile' (self):
    │     <ProfileView editable onSaveProfile> (Avatar header, displayName/bio edit form)
    │
    └── view === 'admin' (admin only): <AdminPanel>
                                         ├── <GameManager>  (checkbox column + bulk action bar)
                                         └── <UserManager>  (checkbox column + bulk action bar)

Overlays (rendered above the dashboard):
├── <ConfirmModal>           (logout, deletions, bulk confirmations, group leave/delete)
└── <ProfileDrawer>           (any leaderboard row click)
        └── <ProfileView>
              ├── <Avatar>
              └── <BadgeWall>

<CommentThread> (inside each GameCard) renders:
  <CommentRow>* — each with <Avatar>, edit form (author only), 5-emoji reaction strip
```

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
│  3. request() throws        ──▶ caller .catch() in App.jsx                   │
│     (handled API error)        └─ showStatus(error.message)  (cyan toast)    │
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
- [src/lib/clientErrorReporter.js](src/lib/clientErrorReporter.js): installs `window.error` and `unhandledrejection` listeners. Hard-throttled to **5 reports per 60 s window** (the rest are dropped silently — prevents runaway-error storms). `reportClientError` posts via `fetch({keepalive: true})` so reports complete even if the page is unloading. Clips `stack` and `componentStack` to **8 KB** each and `message` to 500 chars, matching the server's zod ceilings. Failures inside the reporter are swallowed (never re-feed the listener). Also dispatches a `scorecast:client-error` DOM event so App.jsx can show a toast.
- [src/lib/sentry.js](src/lib/sentry.js): `initSentry()` is `async` — reads `import.meta.env.VITE_SENTRY_DSN` and, if set, does a dynamic `await import('@sentry/react')` then calls `init({dsn, environment, tracesSampleRate: 0})`. If unset, **the entire dynamic-import branch is dead-code-eliminated by Vite** — zero `@sentry/react` bytes in the bundle (verified: 0 occurrences of "sentry" in `dist/assets/*.js` when DSN unset).
- [src/main.jsx](src/main.jsx): bootstrap order — `initSentry()` (fire-and-forget async), `installClientErrorReporter()` (synchronous), then `createRoot().render(<StrictMode><ErrorBoundary><App/></ErrorBoundary></StrictMode>)`.
- [src/App.jsx](src/App.jsx): single `useEffect` listens for `scorecast:client-error` and triggers a *"Something went wrong — refresh if things look off."* toast via the existing `setStatus`/clearTimeout machinery.

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
new Sequelize(process.env.DATABASE_URL || {
  host: 'localhost', database: 'scorecast_db',
  username: 'postgres', password: 'postgres',
  dialect: 'postgres',
})
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

| File | Effect |
| --- | --- |
| `20260513000001-add-user-role.js` | ENUM `enum_users_role` + `users.role` column |
| `20260513000002-pick-unique-index.js` | `picks_user_game_unique (userId, gameId)` |
| `20260513000003-group-visibility-enum.js` | ENUM `enum_groups_visibility` + `groups.visibility` column |
| `20260513000004-friendship-pair-unique.js` | Functional unique index on `LEAST/GREATEST(requesterId, addresseeId)` |
| `20260513000005-user-displayname-bio.js` | `users.displayName VARCHAR(60)` + `users.bio TEXT` |
| `20260513000006-comment-edited-at.js` | `comments.editedAt TIMESTAMPTZ` |
| `20260513000007-comment-reactions-table.js` | `CREATE TABLE comment_reactions IF NOT EXISTS` (existing DBs already had it from `sync({alter:false})`) |

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
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `username` | STRING UNIQUE NOT NULL | Case-insensitive lookup via `iLike` |
| `password` | STRING NOT NULL | bcrypt hash; the model's `beforeCreate`/`beforeUpdate` hooks auto-hash anything not already matching `^\$2[aby]\$` |
| `role` | ENUM('user','admin') NOT NULL DEFAULT 'user' | Added via migration |
| `displayName` | VARCHAR(60) NULLABLE | Tier 8. Used in place of username everywhere when set |
| `bio` | TEXT NULLABLE | Tier 8. Length-capped at 280 by zod, no DB-level constraint |
| `createdAt` | TIMESTAMPTZ NOT NULL DEFAULT NOW | |

#### `games`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `homeTeam` / `awayTeam` | STRING NOT NULL | |
| `date` | TIMESTAMPTZ NOT NULL | UTC; the kickoff time |
| `homeProbability` / `awayProbability` | DECIMAL(3,2) NOT NULL | Float in `[0,1]`; admin form validates sum-to-1.0 ±0.01 |
| `result` | ENUM('home','away') NULLABLE | `NULL` = not yet resolved |

#### `groups`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `name` | STRING NOT NULL | |
| `ownerId` | UUID NOT NULL | FK loose (no DB constraint); enforced in app |
| `visibility` | ENUM('private','public') NOT NULL DEFAULT 'private' | |
| `createdAt` | TIMESTAMPTZ NOT NULL DEFAULT NOW | |

#### `group_members`
Composite primary key `(groupId, userId)`. No additional columns.

#### `group_invites`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `groupId` | UUID NOT NULL | |
| `username` | STRING NOT NULL | Stored as username, not userId, so case-insensitive invites resolve at accept-time |
| `createdAt` | TIMESTAMPTZ DEFAULT NOW | |

#### `picks`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `userId` | UUID NOT NULL | |
| `gameId` | UUID NOT NULL | |
| `choice` | ENUM('home','away') NOT NULL | |
| `submittedAt` | TIMESTAMPTZ DEFAULT NOW | Updated on edit, not just create |

**Unique index**: `picks_user_game_unique (userId, gameId)`. App-level upsert is in `POST /api/picks`.

#### `badges`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `userId` | UUID NOT NULL → users(id) ON DELETE CASCADE | |
| `slug` | STRING NOT NULL | Must exist in [badges/catalog.js](badges/catalog.js) |
| `awardedAt` | TIMESTAMPTZ DEFAULT NOW | |

**Unique index**: `badges_user_slug_unique (userId, slug)`. `awardBadge()` relies on the constraint to make repeated calls idempotent (catches the conflict).

#### `friendships`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `requesterId` / `addresseeId` | UUID NOT NULL → users(id) | `ON DELETE NO ACTION` (Sequelize default); the user-delete admin endpoint cleans these up explicitly |
| `status` | ENUM('pending','accepted') NOT NULL DEFAULT 'pending' | |
| `createdAt` | TIMESTAMPTZ DEFAULT NOW | |
| `acceptedAt` | TIMESTAMPTZ NULLABLE | Set on accept |

**Unique functional index**: `friendships_pair_unique (LEAST(requesterId, addresseeId), GREATEST(requesterId, addresseeId))`. This prevents both `(A, B)` and `(B, A)` from existing simultaneously, regardless of who sent the request. Postgres-only feature.

#### `comments`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `gameId` | UUID NOT NULL → games(id) ON DELETE CASCADE | |
| `userId` | UUID NOT NULL → users(id) ON DELETE NO ACTION | Cleaned up in admin user-delete |
| `body` | TEXT NOT NULL | Validation: trim, 1–500 chars |
| `createdAt` | TIMESTAMPTZ DEFAULT NOW | |
| `editedAt` | TIMESTAMPTZ NULLABLE | Tier 8. Set on every successful `PUT /api/comments/:id`. Frontend renders `(edited)` in the row |

**Index**: `comments_game_idx (gameId)` for fast thread fetch.

#### `comment_reactions` (Tier 8)
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `commentId` | UUID NOT NULL → comments(id) ON DELETE CASCADE | |
| `userId` | UUID NOT NULL | Cleaned up in admin user-delete (best-effort) |
| `emoji` | STRING NOT NULL | Free-form at the DB layer, gated by `ALLOWED_EMOJIS` zod enum at the API layer |
| `createdAt` | TIMESTAMPTZ DEFAULT NOW | |

**Unique index**: `comment_reactions_unique (commentId, userId, emoji)` — `POST /api/comments/:id/reactions` relies on the constraint for idempotency (catches the duplicate-insert error).
**Index**: `comment_reactions_comment_idx (commentId)` for fast thread fetch.

#### `notifications`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `userId` | UUID NOT NULL → users(id) ON DELETE CASCADE | |
| `type` | STRING NOT NULL | Free-form: `invite`, `pick-scored`, `friend-request`, `group-join`, `badge`. **Not an ENUM** so adding new types doesn't require a migration |
| `title` | STRING NOT NULL | |
| `body` | TEXT NULLABLE | |
| `link` | STRING NULLABLE | Reserved for deep-linking; not yet rendered |
| `read` | BOOLEAN NOT NULL DEFAULT false | |
| `createdAt` | TIMESTAMPTZ DEFAULT NOW | |

**Index**: `notifications_user_read_idx (userId, read, createdAt)`.

### 7.5 Cascade Behavior Summary

| Parent → Child | On parent delete |
| --- | --- |
| `games` → `picks` | App-level cleanup in `cascadeDeleteGame()` (single + bulk admin paths) |
| `games` → `comments` | `ON DELETE CASCADE` at DB level **and** app-level cleanup in `cascadeDeleteGame()` (belt-and-braces) |
| `comments` → `comment_reactions` | `ON DELETE CASCADE` at DB level + explicit `CommentReaction.destroy({where: {commentId}})` in `DELETE /api/comments/:id` |
| `users` → `badges`, `notifications` | `ON DELETE CASCADE` at DB level |
| `users` → `picks`, `comments`, `friendships`, `group_members`, owned `groups`, `group_invites` (by username) | **App-level cleanup only** in `cascadeDeleteUser()` (single + bulk admin paths). The user-delete handler is the most complex deletion path in the system; see §8.9 |
| `groups` → `group_members`, `group_invites` | App-level cleanup in `DELETE /api/groups/:groupId` (Tier 8) |

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

| Action | Endpoint | Effect |
| --- | --- | --- |
| Create | `POST /api/groups` | Inserts Group + GroupMember (creator). Fires `group-founder` badge eval. Body accepts `visibility: 'private' \| 'public'` (default private). |
| Invite | `POST /api/groups/:groupId/invite` | Member-only. Stores `GroupInvite { groupId, username }`. Notifies invitee. |
| Accept invite | `POST /api/groups/:groupId/invite/:inviteId/accept` | Username on JWT must match invite username. Inserts GroupMember, deletes the invite, notifies owner. |
| Decline invite | `POST /api/groups/:groupId/invite/:inviteId/decline` | Just deletes the invite row. |
| Discover | `GET /api/groups/discover` | Returns up to 20 public groups the caller is **not** in, with member counts. |
| Join (public) | `POST /api/groups/:groupId/join` | Only succeeds if `visibility='public'`. Inserts GroupMember, notifies owner. |
| Leave (Tier 8) | `POST /api/groups/:groupId/leave` | Removes caller from `group_members`. **400 if owner** — must transfer first. Notifies owner. |
| Transfer (Tier 8) | `POST /api/groups/:groupId/transfer` | Owner-only. Body `{newOwnerId}`. Must be a current member. Updates `groups.ownerId`. Notifies new owner. |
| Delete (Tier 8) | `DELETE /api/groups/:groupId` | Owner-only. Cascades members + invites, then destroys the group. Notifies all (former) non-owner members. |
| Toggle visibility | `POST /api/groups/:groupId/visibility` | Owner-only. |

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
- `yourReactions: [emoji...]` — the *caller's* reactions only, so the UI can highlight toggled buttons

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
- Uses `displayName` for the displayed *letter* when set; the **color is always derived from `username`** so renames don't shuffle the user's color identity.

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
const value = await cache.getOrBuild(key, builder);   // serve from cache or rebuild + store
cache.invalidate(key | 'all');                         // drop one key (or everything)
cache.stats();                                         // { size, hits, misses, keys: [{key, ageMs, ttlRemainingMs}] }
```

**Shape**: `Map<string, { value, expiresAt }>` with a 30 s TTL (matches the frontend notification poll cadence so cache misses are bounded). The cached value is the **unsorted full array** of rows — sort, slice, and `viewerRow` computation happen per request **on top of** the cached array, so one cache entry serves all `orderBy` / `offset` / `limit` combinations.

**Keys**:
- `'overall'` — the global leaderboard
- `group:<groupId>` — per-group leaderboard

**Invalidation policy** is conservative: most mutations call `cache.invalidate('all')` because picks affect the overall standings and may cross group boundaries. Group-scoped mutations (`/join`, `/leave`, accept-invite, group delete) invalidate only their `group:<id>` key.

| Mutation endpoint | Invalidation |
| --- | --- |
| `POST /api/picks`, `DELETE /api/picks/:id` | `'all'` |
| `POST /api/games/:gameId/result` | `'all'` |
| `DELETE /api/admin/games/:id` | `'all'` |
| `POST /api/admin/games/bulk` (any affected) | `'all'` |
| `DELETE /api/admin/users/:id` | `'all'` |
| `POST /api/admin/users/bulk` (delete only) | `'all'` |
| `POST /api/groups/:groupId/invite/:inviteId/accept` | `group:<id>` |
| `POST /api/groups/:groupId/join` | `group:<id>` |
| `POST /api/groups/:groupId/leave` | `group:<id>` |
| `DELETE /api/groups/:groupId` | `group:<id>` |

**Promote / demote** (admin role change) don't invalidate — the cached rows hold username + displayName + points, not role.

**Observability**: `GET /api/admin/cache-stats` (admin-only) returns the live `stats()` snapshot. Useful for verifying invalidation during development.

**Limits**:
- **Single-process only**: the cache is process-local. A multi-instance deploy would see stale reads across replicas. Today the app is single-process so this is fine; a future move to Redis would be a small interface swap (the `lib/leaderboardCache.js` module already encapsulates the storage).
- **No background refresh**: invalidation is purely mutation-driven; expired entries are rebuilt lazily on the next read.
- **`viewerRow` is not cached** — it's per-caller, computed downstream of the cached array.

---

## 9. End-to-End Data Flows

### 9.1 Login → Dashboard Load

```
Browser:                              Server:                            DB:
─────────────────────────────────────────────────────────────────────────────
1. POST /api/login   ─────────────▶  loginLimiter
   { username,password }              validate(loginSchema)
                                      getUserByUsername(name)  ──────▶  SELECT * FROM users WHERE iLike
                                      bcrypt.compare(pw, hash)
                                      createToken(user)
   { token, user } ◀───────────────  jwt.sign(...)

2. setItem('scorecastToken', token)
3. useEffect on token → loadDashboard()

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
2. **Window-level errors / unhandled rejections** → [clientErrorReporter](src/lib/clientErrorReporter.js) → POST `/api/client-errors` + custom DOM event → App.jsx shows a cyan toast.
3. **Handled API errors** (anything `request()` throws) → caller's `.catch()` → `showStatus(error.message)`. The special `'Session expired'` error is not re-toasted (the session-expired handler already toasted).

All three paths converge on the **server-side structured log** via `POST /api/client-errors`. Sentry sees paths 1 + 2 directly (its browser SDK installs its own `window.error` listener at `init`).

**What users see** by failure type:
- Render error → full-page fallback card (Reload / Try again buttons; raw error text only in dev builds).
- Window/async error → 3.5 s cyan toast: *"Something went wrong — refresh if things look off."*
- API error → contextual cyan toast with the server's `error` message (or *"Request failed"* fallback).

### 10.2 Security Posture

| Concern | Status |
| --- | --- |
| Password storage | bcrypt cost 10, enforced via model hooks |
| Auth secret | JWT_SECRET required in prod; insecure dev fallback never reaches prod |
| Token transport | Both Authorization header and `token` cookie supported (cookie is read but never written by the server today — header is the primary path) |
| Brute force | Login + register rate-limited; no rate-limit on other endpoints |
| Input validation | zod on every body; no trust placed in client-side validation |
| SQL injection | Sequelize parameterizes everything; the raw SQL in `runMigrations()` has no user input |
| RBAC | `requireAdmin` middleware; admin endpoints under `/api/admin/*` plus the legacy `POST /api/games/:gameId/result` |
| Self-protection | Admin cannot demote or delete self (server-side, not just UI) |
| XSS | React's default escaping; no `dangerouslySetInnerHTML` anywhere |
| CSRF | Not protected. Cookie+credentials are accepted but the primary auth is the Authorization header, which is not auto-sent cross-origin. CSRF tokens are Tier 5 |
| CORS | `origin: true` is too permissive — flagged for tightening before prod |
| Audit log | None |
| Account lockout | None |
| 2FA | None |
| Password reset | No flow |

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
- **Sentry (Tier 5.4b)**: opt-in via env. When unset, both server and browser ship without Sentry overhead (server-side `lib/sentry.js` exports no-ops; client-side Vite tree-shakes the dynamic `@sentry/react` import). When set, server uses `@sentry/node` with OpenTelemetry instrumentation (initialized in [lib/instrument.js](lib/instrument.js) *before* Express is required); browser uses `@sentry/react` with its own window listeners + the ErrorBoundary's explicit `captureException` calls.
- **Still missing**: no `/metrics` endpoint, no APM beyond Sentry, no log shipping to a managed log aggregator (CloudWatch / Application Insights / Loki). Captured under Tier 10 — Observability & scale in the forward roadmap.

---

## 11. Operational Notes

### 11.1 Environment Variables

See [.env.example](.env.example):
- **`JWT_SECRET`** — must be set in production; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Server refuses to start in `NODE_ENV=production` without it.
- **`DATABASE_URL`** — Postgres connection string. Optional; defaults to `postgres://postgres:postgres@localhost/scorecast_db` (see [config/database.js](config/database.js)).
- **`PORT`** — defaults to 3000.
- **`NODE_ENV`** — `development` or `production`. Gates JWT_SECRET enforcement, logger format (pretty vs JSON), and migration auto-run behavior.
- **`LOG_LEVEL`** — (Tier 5.4) pino level. Defaults to `debug` in dev and `info` in prod. Values: `fatal | error | warn | info | debug | trace | silent`.
- **`MIGRATE_ON_BOOT`** — (Tier 5.1) `'true'` to apply pending migrations on server boot in production. Default off — production should run `npm run db:migrate` as an explicit deploy step. No effect in development (always auto-migrates).
- **`SENTRY_DSN`** — (Tier 5.4b) Sentry server-side DSN. When unset, [lib/instrument.js](lib/instrument.js) skips Sentry init and [lib/sentry.js](lib/sentry.js) exports no-ops. When set, `@sentry/node` initializes at boot (before Express) and `setupExpressErrorHandler(app)` reports any `next(err)`-propagated error.
- **`VITE_SENTRY_DSN`** — (Tier 5.4b) Sentry browser DSN. Read at **Vite build time**, not runtime — any change requires `npm run build`. When unset, Vite dead-code-eliminates the dynamic `@sentry/react` import (verified zero bytes added to the bundle). When set, `initSentry()` in [src/lib/sentry.js](src/lib/sentry.js) loads the SDK and calls `Sentry.init(...)` on app startup.

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
7. **`pickMap` shape**: the frontend `pickMap` in [App.jsx](src/App.jsx) stores **full pick objects** (Tier 8.2), not just the `choice` string. Consumers in [GameCard.jsx](src/components/GameCard.jsx) destructure to `existingChoice` and `existingPickId`. Don't revert to the simpler shape — the undo-pick UX needs the id.
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

### 11.5 Backup / Restore

Standard Postgres tooling (`pg_dump`, `pg_restore`). No app-specific export. Seed data is hand-curated in [data.json](data.json) and only re-runs when the users table is empty.

---

## 12. Known Limitations & Technical Debt

| Area | Issue | Tier |
| --- | --- | --- |
| CORS | `origin: true` — accept-all | 6.1 |
| Tests | No automated tests at all (Playwright deferred from 5.5 because it needs Docker) | 5.5 / 9.4 |
| External data | No football API integration; admin enters games manually | 4b (deferred) |
| Live scores | No live score display; no auto-poll | 4b (deferred) |
| Leagues / seasons | Single global game pool; no `league` / `season` fields | 4b (deferred) |
| Pick types | Only winner picks; no spread / over-under / score prediction | 4b (deferred) |
| Streaks | Deferred — concurrent kickoffs make "consecutive correct" ambiguous (revisits after 4b adds season ordering) | 4b |
| Real-time | No WebSocket; everything is HTTP polling at 30 s. Reaction count changes don't propagate across viewers in real time | 7 |
| Audit log | No record of admin actions (single or bulk) | 4b.6 |
| Password reset | No flow; no account lockout; no 2FA | 6 |
| CSRF | Not protected | 6 |
| Helmet / security headers | Not applied | 6.5 |
| Profile privacy | Every authenticated user can view every profile | 8.6 |
| Notification spam | Bulk-setResult can produce many notifications in one request; no batching/dedup | 7 |
| Cache scope | `leaderboardCache` is process-local; a multi-instance deploy would see stale reads across replicas. Today the app runs single-process so this is fine | future / Tier 10.4 (Redis backend) |
| Server-side log shipping | pino → stdout only; no managed log aggregator (CloudWatch / Application Insights / Loki). Sentry covers errors but not access logs | Tier 10.6 |
| Health / readiness probes | No `/healthz` or `/readyz` endpoint; load balancers / Container Apps probes have nothing to hit | Tier 10.1 |
| Metrics | No `prom-client` / `/metrics` endpoint; no request-duration histogram, no cache hit/miss counters | Tier 10.3 |

---

## 13. Roadmap

The live forward roadmap is in `C:\Users\vinde\.claude\plans\can-you-confirm-that-reflective-kay.md` (Tiers 4b → 9). The original tier plan lives at `C:\Users\vinde\.claude\plans\go-through-this-codebase-warm-cloud.md` for historical context.

Summary:

- ✅ **Tier 1** — Foundational hardening (bcrypt, RBAC, rate-limit, zod, JWT secret, unique pick index).
- ✅ **Tier 2** — UX completions (outcome display, full leaderboards, my-picks, sections, countdown, skeletons, confirm, mobile, a11y).
- ✅ **Tier 3** — Social/engagement (profiles, badges, friends, public groups, comments, notifications).
- ✅ **Tier 4a** — Admin UI for game CRUD + user moderation.
- 🟡 **Tier 4b** — Game-data quality remainder: external API integration, live scores, leagues/seasons, additional pick types, streaks, audit log. **All deferred** (requires API-Football key + schema additions).
- ✅ **Tier 5 (core)** — Ops & reliability: migrations framework (5.1), leaderboard caching (5.2), transactional cascades (5.3), structured logging (5.4), N+1 elimination (5.7), HTTP compression (5.6).
- ✅ **Tier 5.4b** — Frontend error reporting: React `ErrorBoundary`, `POST /api/client-errors`, window listeners + reporter, `X-Request-Id` capture, Sentry SDK opt-in. See §6.7.
- 🟡 **Tier 5 (remainder)** — 5.5 Playwright E2E (deferred — needs Docker / Tier 9.4).
- ❌ **Tier 6** — Security hardening for production: CORS, CSRF, password reset, account lockout, helmet, refresh tokens, 2FA.
- ❌ **Tier 7** — Real-time & engagement: scheduler-driven notifications, WebSocket/SSE, web push, email, prefs.
- ✅ **Tier 8** (minus 8.6) — User capabilities: group lifecycle (leave/transfer/delete), pick deletion, avatars, search, profile bio + displayName, comment edit + reactions, leaderboard sort + pagination, bulk admin actions.
- ❌ **Tier 8.6** — Profile privacy (parked; small isolated change).
- ❌ **Tier 9** — DX: TypeScript, OpenAPI, CI, Docker, code-splitting, Storybook.

---

## 14. Glossary

| Term | Meaning |
| --- | --- |
| **Pick** | A user's prediction `'home' \| 'away'` for a single game. Unique per `(userId, gameId)`. |
| **Result** | The actual outcome of a game, set by an admin: `'home' \| 'away' \| null`. `null` means the game hasn't been resolved (or was unresolved). |
| **Probability** | Implied win-chance for one team in `[0,1]`. Home + away must sum to 1.0 ±0.01. Drives the scoring formula. |
| **Upset bonus** | Mechanic where picking the underdog (lower probability) pays more. Mathematically baked into `round((1 − probability) × 100)`. |
| **Group** | A user-created pool of members with its own scoped leaderboard. May be `private` (invite-only) or `public` (joinable). |
| **Invite** | A pending request, stored by username, that grants a user the right to accept membership in a group. |
| **Friendship** | An unordered pair of users in `pending` or `accepted` state. One row per pair, enforced by a functional unique index. |
| **Badge** | A milestone achievement awarded server-side. Defined in [badges/catalog.js](badges/catalog.js); awarded by `evaluateBadges()`. |
| **Notification** | An in-app feed item created by the `notify()` helper. Polled every 30 s by `NotificationBell`. |
| **Drawer** | The right-side overlay panel that shows another user's `ProfileView`. Opened by clicking any leaderboard row. |
| **Tab** | The pseudo-routing primitive in `App.jsx`. Tabs are strings (`'games' | 'mypicks' | ...`) stored in the `view` state. |
| **Sync** | (Tier 4, deferred) The act of pulling fixtures + results from an external football API. |
| **Tier** | Roadmap grouping. Tiers 1–3, 4a, 5 (core), and 8 (minus 8.6) are shipped; Tiers 4b, 6, 7, 8.6, 9 remain. |
| **Migration** | A versioned file under `migrations/` (Tier 5.1) that evolves the schema. Applied by sequelize-cli (`npm run db:migrate`) or by umzug on dev boot. Statements should be idempotent so they're safe against DBs that pre-existed the framework. |
| **Cascade transaction** | (Tier 5.3) A `sequelize.transaction()` block wrapping a `cascadeDeleteUser/Game/Group()` call, so a mid-cascade failure rolls back every prior `destroy()` rather than leaving orphans. |
| **Leaderboard cache key** | `'overall'` for the global block; `group:<groupId>` per group. Invalidated on every mutation that affects standings. See §8.14. |
| **Request ID** | A UUID v4 assigned by [middleware/requestId.js](middleware/requestId.js) on every request, attached to `req.id`, echoed in the response's `X-Request-Id` header, and included in every log line produced by `req.log`. Honored inbound `X-Request-Id` headers (≤200 chars) are reused instead of generating a new one — useful for client-side correlation. |
| **ErrorBoundary** | (Tier 5.4b) React class component in [src/components/ErrorBoundary.jsx](src/components/ErrorBoundary.jsx) that wraps `<App />` in `main.jsx`. Catches *render-phase* errors below it via `componentDidCatch`, swaps in a slate/rose fallback card, and reports through `reportClientError` + Sentry `captureException`. Does **not** catch errors thrown from event handlers, async code, or `setTimeout` callbacks — those go through the window-level listeners in [src/lib/clientErrorReporter.js](src/lib/clientErrorReporter.js). |
| **clientErrorReporter** | (Tier 5.4b) Module in [src/lib/clientErrorReporter.js](src/lib/clientErrorReporter.js) that installs `window.error` and `unhandledrejection` listeners, throttles reports to 5 per 60 s, posts to `POST /api/client-errors`, and dispatches a `scorecast:client-error` DOM event for App.jsx to toast. Exports `reportClientError({...})` for explicit calls and `setLastRequestId(id)` to record the most recent server reqId observed via response headers. |
| **`/api/client-errors`** | (Tier 5.4b) Public endpoint accepting `{message, stack?, componentStack?, url?, reqId?, userAgent?, level?}` (zod-validated, all string fields capped — stack at 8 KB). Soft-decodes the JWT to attach `userId` if present, else logs anonymously. Rate-limited 30/5 min per IP. Always returns 204. |
| **`SENTRY_DSN` / `VITE_SENTRY_DSN`** | (Tier 5.4b) Opt-in env vars enabling server-side and browser-side Sentry capture respectively. Both are no-ops when unset (server exports stubs; Vite tree-shakes the dynamic `@sentry/react` import). `VITE_SENTRY_DSN` is read at Vite build time — change requires `npm run build`. |
