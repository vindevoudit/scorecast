# ScoreCast

Full-stack football prediction web app. React 18 + Vite frontend, Node/Express backend, PostgreSQL via Sequelize. Users make picks on games, join groups, send friend requests, comment + react on games, earn badges, and compete on probability-weighted leaderboards. Admins manage games and users from an in-app panel.

## Where to find more

| Doc | Use for |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full architecture — repo layout (§4), backend internals (§5), database schema (§7), domain subsystems (§8), data flows (§9), operational notes (§11), known limits (§12). Read before any non-trivial change. |
| [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) | How to add a database migration. |
| [MIGRATIONS_PRIMER.md](MIGRATIONS_PRIMER.md) | Plain-language explainer of the migrations framework. |
| [DATABASE_SETUP.md](DATABASE_SETUP.md) | Local Postgres install + setup. |
| [README.md](README.md) | Feature overview, demo users, npm scripts. |
| Forward roadmap | `C:\Users\vinde\.claude\plans\can-you-confirm-that-reflective-kay.md` — Tiers 4b, 6, 7, 8.6, 9 (Tier 5 core shipped). |

## Tech stack at a glance

- **Frontend**: React 18 + Vite + Tailwind CSS
- **Backend**: Node 18+ / Express 4
- **DB**: PostgreSQL via Sequelize 6; migrations via sequelize-cli + umzug
- **Auth**: JWT (7-day) + bcryptjs
- **Validation**: zod on every POST/PUT body
- **Rate limiting**: express-rate-limit (login + register only)
- **Logging**: pino + pino-http with request-id correlation
- **HTTP**: gzip via `compression` middleware
- **Leaderboard cache**: in-memory `Map` with 30s TTL
- **State**: React hooks — `App.jsx` is the single state owner (no Redux/Context)

## Key entry points

- [server.js](server.js) — ~1550-line Express app (auth, all routes, helpers)
- [src/App.jsx](src/App.jsx) — ~1100-line React root (state + handlers)
- [models/index.js](models/index.js) — Sequelize init + umzug shim + seeder
- [validation/schemas.js](validation/schemas.js) — zod schemas for every POST/PUT
- [badges/catalog.js](badges/catalog.js) — badge slug source of truth
- [lib/](lib/) — `logger.js`, `leaderboardCache.js`
- [middleware/](middleware/) — `requestId.js`
- [migrations/](migrations/), [seeders/](seeders/) — versioned schema + data changes

Full repo layout: [ARCHITECTURE.md §4](ARCHITECTURE.md).

## Running

```bash
node server.js       # backend on :3000 (auto-migrates in dev)
npm run dev          # Vite frontend on :5173 (proxies /api → :3000)
npm run build        # produce dist/
npm start            # build + node server.js
npm run db:migrate   # apply pending migrations (required step in prod deploys)
```

## Configuration

See [.env.example](.env.example). Required in production: `JWT_SECRET` (server throws on boot without it). Optional: `DATABASE_URL`, `PORT`, `NODE_ENV`, `LOG_LEVEL`, `MIGRATE_ON_BOOT`.

---

## Critical considerations (don't break these)

Every item below is a load-bearing invariant or gotcha that **isn't obvious from reading the code**. These are the things future-you will get burned by.

