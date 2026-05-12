# ScoreCast v0.1 - Project Handover

## Project Overview
ScoreCast is a full-stack football prediction web app built with React + Node/Express. Users can make picks on games, join groups with friends, and compete on leaderboards with probability-based scoring.

## Tech Stack
- **Frontend**: React 18 + Vite + Tailwind CSS + PostCSS
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (with Sequelize ORM)
- **Auth**: JWT tokens (7-day expiry) — passwords hashed with bcryptjs
- **Validation**: zod schemas on every POST endpoint
- **Rate limiting**: express-rate-limit on auth endpoints
- **State Management**: React hooks (useState, useEffect, useMemo, useRef)

## Project Structure
```
ScoreCast v0.1/
├── src/                           # React frontend source
│   ├── App.jsx                   # Main app: state, tabs, dashboard layout, 401 handling
│   ├── main.jsx                  # React entry point
│   ├── index.css                 # Global styles
│   ├── components/
│   │   ├── GameCard.jsx          # Pick UI + outcome badge + countdown timer
│   │   ├── GroupCard.jsx         # Group display + invite form
│   │   ├── GroupLeaderboardCard.jsx
│   │   ├── InviteRow.jsx
│   │   ├── LeaderboardCard.jsx   # Full leaderboard + LeaderboardRow (shared)
│   │   ├── LoginForm.jsx
│   │   ├── RegisterForm.jsx
│   │   ├── PicksHistory.jsx      # "My Picks" tab with filters
│   │   ├── EmptyState.jsx        # Reusable empty-list placeholder
│   │   ├── Skeleton.jsx          # SkeletonGameCard + SkeletonLeaderboardRow
│   │   └── ConfirmModal.jsx      # Generic confirm dialog (used for logout)
│   └── utils/
│       ├── scoring.js            # scorePick() + pickStatus() — mirrors backend formula
│       └── time.js               # formatCountdown() + useCountdown() hook
├── models/                        # Sequelize models
│   ├── User.js                   # username, password (bcrypt-hashed), role, id
│   ├── Game.js
│   ├── Group.js
│   ├── GroupMember.js
│   ├── GroupInvite.js
│   ├── Pick.js                   # Unique composite index on (userId, gameId)
│   └── index.js                  # DB init + seeding + idempotent migrations
├── validation/
│   ├── schemas.js                # zod schemas for every POST body
│   └── middleware.js             # validate(schema) middleware factory
├── server.js                      # Express API + auth/admin middleware + static serving
├── db-config.js                   # Database configuration
├── data.json                      # Seed data (passwords get hashed on insert)
├── .env.example                   # Required env vars
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── README.md
├── ARCHITECTURE.md
├── DATABASE_SETUP.md
├── MIGRATION_GUIDE.md
└── dist/                          # Built production files (created by `npm run build`)
```

## Key Features

### User-facing
1. **Authentication**: Register/login with JWT tokens stored in localStorage; bcrypt-hashed passwords; rate-limited (5 login attempts / 15 min, 3 registrations / hour per IP)
2. **Game Predictions**: Pick home/away winners for upcoming games; picks lock at kickoff
3. **Probability-Based Scoring**: Points = round((1 − probability) × 100) for correct picks (rewards upsets)
4. **Game outcome display**: Once a game has a result, GameCard shows the winning team highlighted plus a `✓ Correct +N pts` / `✗ Missed` / `No pick` badge
5. **Pick deadline countdown**: Each upcoming game shows a live `Picks lock in 2d 4h` chip, updating every 30s
6. **Games filter sections**: Live / Upcoming / Completed (completed games collapsed behind a toggle)
7. **My Picks tab**: Full pick history with `All / Wins / Losses / Pending` filter chips
8. **Full leaderboards**: Overall + group leaderboards show every entry (scrollable); current user highlighted in cyan with a "you" tag
9. **Groups**: Create private groups and invite friends by username; accept/decline invites
10. **Session expiry handling**: 401 from any endpoint clears the session and shows a toast prompting re-login
11. **Logout confirmation**: Click-outside / Esc-to-close modal before signing out
12. **Loading skeletons + empty states**: Initial load shows skeleton game cards / leaderboard rows; every empty list has a dashed placeholder
13. **Accessibility floor**: `htmlFor`/`id` on every form field, `aria-current` on tabs, `aria-live` status toast, `aria-busy` on the dashboard during load, `focus-visible` rings on interactive elements

### Roles
- `user` (default) — can pick, join groups, view leaderboards
- `admin` — additionally can set game results (gated by `requireAdmin` middleware)
- Seed user `vo123` is bootstrapped as an admin via [data.json](data.json)

## API Endpoints

