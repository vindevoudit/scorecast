# ScoreCast

A social football-prediction web app. Pick winners, join groups with friends, send friend requests, earn badges, banter in comments, and climb probability-weighted leaderboards. Built with React + Vite on the frontend and Express + PostgreSQL on the backend.

**Live at https://bantryx.com** — deployed to Azure Container Apps with CD from this repo's `main` branch.

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

### Application

- **Frontend**: React 18, Vite 5, Tailwind CSS 3. Code-split via `React.lazy` for Admin / Profile / Picks-history routes.
- **Backend**: Node.js 20, Express 4
- **Database**: PostgreSQL 16 with Sequelize 6 ORM; migrations via `sequelize-cli` + `umzug`
- **Auth**: HttpOnly cookie auth — 15-min access JWT + 30-day rotating refresh token, hashed in DB. `bcryptjs` for passwords; `speakeasy` + `qrcode` for TOTP 2FA
- **CSRF**: double-submit cookie pattern (`sc_csrf` cookie + `X-CSRF-Token` header)
- **Security headers**: `helmet` (CSP tuned for Vite + Tailwind + Sentry; HSTS; `X-Frame-Options: DENY`)
- **Email**: pluggable transport via `lib/email.js` — Resend in production, log-only fallback in dev
- **Validation**: `zod` on every POST / PUT body. OpenAPI 3.0 spec generated from the same schemas (`GET /api/docs` in dev)
- **Rate limiting**: `express-rate-limit` on login, register, comments, friend-requests, picks, password-reset, and client-error endpoints
- **Logging**: `pino` + `pino-http` with request-id correlation; optional Sentry SDK (server + browser) gated behind `SENTRY_DSN` / `VITE_SENTRY_DSN`
- **HTTP**: gzip via `compression` middleware
- **Leaderboard cache**: in-memory `Map` with 30-second TTL

### Dev tooling (Tier 9.1–9.3)

- **Lint + format**: ESLint 9 flat config + Prettier 3 + `husky` + `lint-staged`. Pre-commit auto-fixes; pre-push runs `npm run build`
- **API docs**: `@asteasolutions/zod-to-openapi` → Swagger UI at `/api/docs` (dev-only)

### Cloud deployment (Tier 9.4–9.9)

- **Container image**: multi-stage `Dockerfile` on `node:20-alpine`, non-root uid 1001, `tini` PID 1, `HEALTHCHECK` on `/healthz`
- **Local stack**: `docker-compose.yml` (app + `postgres:16-alpine` + `redis:7-alpine`, all with healthchecks)
- **CI**: `.github/workflows/ci.yml` — lint, format-check, build, migrations smoke against an ephemeral Postgres on every PR
- **CD**: `.github/workflows/deploy.yml` — push to `main` → build image → push to Azure Container Registry → run migrations as a Container Apps Job → roll a new Container App revision → smoke `https://bantryx.com/healthz`. Auth via GitHub OIDC federated credential (no long-lived secrets)
- **Infrastructure as code**: Bicep modules in `infra/` (Log Analytics + App Insights, ACR, Key Vault, Postgres Flex B1ms, Container Apps env, main app, migration job)
- **Cloud target**: Azure (`eastus2`) — Container Apps (Consumption, scale 0→3), Postgres Flex B1ms, Key Vault for secrets, system-assigned managed identity for auth to ACR + Key Vault
- **Domain + TLS**: `bantryx.com` on Cloudflare DNS (grey-cloud) → apex CNAME to Azure FQDN; Azure managed TLS cert via HTTP-01 ACME validation; `www.bantryx.com` 301-redirects to apex via Cloudflare redirect rule

---

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ running locally (or a remote URL — production runs on Azure DB for PostgreSQL Flexible Server)
- (Optional) Docker Desktop for the containerized local stack
- (Optional, for cloud work) Azure CLI + Bicep, GitHub CLI

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

**Production-like single process**:

```bash
npm start          # vite build + node server.js, both served on :3000
```

Open <http://localhost:3000>.

**Full containerized stack** (mirrors the prod image; uses `NODE_ENV=production`):

```bash
docker compose up --build
```

Open <http://localhost:3000>. Note: cookies are `Secure` in this mode so login won't transmit over `http://localhost` — use the two-terminal dev flow for full UI testing.

---

## Deployment (Azure)

Cloud target is Azure. CD auto-runs on push to `main`.

### One-time setup (already done for this repo)

- Resource group `scorecast-prod` in `eastus2`
- Azure resources provisioned via `infra/main.bicep` — Container Apps + Postgres Flex + ACR + Key Vault + Log Analytics + App Insights
- Azure AD app `scorecast-github-cd` with federated credential for `repo:vindevoudit/scorecast:ref:refs/heads/main`
- GitHub repo secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- Custom domain `bantryx.com` bound to the Container App via Cloudflare DNS + Azure managed cert

