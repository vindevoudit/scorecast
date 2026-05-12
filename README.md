# ScoreCast

A social football-prediction web app. Pick winners, join groups with friends, send friend requests, earn badges, banter in comments, and climb probability-weighted leaderboards. Built with React + Vite on the frontend and Express + PostgreSQL on the backend.

---

## Features

### Predict & compete
- **Probability-based scoring** — `points = round((1 − probability) × 100)` on correct picks, so backing the underdog pays more
- **Live / Upcoming / Completed** game sections with a per-game live countdown chip (`Picks lock in 2d 4h`)
- **My Picks** history with `All / Wins / Losses / Pending` filters
- **Overall + group leaderboards** with full scrollable rankings and a "you are here" highlight

### Social
- **Groups** — private (invite-only) or public (discoverable). Browse public groups in the **Discover** section and join with one click
- **Friend system** — request, accept, decline, unfriend. Open any friend's profile to see a **head-to-head** record across shared games
- **Public profiles** — open any leaderboard row to see another user's stats, badge wall, and recent picks in a side drawer
- **Per-game comments** — collapsible banter thread under every fixture
- **In-app notifications** — header bell polls every 30 s; types: invite, pick-scored, friend-request, group-join, badge earned

### Badges
Awarded automatically by server hooks:
- 🎯 First pick · 🏆 First win
- 🔟 / ⭐ / 💎 — 10 / 25 / 50 lifetime correct picks
- 🦄 Upset specialist — 5+ correct picks below 40% probability
- 🏗️ Group founder

### Admin
- Conditional **Admin** tab (visible only to users with `role='admin'`)
- **Game CRUD** — create, edit, delete fixtures; set/clear result; probability sum-to-1.0 validation
- **User moderation** — promote / demote / delete with cascading cleanup
- Server-side self-protection: admins cannot demote or delete themselves

### Quality of life
- Loading skeletons, empty-state placeholders, ConfirmModal-gated destructive actions
- Logout confirmation; auto-detection of expired sessions with a re-login toast
- Accessibility floor: labelled inputs, focus-visible rings, `aria-current` tabs, `aria-live` toasts

---

## Tech Stack

- **Frontend**: React 18, Vite 5, Tailwind CSS 3
- **Backend**: Node.js, Express 4
- **Database**: PostgreSQL with Sequelize 6 ORM
- **Auth**: JWT (7-day) via `jsonwebtoken`, passwords hashed with `bcryptjs`
- **Validation**: `zod` on every POST / PUT body
- **Rate limiting**: `express-rate-limit` on `/api/login` and `/api/register`

---

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 13+ running locally (or a remote URL)

### 1. Database
```bash
createdb scorecast_db
```

### 2. Environment
```bash
cp .env.example .env
```
Edit `.env`:
- `JWT_SECRET` — required. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `DATABASE_URL` — optional; defaults to `postgres://postgres:postgres@localhost/scorecast_db`
- `PORT` — defaults to `3000`
- `NODE_ENV` — `development` or `production`

> In `NODE_ENV=production`, the server refuses to boot without `JWT_SECRET`. In development it falls back to an insecure dev value with a warning.

### 3. Install
```bash
npm install
```

### 4. Run

**Development** (two terminals):
```bash
node server.js     # backend on :3000 (terminal 1)
npm run dev        # Vite on :5173 with /api proxy (terminal 2)
```
Open <http://localhost:5173>.

**Production**:
```bash
npm start          # vite build + node server.js, both served on :3000
```
Open <http://localhost:3000>.

---

## Demo users

Seeded from [data.json](data.json) on first boot when the `users` table is empty:

| Username | Password | Role |
| --- | --- | --- |
| `vo123` | `password123` | **admin** |
| `alice` | `secret` | user |
| `bob` | `secret` | user |

Log in as `vo123` to see the Admin tab and create new fixtures.

---

## API surface

Everything is JSON over `/api/*`. All endpoints except `/api/register` and `/api/login` require a `Bearer` token. Full endpoint catalogue in [CLAUDE.md](CLAUDE.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

Highlights:
- `POST /api/register`, `POST /api/login` — issue JWT (rate-limited)
- `GET /api/me` — current user + role + joined groups + pending invites
- `POST /api/picks` — submit/update; locked at kickoff
- `GET /api/leaderboard?groupId=` — overall + optional group leaderboard
- `GET /api/users/:username/profile` — public profile with stats, badges, friend status, head-to-head
- `POST /api/friends/request` · `/api/groups/discover` · `/api/games/:id/comments` · `/api/notifications`
- `POST /api/admin/games` · `/api/admin/users/:id/role` · `/api/admin/users/:id` (admin-gated)

---

## Project Documentation

- **[CLAUDE.md](CLAUDE.md)** — day-to-day reference: features, endpoints, models, common dev tasks, known issues
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — full system architecture handover: request lifecycle, schema details, domain subsystems, data flows
- **[DATABASE_SETUP.md](DATABASE_SETUP.md)** — local Postgres setup walkthrough
- **[MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)** — historical NeDB → Postgres migration notes

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Vite dev server (frontend only) with `/api` proxy to `:3000` |
| `npm run build` | Build the frontend bundle to `dist/` |
| `npm start` | Build, then boot `server.js` (serves the bundle + API on `:3000`) |
| `npm run preview` | Preview the production bundle without booting `server.js` |
| `node server.js` | Run the backend directly (assumes `dist/` already exists for static serving) |

---

## Notes

- Persistent data lives in PostgreSQL, managed by Sequelize. Schema syncs on boot via `sequelize.sync({ alter: false })` + an idempotent `runMigrations()` helper.
- The seed in [data.json](data.json) loads only when the `users` table is empty.
- In production, the Express server at `:3000` serves both the API and the built frontend from `dist/`. In dev, Vite serves the frontend at `:5173` and proxies `/api/*` to `:3000`.
- Scoring is implemented in two places intentionally: [server.js](server.js) (authoritative, used for leaderboards) and [src/utils/scoring.js](src/utils/scoring.js) (client-side preview). Keep them in sync.

---

## Roadmap

Tiers 1–3 are shipped (auth hardening, UX completions, social features). Tier 4's Admin UI is shipped; remaining Tier 4 work (external football API, live scores, leagues/seasons, additional pick types) and all of Tier 5 (real migrations, leaderboard caching, logging, E2E tests) are tracked in the planning docs referenced by [CLAUDE.md](CLAUDE.md).
