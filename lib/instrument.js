require('dotenv').config();

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0,
    });
  } catch (err) {
    console.warn('SENTRY_DSN set but @sentry/node unavailable; Sentry disabled:', err.message);
  }
}
