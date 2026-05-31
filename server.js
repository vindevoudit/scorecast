require('./lib/instrument'); // Sentry init must come before Express for OpenTelemetry instrumentation
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const pinoHttp = require('pino-http');

const { initDatabase, sequelize } = require('./models');
const logger = require('./lib/logger');
const requestId = require('./middleware/requestId');
const sentry = require('./lib/sentry');
const csrfMiddleware = require('./middleware/csrf');
const { attachResponseHelpers } = require('./lib/response');
const errorMiddleware = require('./lib/errorMiddleware');

// Route modules (Tier 13.2). server.js stays a composition shell — every
// handler now lives under routes/.
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const clientErrorsRoutes = require('./routes/client-errors');
const meRoutes = require('./routes/me');
const gamesRoutes = require('./routes/games');
const picksRoutes = require('./routes/picks');
const groupsRoutes = require('./routes/groups');
const leaderboardRoutes = require('./routes/leaderboard');
const friendsRoutes = require('./routes/friends');
const usersRoutes = require('./routes/users');
const commentsRoutes = require('./routes/comments');
const notificationsRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const leaguesRoutes = require('./routes/leagues');
const pushRoutes = require('./routes/push');
const { buildDocsRouter, mountSwagger } = require('./routes/docs');

// Tier 4b Chunk 2 — register cron jobs at module load. scheduler.start()
// is called after app.listen() so the listener is healthy before background
// work begins. Skipping these requires also dropping the start() call below.
const scheduler = require('./lib/scheduler');
const syncFixturesJob = require('./lib/jobs/syncFixtures');
const syncLiveScoresJob = require('./lib/jobs/syncLiveScores');
const reconcileInProgressGamesJob = require('./lib/jobs/reconcileInProgressGames');
const sendKickoffRemindersJob = require('./lib/jobs/sendKickoffReminders');
const lockPickProbabilitiesJob = require('./lib/jobs/lockPickProbabilities');
const sendWeeklyRecapJob = require('./lib/jobs/sendWeeklyRecap');
const selectCoinFlipJob = require('./lib/jobs/selectCoinFlip');
const FIXTURE_SYNC_CRON = process.env.FIXTURE_SYNC_CRON || '0 3 * * *'; // daily 03:00 UTC
// Tier 18 Chunk 2 — 30 s live poll (was every minute). Sits comfortably in
// the 20 req/min TIER_ONE budget (~2 req/min steady state for the global
// LIVE poll). node-cron 4.x supports the 6-field syntax with seconds.
const LIVE_SCORE_SYNC_CRON = process.env.LIVE_SCORE_SYNC_CRON || '*/30 * * * * *';
// Tier 18 Chunk 2 — 3-min defensive reconcile (was 5 min) via ?ids= for
// any in-progress game — closes the gap when football-data.org's ?status=
// filter goes stale relative to the canonical ?ids= endpoint. See
// lib/jobs/reconcileInProgressGames.js header.
const IN_PROGRESS_RECONCILE_CRON = process.env.IN_PROGRESS_RECONCILE_CRON || '*/3 * * * *';
// PWA Chunk 6 — kickoff reminders, every 15 min. Each fire pushes a
// 'kickoff-reminder' to every user with a pick on a game kicking off in the
// next 15-30 min. games.kickoffReminderSentAt dedups across ticks.
const KICKOFF_REMINDER_CRON = process.env.KICKOFF_REMINDER_CRON || '*/15 * * * *';
// Tier 19 Chunk 5 — every 1 min, locks pick probability snapshots on any
// scheduled game whose kickoff has passed. Cost-gated by a count() short-
// circuit, so off-season ticks are near-free.
const LOCK_PICK_PROBABILITIES_CRON = process.env.LOCK_PICK_PROBABILITIES_CRON || '* * * * *';
// Tier 30 Phase 3 A5 — weekly recap push, fires Mondays 02:00 UTC.
// Scoped to users with picks scored in the trailing 7-day window.
// Cost-gated by a count() short-circuit so off-season Mondays are
// near-free.
const WEEKLY_RECAP_CRON = process.env.WEEKLY_RECAP_CRON || '0 2 * * 1';
// Tier 30 Phase 3 A6 — daily "Pick of the Day" selection. Stamps
// games.coinFlipDayKey on the most uncertain scheduled fixture in
// active leagues. 00:30 UTC ensures the selection lands well before
// any of today's matches kick off.
const COIN_FLIP_CRON = process.env.COIN_FLIP_CRON || '30 0 * * *';
scheduler.register('syncFixtures', FIXTURE_SYNC_CRON, syncFixturesJob.run);
scheduler.register('syncLiveScores', LIVE_SCORE_SYNC_CRON, syncLiveScoresJob.run);
scheduler.register(
  'reconcileInProgressGames',
  IN_PROGRESS_RECONCILE_CRON,
  reconcileInProgressGamesJob.run,
);
scheduler.register('sendKickoffReminders', KICKOFF_REMINDER_CRON, sendKickoffRemindersJob.run);
scheduler.register(
  'lockPickProbabilities',
  LOCK_PICK_PROBABILITIES_CRON,
  lockPickProbabilitiesJob.run,
);
scheduler.register('sendWeeklyRecap', WEEKLY_RECAP_CRON, sendWeeklyRecapJob.run);
scheduler.register('selectCoinFlip', COIN_FLIP_CRON, selectCoinFlipJob.run);