All endpoints require JWT auth except `/api/register` and `/api/login`.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/register` | — | Rate-limited (3/hr/IP); zod-validated |
| POST | `/api/login` | — | Rate-limited (5/15min/IP); bcrypt compare |
| GET | `/api/me` | user | Returns user + pending invites |
| GET | `/api/games` | user | All games sorted by date |
| POST | `/api/picks` | user | zod-validated; locked once `game.date <= now` or `result != null` |
| GET | `/api/picks` | user | Current user's picks |
| GET | `/api/groups` | user | Groups the user belongs to |
| GET | `/api/groups/:groupId` | user (member) | 404 if non-member |
| POST | `/api/groups` | user | zod-validated; creator auto-joins |
| POST | `/api/groups/:groupId/invite` | user (member) | Invite by username |
| POST | `/api/groups/:groupId/invite/:inviteId/accept` | user | Username must match invite |
| POST | `/api/groups/:groupId/invite/:inviteId/decline` | user | Same |
| GET | `/api/leaderboard?groupId=` | user | Real-time computed (not cached) |
| POST | `/api/games/:gameId/result` | **admin** | zod-validated; sets result to `home`/`away`/`null` |

## Running the App

### Development
```bash
npm run dev          # Vite dev server (frontend hot-reload). Run server.js separately for the API.
```

### Production
```bash
npm start            # Runs `vite build` then `node server.js` on port 3000
npm run build        # Just builds dist/
```

## Configuration

Copy [.env.example](.env.example) to `.env` and fill in:

- **JWT_SECRET** — **required in production**. Server throws on startup if missing while `NODE_ENV=production`; in development it warns and falls back to an insecure dev value.
- **DATABASE_URL** — optional. Defaults to local Postgres at `postgres://postgres:postgres@localhost/scorecast_db` (see [models/index.js](models/index.js)).
- **PORT** — defaults to `3000`.
- **NODE_ENV** — `development` or `production`. Gates the JWT_SECRET enforcement.

## Database

- Tables auto-created on first boot via `sequelize.sync({ alter: false })`.
- Idempotent migrations run on every boot (`runMigrations()` in [models/index.js](models/index.js)):
  - `ALTER TABLE users ADD COLUMN IF NOT EXISTS role …`
  - `CREATE UNIQUE INDEX IF NOT EXISTS picks_user_game_unique ON picks ("userId", "gameId")`
  - Re-hashes any seed user with a plaintext password (matched against [data.json](data.json))
- If the `users` table is empty on boot, the seed in [data.json](data.json) is inserted (passwords hashed via Sequelize `beforeCreate` hook).

### Database Models
- **User**: id, username (unique), password (bcrypt hash), `role` (`'user'|'admin'`, default `user`), createdAt
- **Game**: id, homeTeam, awayTeam, date, result (`'home'|'away'|null`), homeProbability, awayProbability
- **Group**: id, name, ownerId, createdAt
- **GroupMember**: groupId, userId (composite PK)
- **GroupInvite**: id, groupId, username, createdAt
- **Pick**: id, userId, gameId, choice (`'home'|'away'`), submittedAt — **unique (userId, gameId)**

## Important Notes

- Vite config serves the built frontend from `dist/` via Express static middleware
- Picks can only be submitted for games before their start date AND before a result is set
- Group leaderboards only include group members
- The `request()` helper in [src/App.jsx](src/App.jsx) auto-detects 401 responses and clears the session — frontend never needs to manually log out on token expiry
- Scoring formula is duplicated in two places intentionally: [server.js](server.js) (authoritative, used for leaderboard) and [src/utils/scoring.js](src/utils/scoring.js) (client-side preview for GameCard outcome + My Picks). They must stay in sync.

## Common Development Tasks
- Add new API endpoint: route in [server.js](server.js); add `validate(schema)` middleware + a schema in [validation/schemas.js](validation/schemas.js); gate with `authMiddleware` and optionally `requireAdmin`
- Add new React component: create `.jsx` file in [src/components/](src/components/); reuse existing card shell `rounded-3xl border border-slate-800 bg-slate-900/85` and `focus-visible:ring-2 focus-visible:ring-cyan-400` for a11y
- Add new database model: create file in [models/](models/), wire it up in [models/index.js](models/index.js); if you change an existing model's schema, add an idempotent statement in `runMigrations()`
- Promote a user to admin: `UPDATE users SET role = 'admin' WHERE username = '…';` (no admin UI yet)
- Deploy: `npm run build` then deploy `dist/` + `server.js` + `node_modules` + `.env`

## Recent Changes

### Tier 1 — Security hardening (2026-05-12)
- bcrypt password hashing (via User `beforeCreate`/`beforeUpdate` hooks)
- RBAC: `role` ENUM column + `requireAdmin` middleware; JWT payload now includes `role`
- Rate limiting on `/api/register` and `/api/login`
- zod validation on every POST route
- Unique composite index on `Pick(userId, gameId)`
- JWT secret moved to required env var (no insecure fallback in production)
- Idempotent `runMigrations()` that evolves the schema and re-hashes legacy plaintext passwords

### Tier 2 — UX completions (2026-05-12)
- Game outcome badges in GameCard
- Full (uncapped) leaderboards with "you are here" highlight, rank column, scrollable
- New "My Picks" tab with All/Wins/Losses/Pending filters
- Game filter sections (Live / Upcoming / Completed)
- Pick deadline countdown chips
- Empty-state component + skeleton variants for loading states
- Logout confirmation modal + session-expired (401) auto-logout with toast
- Mobile responsive pass (horizontal-scrolling tab row, truncate on long usernames/group IDs)
- Accessibility pass (htmlFor, autoComplete hints, focus-visible rings, aria-current/aria-live/aria-busy)

## Known Issues / TODOs

### Still outstanding (from the original handover)
- **CORS too permissive** — `cors({ origin: true })` in [server.js](server.js). Tighten before any non-localhost deployment.
- **No real migrations framework** — using `sync({ alter: false })` + an ad-hoc `runMigrations()`. Tier 5 candidate (sequelize-cli).
- **Leaderboard not cached** — O(users × picks × games) per `GET /api/leaderboard` request. Tier 5 candidate.
- **No real football data source** — games come only from seed JSON; no admin UI to add/edit games.
- **No leave-group / delete-group / delete-pick endpoints**.

### Tracked in the tier plan
The remaining roadmap (Tiers 3–5: social/engagement features, real game data, ops polish) lives in `C:\Users\vinde\.claude\plans\go-through-this-codebase-warm-cloud.md`.
