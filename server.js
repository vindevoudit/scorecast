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

const { initDatabase } = require('./models');
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
const { buildDocsRouter, mountSwagger } = require('./routes/docs');

// Tier 4b Chunk 2 — register cron jobs at module load. scheduler.start()
// is called after app.listen() so the listener is healthy before background
// work begins. Skipping these requires also dropping the start() call below.
const scheduler = require('./lib/scheduler');
const syncFixturesJob = require('./lib/jobs/syncFixtures');
const syncLiveScoresJob = require('./lib/jobs/syncLiveScores');
const FIXTURE_SYNC_CRON = process.env.FIXTURE_SYNC_CRON || '0 3 * * *'; // daily 03:00 UTC
const LIVE_SCORE_SYNC_CRON = process.env.LIVE_SCORE_SYNC_CRON || '* * * * *'; // every minute
scheduler.register('syncFixtures', FIXTURE_SYNC_CRON, syncFixturesJob.run);
scheduler.register('syncLiveScores', LIVE_SCORE_SYNC_CRON, syncLiveScoresJob.run);

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
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // Google Fonts CSS comes from fonts.googleapis.com (referenced in
  // index.html). Without this entry helmet's default styleSrc would block
  // the stylesheet and the Bebas Neue / Libre Baskerville fonts fall back
  // to system defaults.
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  imgSrc: ["'self'", 'data:'],
  connectSrc: cspConnectSrc,
  // fonts.gstatic.com hosts the actual .woff2 binaries for the Google Fonts.
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
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
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  }),
);
app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true,
  }),
);
app.use(bodyParser.json());
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

app.use(express.static(path.join(__dirname, 'dist')));

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
app.use('/api', adminRoutes);

// Unmatched /api/* requests get a JSON 404 rather than falling through to the SPA shell.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

sentry.setupExpressErrorHandler(app);

// Global error middleware (Tier 13.1). Currently a fallthrough for AppError
// thrown by services; Chunk 2 will route every handler through here.
app.use(errorMiddleware);

(async () => {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      logger.info({ port: PORT }, `ScoreCast server is running on http://localhost:${PORT}`);
      // Tier 4b Chunk 2 — bring up cron after the HTTP listener is healthy
      // so /healthz responds immediately even if a job is mid-tick on boot.
      // Tier 10.5 will move stop() into the SIGTERM graceful-shutdown path.
      scheduler.start();
    });
  } catch (error) {
    logger.fatal({ err: error }, 'failed to initialize database');
    process.exit(1);
  }
})();
