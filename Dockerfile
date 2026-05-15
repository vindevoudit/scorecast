# syntax=docker/dockerfile:1.7

# ============================================================================
# Stage 1 — build: install all deps and produce dist/
# ============================================================================
FROM node:20-alpine AS build
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
FROM node:20-alpine AS runtime
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
COPY data.json ./data.json

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