### What happens on `git push origin main`

1. `.github/workflows/deploy.yml` runs:
   - **build-and-push** — `npm ci` → lint → `npm run build` → `docker build` → push to ACR with tags `<sha>` and `latest`
   - **migrate** — `az containerapp job update` then `az containerapp job start scorecast-migrate` → polls execution status; fails the workflow on non-success (no traffic shift)
   - **deploy** — `az containerapp update --image <sha>` → polls revision until `Running` → smoke `https://bantryx.com/healthz`
2. Total time ~5 min for a typical change
3. Failure modes: build error / migration failure / new revision unhealthy / smoke fails → old revision continues serving; revert + re-push to recover

### Cost (at this scale)

~$30–40/mo Azure (Postgres B1ms dominates) + ~$13/yr domain. TLS, OIDC, CD pipeline all free. Detailed breakdown in `C:\Users\vinde\.claude\plans\can-you-confirm-that-reflective-kay.md`.

### Full IaC reapply

`deploy.yml` (CD) only runs `az containerapp update --image`, which preserves the custom domain binding + env vars regardless. For a full IaC reapply via `az deployment group create -f infra/main.bicep`, pass three params so the deployment stays idempotent:

```powershell
$certId = az containerapp env certificate list `
  --name scorecast-env-p3aaelev7xp52 `
  --resource-group scorecast-prod `
  --query "[?properties.subjectName=='bantryx.com'].id" -o tsv

az deployment group create -g scorecast-prod -f infra/main.bicep `
  -p customDomain=bantryx.com `
     customDomainCertId=$certId `
     pgAdminPassword=<the-live-pw>
```

The cert binding lives in `infra/modules/app.bicep` via the `customDomains` array; `CORS_ORIGINS` + `PUBLIC_APP_URL` env vars pivot on `customDomain`. DNS is on Cloudflare — the `dns.bicep` module is gated behind a `useAzureDns=false` default.

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
- **[ml/README.md](ml/README.md)** — Python ML pipeline (Elo + XGBoost) that produces match probabilities for upcoming fixtures
- **[ml/ONBOARDING.md](ml/ONBOARDING.md)** — end-to-end ML walkthrough + per-league onboarding playbook (Spain, Germany, Italy, France, etc.)

---

## Scripts

| Command                       | What it does                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `npm install`                 | Install dependencies                                                         |
| `npm run dev`                 | Vite dev server (frontend only) with `/api` proxy to `:3000`                 |
| `npm run build`               | Build the frontend bundle to `dist/` (with hidden sourcemaps for Sentry)     |
| `npm start`                   | Build, then boot `server.js` (serves the bundle + API on `:3000`)            |
| `npm run preview`             | Preview the production bundle without booting `server.js`                    |
| `node server.js`              | Run the backend directly (assumes `dist/` already exists for static serving) |
| `npm run lint`                | ESLint over the repo                                                         |
| `npm run format`              | Prettier `--write` over the repo                                             |
| `npm run format:check`        | Prettier `--check` (used by CI)                                              |
| `npm run db:migrate`          | Apply pending database migrations                                            |
| `npm run db:migrate:undo`     | Roll back the most recent migration                                          |
| `npm run db:migrate:undo:all` | Roll back all migrations (used by CI smoke test only)                        |
| `npm run db:migrate:status`   | Show applied / pending migrations                                            |
| `npm run db:seed`             | Run all idempotent seeders                                                   |
| `docker compose up --build`   | Local containerized stack (app + Postgres + Redis)                           |

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
- **Tier 9 (less 9.10 TS + 9.11 Storybook)** — ESLint/Prettier/Husky baseline, frontend code-splitting, OpenAPI docs (dev), Dockerfile + docker-compose, GitHub Actions CI, Bicep IaC for Azure, GitHub Actions CD with OIDC, custom domain `bantryx.com` + Azure managed TLS. **App is live at https://bantryx.com.**

**Pending:**

- **Tier 4b** — external football API, live scores, leagues / seasons, additional pick types, audit log (deferred — needs API key)
- **Tier 5.5** — Playwright E2E (Docker is now available; unblocked)
- **Tier 7** — real-time push, scheduler-driven notifications, web push, email digests
- **Tier 8.6** — profile privacy (parked)
- **Tier 9.10 / 9.11** — TypeScript migration + Storybook (parked at end of roadmap)
- **Tier 10** — health probes (`/readyz`), Prometheus metrics, managed Redis, graceful SIGTERM shutdown, cloud log shipping

Detailed planning docs are referenced from [CLAUDE.md](CLAUDE.md).
