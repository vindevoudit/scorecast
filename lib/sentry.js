const dsn = process.env.SENTRY_DSN;
let Sentry = null;

if (dsn) {
  try {
    Sentry = require('@sentry/node');
  } catch (_) {
    // instrument.js already warned; stay disabled
  }
}

function captureException(error, context) {
  if (!Sentry) return;
  try {
    Sentry.captureException(error, context);
  } catch (_) {
    // never let Sentry break the request path
  }
}

function setupExpressErrorHandler(app) {
  if (!Sentry || typeof Sentry.setupExpressErrorHandler !== 'function') return;
  try {
    Sentry.setupExpressErrorHandler(app);
  } catch (_) {
    // swallow — non-critical
  }
}

function isEnabled() {
  return Boolean(Sentry);
}

module.exports = { captureException, setupExpressErrorHandler, isEnabled };