- **Scoring formula is duplicated**: [server.js](server.js) (`scorePick`, authoritative — used for leaderboard) and [src/utils/scoring.js](src/utils/scoring.js) (client-side preview). Must stay in sync in the same commit.
- **Badge + notification side effects**: any code path that sets a result, creates a pick, creates a group, or accepts an invite must call `evaluateBadges()` and `notify()` from [server.js](server.js). Existing wires: `POST /api/picks`, `POST /api/games/:gameId/result`, `POST /api/groups`, invite-accept, friend-request/accept, public-group-join.
- **Route ordering**: `/api/groups/discover` is registered *before* `/api/groups/:groupId` so Express doesn't treat `discover` as a path param. Same convention for any new `/api/groups/<literal>` route.
- **Reaction emoji palette is fixed**: 👍 ❤️ 😂 😮 🔥 — defined as `ALLOWED_EMOJIS` in [validation/schemas.js](validation/schemas.js) and `REACTION_EMOJIS` in [src/components/CommentThread.jsx](src/components/CommentThread.jsx). Adding an emoji requires editing both.
- **`pickMap` shape**: in [App.jsx](src/App.jsx) it stores full pick objects keyed by `gameId` (not just `choice`), so GameCard can pass `existingPickId` to the undo handler. Audit [GameCard.jsx](src/components/GameCard.jsx) (`existingChoice` / `existingPickId`) if you change the shape.
- **Avatars are deterministic**: [Avatar.jsx](src/components/Avatar.jsx) hashes the *lowercased username* via FNV-1a → HSL. `displayName` never affects color — so renaming doesn't shuffle existing users' avatars.
- **Bulk admin self-skip**: the bulk-user endpoints filter the caller's own id and return it in `skipped: [{id, reason: 'self'}]` rather than erroring the whole batch.
- **`save({hooks: false})`** is intentional in the role-update endpoint, `PUT /api/me`, the bcrypt backfill seeder, and bulk role flips — without it, the `beforeUpdate` hook would re-hash an already-hashed password.
- **Migrations framework (Tier 5.1)**: **never** add raw DDL to `runMigrations()` — it's a thin umzug shim. Add a new file under [migrations/](migrations/) via `npx sequelize-cli migration:generate --name foo` and use `IF NOT EXISTS` guards. `migrations/` and `seeders/` are versioned source code — always commit them. See [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md).
- **Leaderboard cache (Tier 5.2)**: `GET /api/leaderboard` reads through [lib/leaderboardCache.js](lib/leaderboardCache.js) with 30s TTL. **Any new mutation that affects standings must call `leaderboardCache.invalidate('all')` or `invalidate('group:<id>')` before responding** — see existing call sites in `POST /api/picks`, `DELETE /api/picks/:id`, `POST /api/games/:gameId/result`, the four group-membership endpoints, both single-item admin deletes, and both `/api/admin/*/bulk` endpoints. Forgetting this means stale standings for up to 30 s.
- **Cascade transactions (Tier 5.3)**: `cascadeDeleteUser`, `cascadeDeleteGame`, and `cascadeDeleteGroup` accept a `{transaction}` option and forward it to every internal `destroy()`. Callers wrap with `await sequelize.transaction(async (t) => { await cascadeFn(x, {transaction: t}); })`. Bulk endpoints run **one transaction per entity** (a single bad row doesn't undo the rest). **`notify()` calls fire outside the transaction** so a rollback never produces ghost messages — keep that ordering.
- **Structured logging (Tier 5.4)**: use `req.log.error({err}, 'msg')` in handlers, top-level `logger.*` for boot-time messages. **Don't use `console.*`** — there should be zero such calls in backend code. The `X-Request-Id` response header is echoed back to clients; pass it through to correlate a client error with a server log line.
- **Helper return shapes (Tier 5.7)**: `getGroupsForUser()` returns `[{id, name, ownerId, visibility, members: [{userId, username}], invites: [{username, createdAt}], createdAt}]`; `getGroupById()` returns the same shape minus `visibility` (existing inconsistency, intentional). Preserve the shape — several components consume it.

---

## Adding things (compact)

- **API endpoint** — route in [server.js](server.js), zod schema in [validation/schemas.js](validation/schemas.js), `validate(schema)` middleware, `authMiddleware` + optional `requireAdmin`. Use `req.log.error` in catch blocks. Call `leaderboardCache.invalidate(...)` if the endpoint affects standings.
- **DB column / table** — edit the model in [models/](models/), then `npx sequelize-cli migration:generate --name <name>` and fill in `up` / `down`. See [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md).
- **Badge** — append to [badges/catalog.js](badges/catalog.js), add the unlock condition in `evaluateBadges()`.
- **Notification type** — call `notify(userId, type, title, body?, link?)`. No schema change (`type` is free-form).
- **Reaction emoji** — edit both `ALLOWED_EMOJIS` and `REACTION_EMOJIS`.
- **Bulk admin action** — extend `bulkGameSchema` / `bulkUserSchema` + the handler switch. If it deletes, wrap each iteration in `sequelize.transaction()`.
- **React component** — `.jsx` in [src/components/](src/components/); reuse `rounded-3xl border border-slate-800 bg-slate-900/85` shell and `focus-visible:ring-2 focus-visible:ring-cyan-400` for a11y.
- **Promote a user to admin** — use the Admin tab → User Manager → Promote (no SQL needed).

Detailed handler references and existing patterns: [ARCHITECTURE.md §5](ARCHITECTURE.md) + [§8](ARCHITECTURE.md).

---

## Known issues / TODOs

- **CORS too permissive** (`origin: true`) — Tier 6.1
- **No CSRF / password reset / account lockout / security headers** — Tier 6
- **No external football data source** (manual game entry only) — Tier 4b
- **No live scores / leagues / seasons / additional pick types** — Tier 4b
- **No "game starting soon" cron** — Tier 7
- **No profile privacy** (every authed user can view every profile) — Tier 8.6 (parked)
- **No real-time updates** — everything polls at 30 s — Tier 7
- **No automated E2E tests** (Playwright deferred, needs Docker) — Tier 5.5 / 9.4
- **Single-process leaderboard cache** — fine today; needs Redis for multi-instance — future
- **No frontend error boundary / Sentry** — Tier 5.4b

Recently shipped: **Tier 5 (core)** — migrations framework, leaderboard cache, transactional cascades, structured logging, N+1 elimination, gzip compression. See [ARCHITECTURE.md §13](ARCHITECTURE.md) for full roadmap status.
