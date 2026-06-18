# syntax=docker/dockerfile:1.7

# ============================================================================
# Stage 1 — build: install all deps and produce dist/
# ============================================================================
FROM node:26-alpine AS build
WORKDIR /app

# HUSKY=0 skips the `prepare: husky` script during install (the dev hook
# installer is irrelevant inside a container; .git isn't even shipped).
ENV HUSKY=0 \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Install deps first so the layer caches when only source files change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ============================================================================
# Stage 2 — runtime: prod-only deps + dist + minimal source surface
# ============================================================================
FROM node:26-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HUSKY=0 \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    PORT=3000

# wget is needed by HEALTHCHECK (alpine doesn't include curl by default).
RUN apk add --no-cache wget tini

# Non-root user.
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

# Install prod-only deps in a fresh node_modules; smaller than reusing the
# build-stage node_modules and `npm prune`. `--ignore-scripts` skips the
# `prepare: husky` hook (husky is a devDep so the binary isn't here).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy built frontend + every backend file the server requires at runtime.
COPY --from=build /app/dist ./dist
COPY server.js db-config.js .sequelizerc ./
COPY lib ./lib
COPY middleware ./middleware
COPY models ./models
COPY migrations ./migrations
COPY seeders ./seeders
COPY validation ./validation
COPY badges ./badges
COPY config ./config
COPY routes ./routes
COPY services ./services
# Operator scripts (Tier 17 + Tier 24 backfills, ad-hoc queries) — runnable
# via `az containerapp exec --command "node scripts/<name>.mjs"`. Required
# because backfills aren't part of `npm run db:migrate`; they have to be
# invoked explicitly by an operator after CD lands.
COPY scripts ./scripts
# Marketing render libs + bundled TTF fonts — read at runtime by the matchday
# graphics cron job (lib/jobs/postMatchdayGraphics.js) via a dynamic import of
# marketing/lib/render.mjs (which pulls brand.mjs + product.mjs and rasterizes
# with @resvg/resvg-js, now a prod dep). marketing/out (the CLI's output dir)
# is intentionally NOT copied — the job renders to in-memory buffers + emails
# them. The job is gated behind MARKETING_AUTOMATION_ENABLED, so with the env
# unset these files just sit unused (~1 MB lib + ~1.5 MB fonts).
COPY marketing/lib ./marketing/lib
COPY marketing/fonts ./marketing/fonts
COPY data.json ./data.json
# International model dataset — read once by the international Elo bootstrap
# seeder (seeders/20260528000003-seed-teams-from-intl-elo-history.js). Same
# operator runbook as Tier 24's backfill: invoked via `az containerapp exec
# --command "npx sequelize-cli db:seed --seed 20260528000003-seed-teams-from-intl-elo-history.js"`
# once after the deploy lands. ~3.6 MB image overhead; the seeder warn-and-skips
# if the directory is missing so removing this COPY just disables the
# one-time bootstrap (LeagueService.upsertFixture would then auto-insert at
# min(elo)=1500 for every nation as WC fixtures sync — workable but loses
# the pre-launch FIFA-Elo history).
COPY international_match_archive ./international_match_archive

# Drop root.
RUN chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O- http://localhost:3000/healthz || exit 1

# tini reaps zombies and forwards SIGTERM/SIGINT cleanly to node (Tier 10.5
# will add graceful shutdown handlers; tini ensures the signal reaches them).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