const PORT = process.env.PORT || 3000;

const app = express();

// Behind Cloudflare → Azure Container Apps. `1` trusts exactly one hop
// (the Azure ingress) so req.ip resolves to the real client IP from
// X-Forwarded-For and the per-IP rate limiters bucket per-client instead
// of globally. Do NOT use `true` — that trusts X-Forwarded-For from any
// upstream and would let an attacker spoof their IP.
app.set('trust proxy', 1);

// Order matters (CLAUDE.md): requestId → logger → compression → helmet → cors
// → bodyParser → cookieParser → csrf → response helpers → routes → 404 → SPA.
app.use(requestId);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id,
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }),
);
app.use(compression());

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && corsOrigins.length === 0) {
  throw new Error('CORS_ORIGINS env var is required in production');
}
const cspConnectSrc = ["'self'", 'https://*.sentry.io', 'https://*.ingest.sentry.io'];
if (process.env.NODE_ENV !== 'production') {
  cspConnectSrc.push('ws://localhost:5173', 'http://localhost:5173');
}
// Tier 20 Chunk 6 — SHA-256 hash of the inline JSON-LD <script> block in
// index.html. CSP scriptSrc requires this exact hash to permit the block;
// helmet's default `'self'` would otherwise reject it (inline scripts
// without a hash/nonce are blocked by default). If the JSON-LD body's
// bytes change AT ALL (any whitespace, added field, value tweak), this
// hash must be re-computed via:
//   node -e "const c=require('crypto');console.log('sha256-'+c.createHash('sha256').update('<exact body>').digest('base64'))"
// The JSON-LD block in index.html is deliberately single-line for this
// reason — easier to keep byte-stable.
const JSON_LD_HASH = "'sha256-GhzleH2mfEY14NZF8AZ+UWxx4YN/y6+t46pWTLHVEUo='";
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", JSON_LD_HASH],
  // Google Fonts CSS comes from fonts.googleapis.com (referenced in
  // index.html). Without this entry helmet's default styleSrc would block
  // the stylesheet and the Bebas Neue / Libre Baskerville fonts fall back
  // to system defaults.
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  imgSrc: ["'self'", 'data:'],
  connectSrc: cspConnectSrc,
  // fonts.gstatic.com hosts the actual .woff2 binaries for the Google Fonts.
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
  // PWA chunk 1 — allow the service worker (workbox-generated /sw.js) and
  // the web app manifest. Without workerSrc, helmet falls back to scriptSrc
  // for SW registration, which works today but is brittle if scriptSrc ever
  // tightens. manifestSrc is required by every browser that honors CSP-3.
  workerSrc: ["'self'"],
  manifestSrc: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
};
// `upgrade-insecure-requests` is helmet's default. In production it's
// correct (we terminate TLS at Cloudflare/Azure). In dev + test we serve
// over plain HTTP on localhost, and WebKit follows this directive even
// for 127.0.0.1, upgrading every asset request to https:// and failing
// with SSL errors — which broke `npm run test:screenshots`.
if (process.env.NODE_ENV !== 'production') {
  cspDirectives.upgradeInsecureRequests = null;
}
app.use(
  helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    frameguard: { action: 'deny' },
    // Tier 22 M3 — explicit HSTS with preload. Helmet's default omits
    // `preload`, which means every first-visit-on-new-device is still a
    // one-shot MITM downgrade window. Two-year max-age + preload lets us
    // submit bantryx.com to https://hstspreload.org after ~30 days of
    // production traffic, hardcoding HTTPS in every modern browser.
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  }),
);
// Helmet doesn't set Permissions-Policy. Deny the dangerous-feature set
// outright — the app uses none of these and an opt-out header keeps any
// future embedded iframe or compromised dependency from prompting users.
// Tier 22 L4 — extended beyond camera/mic/geo/payment to cover USB /
// fullscreen / motion sensors (accel/gyro/magnetometer) / FLoC
// (interest-cohort). Defense-in-depth.
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()',
  );
  next();
});
// Tier 22 M2 — CORS fallback hardening. Production throws above when
// CORS_ORIGINS is empty, so this fallback only fires in dev/test. The
// previous `true` (allow any origin) would silently accept credentialed
// requests from any host if a future staging env forgot to set
// CORS_ORIGINS — credential-theft risk via a malicious origin. Lock to
// localhost only; a future staging env MUST set CORS_ORIGINS explicitly.
const FALLBACK_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];
app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : FALLBACK_CORS_ORIGINS,
    credentials: true,
  }),
);
// Cap inbound JSON at 32KB. Largest legitimate request is the client-error
// report (~17KB worst case from clientErrorSchema); 32KB leaves headroom
// while shrinking the oversized-payload DoS surface vs body-parser's
// 100KB default.
app.use(bodyParser.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(csrfMiddleware);
app.use(attachResponseHelpers);

// Liveness probe at root path (Docker HEALTHCHECK, Azure Container Apps
// ingress probes). Tier 10.1 will add /readyz alongside.
app.use(healthRoutes);

// Dev-only API docs (Tier 9.3). The /api 404 sentinel below still catches
// stray paths under /api/* in production.
if (process.env.NODE_ENV !== 'production') {
  app.use('/api', buildDocsRouter());
  mountSwagger(app, '/api/docs');
  logger.info('OpenAPI docs available at /api/docs and /api/openapi.json (dev only)');
}

// Tier 25 A2 — cache-control on static assets. Vite emits hash-versioned
// bundles under `/assets/` (the filename changes on every content
// change), so those can be cached forever with `immutable`. Everything
// else at the dist root — `index.html`, `sw.js`, `manifest.webmanifest`,
// favicon, PWA icons, `registerSW.js` — must NOT be aggressively cached
// or service worker updates get trapped behind a stale browser cache.
// `no-cache` here means "revalidate every request"; ETag still returns
// 304 most of the time, so the overhead is a small conditional GET, not
// a full byte transfer.
app.use(
  express.static(path.join(__dirname, 'dist'), {
    setHeaders: (res, filepath) => {
      if (filepath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

// API routes. Each module exports an Express Router with paths relative to
// /api. Tier 13 Chunk 2 will move handler bodies into services/.
app.use('/api', authRoutes);
app.use('/api', clientErrorsRoutes);
app.use('/api', meRoutes);
app.use('/api', gamesRoutes);
app.use('/api', picksRoutes);
app.use('/api', groupsRoutes);
app.use('/api', leaderboardRoutes);
app.use('/api', friendsRoutes);
app.use('/api', usersRoutes);
app.use('/api', commentsRoutes);
app.use('/api', notificationsRoutes);
app.use('/api', leaguesRoutes);
app.use('/api', pushRoutes);
app.use('/api', adminRoutes);

// Unmatched /api/* requests get a JSON 404 rather than falling through to the SPA shell.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Static-asset 404 — anything that LOOKS like a built asset (JS/CSS/img/font)
// must NOT fall through to the SPA shell, or the browser parses HTML as a JS
// module and throws "is not a valid JavaScript MIME type" on chunk imports.
// Triggers when a stale client requests a chunk hash that no longer exists.
// express.static above already serves these when they exist; this route only
// runs when the file is genuinely absent.
app.get(/\.(?:js|mjs|css|map|png|jpg|jpeg|gif|svg|webp|ico|woff2?|webmanifest)$/i, (req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

app.get('*', (req, res) => {
  // Tier 25 A2 — match the express.static no-cache rule for
  // index.html. Without this, the SPA-fallback served by sendFile
  // would inherit the express.sendFile defaults (no Cache-Control)
  // and browsers might aggressively cache it, trapping users on a
  // stale shell that fetches dead /assets/<old-hash>.js chunks.
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

sentry.setupExpressErrorHandler(app);

// Global error middleware (Tier 13.1). Currently a fallthrough for AppError
// thrown by services; Chunk 2 will route every handler through here.
app.use(errorMiddleware);

(async () => {
  try {
    await initDatabase();
    const server = app.listen(PORT, () => {
      logger.info({ port: PORT }, `ScoreCast server is running on http://localhost:${PORT}`);
      // Tier 4b Chunk 2 — bring up cron after the HTTP listener is healthy
      // so /healthz responds immediately even if a job is mid-tick on boot.
      scheduler.start();
    });

    // Tier 20 Chunk 7 — graceful SIGTERM drain. Azure Container Apps
    // sends SIGTERM with a 30s terminationGracePeriod before SIGKILL on
    // rolling deploys / scale-in. tini (Dockerfile entrypoint) forwards
    // the signal to the Node process. Shutdown order:
    //   1. Stop accepting new connections (server.close).
    //   2. Wait up to 25s for in-flight requests to complete (5s buffer
    //      under ACA's 30s grace).
    //   3. Stop the scheduler (kills cron ticks mid-fire — handlers are
    //      idempotent so a partial tick recovers on the new pod).
    //   4. Close the Sequelize pool.
    //   5. process.exit(0).
    // If the 25s drain times out, exit(1) so the orchestrator surfaces a
    // failed shutdown in the deploy logs rather than silently dropping
    // in-flight work.
    const SHUTDOWN_DRAIN_MS = 25_000;
    let shuttingDown = false;
    async function gracefulShutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, 'received shutdown signal — draining');
      try {
        await Promise.race([
          new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('drain timeout')), SHUTDOWN_DRAIN_MS),
          ),
        ]);
        scheduler.stop();
        await sequelize.close();
        logger.info('graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'forced shutdown after drain timeout or close error');
        process.exit(1);
      }
    }
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    logger.fatal({ err: error }, 'failed to initialize database');
    process.exit(1);
  }
})();
