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

1. An admin creates fixtures with home/away probabilities (the implied odds).
2. Users sign up, pick the winner of upcoming games, and lock in their pick before kickoff.
3. After a game's result is set, correct picks earn `round((1 − probability) × 100)` points — picking the underdog pays more.
4. Users compete on an overall leaderboard and inside private/public groups, send friend requests, comment on games, and collect badges for milestones.

The codebase is mid-sized (~3k lines of JavaScript split roughly evenly between server and client). It is monorepo-style: one Express server serves both the JSON API at `/api/*` and the static React bundle for everything else.

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
│  │ cors → bodyParser → cookieParser → express.static(dist/)      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ rate-limit   │  │ authMiddleware│ │ validate(zodSchema)       │  │
│  │ (login/regr.)│  │ requireAdmin │ │                            │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                       │
│  Route handlers ─── Sequelize models ─── helper fns                  │
│                                          (scorePick, notify,         │
│                                           evaluateBadges, …)          │
└─────────────────────────┬────────────────────────────────────────────┘
                          │ Sequelize (TCP)
                          ▼
            ┌─────────────────────────────────┐
            │       PostgreSQL                │
            │  users, games, picks, groups,   │
            │  group_members, group_invites,  │
            │  badges, friendships, comments, │
            │  notifications                  │
            └─────────────────────────────────┘
