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

### Account security

- **HttpOnly cookie auth** — 15-min access JWT + 30-day rotating refresh token. No tokens in localStorage; XSS payloads can't lift a session
- **Email verification** at register and **password reset** via email-delivered single-use tokens (15-min for reset, 24h for verify)
- **Account lockout** — 5 wrong-password attempts → 15-min lock. Generic 401 for wrong-pw / unknown-user / locked, so attackers can't enumerate accounts
- **Opt-in two-factor authentication** (TOTP) via any authenticator app (Google Authenticator, Authy, 1Password, etc.) with 10 single-use recovery codes
- **CSRF protection** via double-submit cookie on every state-changing request
- **CORS allowlist + helmet headers** (CSP, HSTS, `X-Frame-Options: DENY`) — server refuses to boot in production without an allowlist
- **Per-route rate limits** on login, register, password-reset, comments, friend-requests, picks, and client error reports

### Quality of life

- Loading skeletons, empty-state placeholders, ConfirmModal-gated destructive actions
- Logout confirmation; auto-detection of expired sessions with a re-login toast
- Transparent token refresh on the client — 15-min access expiry is invisible to the user
- Accessibility floor: labelled inputs, focus-visible rings, `aria-current` tabs, `aria-live` toasts

---

## Tech Stack

- **Frontend**: React 18, Vite 5, Tailwind CSS 3
- **Backend**: Node.js, Express 4
- **Database**: PostgreSQL with Sequelize 6 ORM; migrations via `sequelize-cli` + `umzug`
- **Auth**: HttpOnly cookie auth — 15-min access JWT + 30-day rotating refresh token, hashed in DB. `bcryptjs` for passwords; `speakeasy` + `qrcode` for TOTP 2FA
- **CSRF**: double-submit cookie pattern (`sc_csrf` cookie + `X-CSRF-Token` header)
- **Security headers**: `helmet` (CSP tuned for Vite + Tailwind + Sentry; HSTS; `X-Frame-Options: DENY`)
- **Email**: pluggable transport via `lib/email.js` — Resend in production, log-only fallback in dev
- **Validation**: `zod` on every POST / PUT body
- **Rate limiting**: `express-rate-limit` on login, register, comments, friend-requests, picks, password-reset, and client-error endpoints
- **Logging**: `pino` + `pino-http` with request-id correlation; optional Sentry SDK (server + browser) gated behind `SENTRY_DSN` / `VITE_SENTRY_DSN`
- **HTTP**: gzip via `compression` middleware
- **Leaderboard cache**: in-memory `Map` with 30-second TTL

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
- `CORS_ORIGINS` — comma-separated allowlist (e.g. `http://localhost:5173,http://localhost:3000`). **Required in production**; dev falls back to permissive if unset.
- `DATABASE_URL` — optional; defaults to `postgres://postgres:postgres@localhost/scorecast_db`
- `PORT` — defaults to `3000`
- `NODE_ENV` — `development` or `production`
- `RESEND_API_KEY` + `EMAIL_FROM` — optional. Without the key, verify/reset emails are logged to stdout instead of sent — copy the link from the server log to test the flow.
- `PUBLIC_APP_URL` — base URL baked into outbound email links (default `http://localhost:3000`; set to `http://localhost:5173` when using the Vite dev server, or your deployed URL in prod).
- `SENTRY_DSN` / `VITE_SENTRY_DSN` — optional Sentry capture (server + browser). Both no-op when unset.

> In `NODE_ENV=production`, the server refuses to boot without `JWT_SECRET` **or** `CORS_ORIGINS`. In development it falls back to insecure dev values with a warning.

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

| Username | Password      | Role      |
| -------- | ------------- | --------- |
| `vo123`  | `password123` | **admin** |
| `alice`  | `secret`      | user      |
| `bob`    | `secret`      | user      |

Log in as `vo123` to see the Admin tab and create new fixtures.

---

## API surface

Everything is JSON over `/api/*`. Authentication is via HttpOnly cookies (`sc_access`, `sc_refresh`) set on login/register — no `Authorization` header. Every state-changing request must also echo the `sc_csrf` cookie via an `X-CSRF-Token` header. Full endpoint catalogue in [CLAUDE.md](CLAUDE.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

Highlights:

- `POST /api/register`, `POST /api/login` — sets auth cookies (rate-limited; login may return `{challenge: true}` when 2FA is enabled)
- `POST /api/auth/refresh` · `/api/auth/logout` — rotate / revoke the refresh chain
- `POST /api/auth/verify-email` · `/api/auth/forgot-password` · `/api/auth/reset-password` — email-driven account recovery
- `POST /api/auth/2fa/verify` — complete 2FA challenge after a successful password
- `POST /api/me/2fa/setup` · `/api/me/2fa/confirm` · `/api/me/2fa/disable` — TOTP lifecycle
- `GET /api/me` — current user + role + joined groups + pending invites + 2FA / email-verified status
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
- **[MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)** — how to add a new database migration
- **[MIGRATIONS_PRIMER.md](MIGRATIONS_PRIMER.md)** — plain-language explainer of the migrations framework

---

## Scripts

| Command                     | What it does                                                                 |
| --------------------------- | ---------------------------------------------------------------------------- |
| `npm install`               | Install dependencies                                                         |
| `npm run dev`               | Vite dev server (frontend only) with `/api` proxy to `:3000`                 |
| `npm run build`             | Build the frontend bundle to `dist/`                                         |
| `npm start`                 | Build, then boot `server.js` (serves the bundle + API on `:3000`)            |
| `npm run preview`           | Preview the production bundle without booting `server.js`                    |
| `node server.js`            | Run the backend directly (assumes `dist/` already exists for static serving) |
| `npm run db:migrate`        | Apply pending database migrations                                            |
| `npm run db:migrate:undo`   | Roll back the most recent migration                                          |
| `npm run db:migrate:status` | Show applied / pending migrations                                            |
| `npm run db:seed`           | Run all idempotent seeders                                                   |

---

## Notes

- Persistent data lives in PostgreSQL, managed by Sequelize. Schema evolution is via versioned migrations under `migrations/` (sequelize-cli for CLI use, umzug for dev-boot auto-apply). Production deploys run `npm run db:migrate` as an explicit step.
- The seed in [data.json](data.json) loads only when the `users` table is empty.
- In production, the Express server at `:3000` serves both the API and the built frontend from `dist/`. In dev, Vite serves the frontend at `:5173` and proxies `/api/*` to `:3000`.
- Scoring is implemented in two places intentionally: [server.js](server.js) (authoritative, used for leaderboards) and [src/utils/scoring.js](src/utils/scoring.js) (client-side preview). Keep them in sync.

---

## Roadmap

**Shipped:**

- **Tiers 1–3** — auth hardening, UX completions, social features
- **Tier 4a** — Admin UI for game CRUD + user moderation
- **Tier 5 (core) + 5.4b** — migrations framework, leaderboard cache, transactional cascades, structured logging, N+1 elimination, gzip, frontend error boundary + `/api/client-errors` + Sentry opt-in
- **Tier 6** — security hardening: CORS allowlist, helmet headers, account lockout, per-route rate limits, email service abstraction, email verification on register, password reset, HttpOnly cookie auth + rotating refresh tokens, CSRF double-submit, TOTP 2FA

**Pending:**

- **Tier 4b** — external football API, live scores, leagues / seasons, additional pick types, audit log (deferred — needs API key)
- **Tier 5.5** — Playwright E2E (deferred — needs Docker from Tier 9.4)
- **Tier 7** — real-time push, scheduler-driven notifications, web push, email digests
- **Tier 8.6** — profile privacy (parked)
- **Tier 9** — Docker, CI/CD, IaC, cloud deploy, TypeScript, Storybook
- **Tier 10** — health probes, Prometheus metrics, managed Redis, graceful shutdown, cloud log shipping

Detailed planning docs are referenced from [CLAUDE.md](CLAUDE.md).