```

There is **one server process**, **one database**, **no message queue**, **no cache**, **no worker**, **no CDN**. Notifications and badges are fired synchronously inside the same request that triggers them (in a `.catch(() => {})` to keep the user-facing response from failing if a side-effect errors).

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
| ORM | **Sequelize 6** | Predictable, supports raw SQL escape hatches; migrations are intentionally hand-rolled (see §7.3) |
| DB | **PostgreSQL** | Need ENUMs, partial unique indexes, and `LEAST/GREATEST` functional indexes — all Postgres-specific |
| Auth | **JWT (HS256) via `jsonwebtoken`** | Stateless, 7-day expiry, no session table |
| Password hashing | **bcryptjs** (cost 10) | Pure-JS, no native build step needed on Windows |
| Validation | **zod** | Schema-first request validation; emits structured error JSON |
| Rate limiting | **express-rate-limit** | In-memory, per-IP; only applied to `/api/login` and `/api/register` |

Notable **non-choices**: no TypeScript, no testing framework wired up, no Docker, no CI/CD config, no logger library (raw `console.log`/`console.warn`). These are deliberate scope decisions documented in [CLAUDE.md](CLAUDE.md).

---

## 4. Repository Layout

```
ScoreCast/
├── server.js                            # Single-file Express app (~850 LOC)
├── package.json                         # All deps; npm scripts: dev, build, start, preview
├── db-config.js                         # Stub used by sequelize-cli (not by the app)
├── data.json                            # Seed: users, games, groups, picks
├── .env.example                         # Required env vars (JWT_SECRET, DATABASE_URL, …)
├── vite.config.js                       # /api proxy → localhost:3000 in dev
├── tailwind.config.js
├── postcss.config.js
│
├── models/                              # Sequelize models — one file per table
│   ├── index.js                         # Sequelize init + associations + initDatabase + runMigrations + seedDatabase
│   ├── User.js                          # bcrypt beforeCreate/beforeUpdate hooks live here
│   ├── Game.js
│   ├── Group.js                         # visibility ENUM('private'|'public')
│   ├── GroupMember.js                   # composite PK (groupId, userId)
│   ├── GroupInvite.js
│   ├── Pick.js                          # unique (userId, gameId)
│   ├── Badge.js                         # unique (userId, slug)
│   ├── Friendship.js                    # pending|accepted; unique pair via functional index in runMigrations
│   ├── Comment.js                       # indexed by gameId
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
│   ├── main.jsx                         # React.createRoot bootstrap
│   ├── App.jsx                          # ~900 LOC; state, tabs, request(), all handlers
│   ├── index.css                        # @tailwind base/components/utilities
│   ├── utils/
│   │   ├── scoring.js                   # MIRROR of server's scorePick; see §8.1
│   │   └── time.js                      # formatCountdown, useCountdown hook, timeAgo
│   └── components/
│       ├── GameCard.jsx                 # Pick UI, outcome badge, countdown chip, CommentThread footer
│       ├── GroupCard.jsx                # Member grid, invite form, Public/Private badge
│       ├── GroupLeaderboardCard.jsx
│       ├── LeaderboardCard.jsx          # Exports LeaderboardRow (used inline by App.jsx for sidebar)
│       ├── InviteRow.jsx
│       ├── LoginForm.jsx
│       ├── RegisterForm.jsx
│       ├── PicksHistory.jsx
│       ├── EmptyState.jsx
│       ├── Skeleton.jsx                 # SkeletonGameCard + SkeletonLeaderboardRow
│       ├── ConfirmModal.jsx             # Backdrop + Esc-close, used by logout + admin deletes
│       ├── ProfileView.jsx              # Stats grid + BadgeWall + recent picks + friend button
│       ├── ProfileDrawer.jsx            # Right-side drawer wrapping ProfileView
│       ├── BadgeWall.jsx
│       ├── FriendsList.jsx
│       ├── CommentThread.jsx
│       ├── NotificationBell.jsx         # 30s polling, dropdown
│       └── admin/
│           ├── AdminPanel.jsx
│           ├── GameManager.jsx
│           └── UserManager.jsx
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
1. cors({ origin: true, credentials: true })            // permissive in dev; tighten for prod
2. bodyParser.json()                                     // parses application/json
3. cookieParser()                                        // populates req.cookies
4. express.static(dist/)                                 // serves built assets if path matches
5. (per-route) rate-limit | authMiddleware | requireAdmin | validate(schema)
6. Route handler                                         // typically async; uses Sequelize models
7. Response: res.json({...}) or res.status(N).json({error: '...'})
```

If the URL doesn't match any `/api/*` route, the catch-all `app.get('*')` returns `dist/index.html`. **The API routes must be registered before** the catch-all (they are).

### 5.3 Middleware

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

Schemas live in [validation/schemas.js](validation/schemas.js): `registerSchema`, `loginSchema`, `createGroupSchema` (with optional `visibility`), `inviteSchema`, `pickSchema`, `resultSchema`, `friendRequestSchema`, `visibilitySchema`, `commentSchema`, `createGameSchema`, `updateGameSchema`, `roleSchema`.

#### Rate limiting
Two limiters from `express-rate-limit`, both configured `standardHeaders: true, legacyHeaders: false`:
- `loginLimiter`: 5 requests / 15 min per IP. Applied to `POST /api/login`.
- `registerLimiter`: 3 requests / hour per IP. Applied to `POST /api/register`.

In-memory store, so a server restart wipes the counters. Acceptable for a single-instance deployment; would need Redis-backed limits for horizontal scaling.

#### CORS
`cors({ origin: true, credentials: true })`. `origin: true` reflects the request's `Origin` header — i.e. allows any origin, which is too permissive for production. Documented in [CLAUDE.md](CLAUDE.md) and tracked as a known issue.

### 5.4 Route Catalogue

Routes are registered in [server.js](server.js) in roughly this order:
1. Auth: `POST /api/register`, `POST /api/login`
2. Identity: `GET /api/me`
3. Games: `GET /api/games`
4. Groups (in order): `GET /api/groups`, **`GET /api/groups/discover`** (must come before `/:groupId`), `GET /api/groups/:groupId`, `POST /api/groups`, invite endpoints, `POST /api/groups/:groupId/join`, `POST /api/groups/:groupId/visibility`
5. Picks: `POST /api/picks`, `GET /api/picks`
6. Leaderboard: `GET /api/leaderboard`
7. Game admin: `POST /api/games/:gameId/result`
8. Profiles: `GET /api/users/:username/profile`
9. Friends: `POST /api/friends/request`, `/accept`, `/decline`, `DELETE`, `GET /api/friends`
10. Comments: `GET/POST /api/games/:gameId/comments`, `DELETE /api/comments/:id`
11. Notifications: `GET /api/notifications`, `POST /:id/read`, `POST /read-all`
12. Admin: `POST/PUT/DELETE /api/admin/games`, `GET/POST/DELETE /api/admin/users/...`
13. Catch-all: `app.get('*')` → `dist/index.html`

**⚠ Route ordering matters for path-param shadowing.** `/api/groups/discover` is registered before `/api/groups/:groupId` so Express doesn't match `discover` as the `:groupId` parameter. Any future sibling route under `/api/groups/*` must follow the same convention.

### 5.5 Side-Effect Helpers (`server.js` internals)

These are pure-Node helpers, not endpoints. They live inside `server.js` and are called from multiple route handlers:

| Helper | Purpose | Called from |
| --- | --- | --- |
| `scorePick(pick, game)` | Authoritative scoring formula | `buildUserSummary`, `buildGroupLeaderboard`, `applyGameResult` (notification text), profile endpoint |
| `notify(userId, type, title, body?, link?)` | Creates a `Notification` row; swallows errors | Invite, accept, friend-request, friend-accept, public-group join, badge award, game result |
| `awardBadge(userId, slug)` | Inserts a `Badge` row (unique-constrained); fires a `badge` notification | `evaluateBadges` only |
| `evaluateBadges(userId, ctx?)` | Re-runs all badge unlock conditions for a user; idempotent | `POST /api/picks`, `POST /api/groups`, per-user inside the result hook |
| `getFriendshipBetween(a, b)` | Finds the single row (in either direction) | Profile endpoint, friend-request guards |
| `friendStatusFrom(friendship, viewer, target)` | Returns `'self' \| 'none' \| 'pending-in' \| 'pending-out' \| 'friends'` | Profile endpoint |
| `buildUserSummary()` | Overall leaderboard rows | `GET /api/leaderboard` |
| `buildGroupLeaderboard(groupId)` | Group-scoped leaderboard rows | `GET /api/leaderboard?groupId=` |

`notify` and `evaluateBadges` are **fire-and-forget with `.catch(() => {})`** — a failure inside them never breaks the user-facing response. The trade-off is silent failures; future maintainers may want to swap in a real logger.

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
friends, discoverGroups, ownProfile
```

Derived state uses `useMemo` (`pickMap`, `upcomingGames/liveGames/completedGames`, `tabs`).

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

### 6.4 Tab Routing

Routing is **fake**: the URL never changes. The `view` state determines which top-level block renders. Five base tabs (Games, My Picks, Groups, Leaderboards, Profile) plus a conditional Admin tab when `user.role === 'admin'`. Browser back/forward and deep-linking are unsupported.

### 6.5 Polling Patterns

Two timers run inside the app:
- **`NotificationBell`**: `setInterval` calling `GET /api/notifications` every 30 s. Started on mount, cleared on unmount.
- **`useCountdown(date)`** in `time.js`: per-`GameCard` interval that re-formats the countdown label every 30 s. Cheap; the hook returns a string label.

There is **no global polling for game state** today (deferred Tier 4 feature). Leaderboards are computed on each `GET /api/leaderboard` call and refetched on user actions, not on a timer.

### 6.6 Component Hierarchy

```
<App>
├── (auth panel) <LoginForm> / <RegisterForm>
└── (dashboard)
    ├── header card
    ├── tabs row
    │   ├── <NotificationBell>
    │   └── logout button → <ConfirmModal>
    │
    ├── view === 'games':
    │     <GameCard>* (with inline <CommentThread>)
    │     sidebar: <LeaderboardRow>* (clickable → opens drawer)
    │
    ├── view === 'mypicks': <PicksHistory>
    │
    ├── view === 'groups':
    │     create form (with visibility radio)
    │     Discover list
    │     <FriendsList>
    │     pending invites
    │     <GroupCard>*
    │
    ├── view === 'leaderboard':
    │     <LeaderboardCard>  <GroupLeaderboardCard>
    │
    ├── view === 'profile' (self): <ProfileView>
    │
    └── view === 'admin' (admin only): <AdminPanel>
                                         ├── <GameManager>
                                         └── <UserManager>

Overlays (rendered above the dashboard):
├── <ConfirmModal>           (logout, deletions)
└── <ProfileDrawer>           (any leaderboard row click)
        └── <ProfileView>
              └── <BadgeWall>
```

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
2. **`sequelize.sync({ alter: false })`** — creates tables that don't exist yet. Does **not** modify existing tables. `alter: false` is deliberate: we don't trust Sequelize's auto-alter logic.
3. **`runMigrations()`** — our hand-rolled idempotent migration block (see §7.3).
4. **`seedDatabase()`** — only runs if the `users` table is empty; populates from [data.json](data.json).

### 7.3 The `runMigrations()` Contract

This is the project's poor-man's migration framework. Every schema evolution that `sync({alter:false})` can't handle goes here as **raw SQL guarded by `IF NOT EXISTS`** (or equivalent):

```sql
-- Tier 1: role column on users (ENUM auto-created by sync the first time the User model loads)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role enum_users_role NOT NULL DEFAULT 'user';

-- Tier 1: unique pick per (user, game)
CREATE UNIQUE INDEX IF NOT EXISTS picks_user_game_unique ON picks ("userId", "gameId");

-- Tier 3: groups.visibility — enum + column, both idempotent
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_groups_visibility') THEN
    CREATE TYPE "public"."enum_groups_visibility" AS ENUM ('private', 'public');
  END IF;
END $$;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS visibility enum_groups_visibility NOT NULL DEFAULT 'private';

-- Tier 3: friendship pair uniqueness (unordered)
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_unique
  ON friendships (LEAST("requesterId","addresseeId"), GREATEST("requesterId","addresseeId"));

-- Tier 1: data fix — re-hash any seed user whose password is still plaintext (matched against data.json)
```

**Rules for adding migrations**:
- Every statement must be safely re-runnable. `IF NOT EXISTS`, `IF NOT EXISTS` indexes, and `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;` blocks for CREATE TYPE.
- Order matters: any later migration that depends on an earlier change should be appended below it.
- Data backfills go at the bottom and should also be idempotent (`UPDATE ... WHERE col IS NULL`).
- Add a comment naming the Tier that introduced the change.

This is a Tier 5 candidate to replace with `sequelize-cli` proper, but works fine for the current scale.

### 7.4 Tables

UUIDs are the universal primary-key type. All `id` columns are `UUID` with `defaultValue: DataTypes.UUIDV4`.

#### `users`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `username` | STRING UNIQUE NOT NULL | Case-insensitive lookup via `iLike` |
| `password` | STRING NOT NULL | bcrypt hash; the model's `beforeCreate`/`beforeUpdate` hooks auto-hash anything not already matching `^\$2[aby]\$` |
| `role` | ENUM('user','admin') NOT NULL DEFAULT 'user' | Added via migration |
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

**Index**: `comments_game_idx (gameId)` for fast thread fetch.

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
| `games` → `picks` | App-level cleanup in `DELETE /api/admin/games/:id` (also deletes comments) |
| `games` → `comments` | `ON DELETE CASCADE` at DB level **and** app-level (belt-and-braces) |
| `users` → `badges`, `notifications` | `ON DELETE CASCADE` at DB level |
| `users` → `picks`, `comments`, `friendships`, `group_members`, owned `groups`, `group_invites` (by username) | **App-level cleanup only** in `DELETE /api/admin/users/:id`. The user-delete handler is the most complex deletion path in the system; see §8.9 |

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

**Lock rules** (enforced in `POST /api/picks`):
- `game.date <= now` → 400 `Picks can only be created or changed for upcoming games`
- `game.result !== null` → same error

Picks **cannot be deleted** by users today (no endpoint). Admin user-delete cascades them.

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

Authorization:
- Post: any authenticated user.
- Delete: author **or** any admin. The frontend hides the delete button unless `comment.userId === currentUserId`, but the server is the actual gate.

No edit endpoint by design — author can delete + repost.

### 8.8 Profile Subsystem

`GET /api/users/:username/profile` is one of the heavier endpoints. It composes:
- The target user's basic fields (id, username, role, joinedAt).
- All of the target's picks, joined with games to compute `totalPoints, picksMade, picksWon, picksScored, winRate`.
- A 10-row `recentPicks` array sorted by game date descending.
- The user's badge rows.
- The full badge catalog (so the BadgeWall has names + emojis for unearned badges too).
- `friendship` row + `friendStatus` between viewer and target.
- If `friendStatus === 'friends'`, the `headToHead` tally.

This endpoint is **not cached**. On a large dataset it would be a target for Tier 5 caching.

Frontend rendering: two callers.
- **Drawer**: any leaderboard row click (overall, group, sidebar) opens `<ProfileDrawer>` with the target's username. The drawer mounts `<ProfileView>` and shows a friend-action button driven by `friendStatus`.
- **Tab**: clicking the **Profile** tab opens a full-width `<ProfileView>` for the current user (no drawer wrapper). The `ownProfile` state is refetched whenever picks or games change (so newly-scored points appear immediately).

### 8.9 Admin Subsystem

Six endpoints all gated by `authMiddleware + requireAdmin`. The Admin tab in the UI is conditionally added to the tabs array only when `user.role === 'admin'`.

**Game CRUD**:
- `POST /api/admin/games` — body validated by `createGameSchema` including a `.refine()` that ensures `homeProbability + awayProbability` sums to 1.0 ±0.01.
- `PUT /api/admin/games/:id` — `updateGameSchema` allows all fields optional; if **both** probabilities are sent they must sum to 1.0.
- `DELETE /api/admin/games/:id` — cascades picks and comments before destroying the game. Doesn't preserve point totals; affected leaderboards will reflect the deletion on the next computation.

**Result-setting** is **not** under `/api/admin/*` — it's the original `POST /api/games/:gameId/result` from Tier 1 and remains there for backward compatibility. The Admin UI calls it for the "Home won / Away won / Clear" buttons.

**User moderation**:
- `GET /api/admin/users` — returns every user enriched with `picksCount` and `groupsCount` (in-memory aggregation over a single Pick + GroupMember fetch).
- `POST /api/admin/users/:id/role` — body `{role}`. **Self-demote guard**: if `params.id === req.user.id && body.role !== 'admin'` → 400 `You cannot demote yourself`. Saves the user with `{hooks: false}` so the password isn't re-hashed.
- `DELETE /api/admin/users/:id` — **self-delete guard** (400 same as above). Then performs cascading cleanup in a specific order (because some FKs are `ON DELETE NO ACTION`):
  1. Find groups owned by the target.
  2. Delete group_members + group_invites for those groups.
  3. Delete those groups.
  4. Delete the target's picks.
  5. Delete the target's comments.
  6. Delete friendships where the target is either party.
  7. Delete the target's group_members rows (in groups they didn't own).
  8. Delete the target's group_invites (by username string match).
  9. Destroy the user row (cascades badges + notifications via DB-level CASCADE).

The full sequence runs **outside** a transaction in v1. A partial failure would leave dangling rows; Tier 5 should wrap this in `sequelize.transaction()`.

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

- **Server**: every route handler is wrapped in `try { ... } catch (error) { res.status(500).json({error: '...'}) }`. The catch blocks log to `console.error` and return a generic message; no stack trace leaks to the client.
- **zod validation errors** are 400 with the `issues` array (path + message).
- **Specific business errors** (e.g. duplicate friend request) are 400 with a human-readable string.
- **Frontend**: every `request()` call site catches and routes through `showStatus(error.message)` (which displays a transient toast). The `'Session expired'` error is special-cased and not re-shown (the toast was already triggered by `handleSessionExpired`).

There is **no centralized error handler middleware** on the server and **no global error boundary** on the client. Tier 5.

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

- **Leaderboard**: `GET /api/leaderboard` does an unbounded `SELECT * FROM users + picks + games`, then computes scores in JS. O(users × picks) per call. Fine at hundreds of users; becomes a problem in the thousands. Tier 5 caching candidate.
- **Profile endpoint**: similar shape but bounded to a single user.
- **N+1 risk in `getGroupsForUser`**: loops over groups fetching members + invites per group. Could be replaced with a single JOIN-style query; deferred.
- **No connection pooling tuning**: Sequelize default of max 5 is fine for a single Node process.
- **No HTTP compression** is configured — Express serves uncompressed JSON. Add `compression` middleware before going to prod over the open internet.
- **Bundle size**: the production JS bundle is ~460 KB (gzipped ~118 KB). All from React + Tailwind + business code; no obvious wins without code-splitting.

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

### 10.5 Observability

There is **none**. No structured logging, no metrics endpoint, no Sentry, no APM. Server-side `console.log` and `console.error` go to stdout/stderr. Frontend has no telemetry. Tier 5 candidate.

---

## 11. Operational Notes

### 11.1 Environment Variables

See [.env.example](.env.example):
- **`JWT_SECRET`** — must be set in production; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Server refuses to start in `NODE_ENV=production` without it.
- **`DATABASE_URL`** — Postgres connection string. Optional; defaults to `postgres://postgres:postgres@localhost/scorecast_db`.
- **`PORT`** — defaults to 3000.
- **`NODE_ENV`** — `development` or `production`.

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
npm run build      # vite build → dist/
node server.js     # serves dist/ + /api on the same port
```

Or in one go: `npm start` (= `vite build && node server.js`).

### 11.4 Common Gotchas

1. **Route shadowing**: `/api/groups/discover` must stay registered before `/api/groups/:groupId`. Same for any future `/api/groups/<literal>` routes.
2. **Scoring duplication**: edits to `scorePick` in [server.js](server.js) must be mirrored in [src/utils/scoring.js](src/utils/scoring.js) (and vice versa) in the same commit.
3. **Migration idempotency**: every statement in `runMigrations()` must be safely re-runnable. Tests: `runMigrations()` should work both on a brand-new DB and on a DB that already has the change applied.
4. **Notification side-effects on result-set**: when modifying `POST /api/games/:gameId/result` or any endpoint that resolves picks, you must keep the `notify` + `evaluateBadges` loop intact, otherwise users stop getting feedback.
5. **Self-protection guards**: the admin self-demote/self-delete checks compare on `req.user.id` (UUID string from the JWT). If you ever change how `req.user` is shaped, audit these checks.
6. **`saveUser({hooks: false})`** is intentional in `runMigrations()` and the role-update endpoint — without it, Sequelize's `beforeUpdate` hook would attempt to re-hash an already-hashed password.

### 11.5 Backup / Restore

Standard Postgres tooling (`pg_dump`, `pg_restore`). No app-specific export. Seed data is hand-curated in [data.json](data.json) and only re-runs when the users table is empty.

---

## 12. Known Limitations & Technical Debt

| Area | Issue | Tier |
| --- | --- | --- |
| CORS | `origin: true` — accept-all | 5 |
| Migrations | Hand-rolled SQL in `runMigrations()`; no down-migrations | 5 |
| Leaderboard | Real-time computation; no caching | 5 |
| Logging | `console.*` only; no structured logger | 5 |
| Tests | No automated tests at all | 5 |
| Transactions | Multi-step deletes (user) run outside a transaction | 5 |
| External data | No football API integration; admin enters games manually | 4 (deferred) |
| Live scores | No live score display; no auto-poll | 4 (deferred) |
| Leagues / seasons | Single global game pool; no `league` / `season` fields | 4 (deferred) |
| Pick types | Only winner picks; no spread / over-under / score prediction | 4 (deferred) |
| Streaks | Deferred — concurrent kickoffs make "consecutive correct" ambiguous | 3 (deferred) |
| Real-time | No WebSocket; everything is HTTP polling at 30 s | — |
| Audit log | No record of admin actions | 5 |
| Password reset | No flow | — |

---

## 13. Roadmap

The roadmap of record is in `C:\Users\vinde\.claude\plans\go-through-this-codebase-warm-cloud.md`. Summary:

- ✅ **Tier 1** — Foundational hardening (bcrypt, RBAC, rate-limit, zod, JWT secret, unique pick index).
- ✅ **Tier 2** — UX completions (outcome display, full leaderboards, my-picks, sections, countdown, skeletons, confirm, mobile, a11y).
- ✅ **Tier 3** — Social/engagement (profiles, badges, friends, public groups, comments, notifications).
- 🟡 **Tier 4** — Game-data quality. **Partially shipped**: Admin UI for game CRUD + user moderation. **Deferred**: external API integration, live scores, leagues/seasons, additional pick types.
- ❌ **Tier 5** — Ops polish: migrations framework, leaderboard caching, logging, E2E tests.

The Tier 4 admin-UI batch was scoped down on purpose; the remaining Tier 4 items are tracked separately and require external dependencies (API-Football key, new schema fields) that the team chose to defer.

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
| **Tier** | Roadmap grouping. Tiers 1–3 are shipped; Tier 4 partial; Tier 5 future. |
| **Migration** | A statement inside `runMigrations()` that evolves the schema beyond what `sync({alter:false})` can do. Must be idempotent. |
