require('dotenv').config();

// Keys whose values must never reach Sentry. Belt-and-braces alongside
// `sendDefaultPii: false`: even if a future code path stuffs a password into
// `Sentry.setExtra` or `setContext`, the beforeSend hook redacts it.
const SENSITIVE_KEY =
  /password|secret|token|recovery|otp|totp|cookie|set-cookie|authorization|csrf|api[-_]?key/i;

function scrub(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0,
      // Explicit even though `false` is the v10 default — documents intent so
      // a future "enable PII to debug X" flip is a visible diff. Strips
      // cookies / IP / Authorization headers / user-agent.
      sendDefaultPii: false,
      // Bound breadcrumb retention so a leaky chatty path can't fill the
      // event up with the last 5 minutes of state.
      maxBreadcrumbs: 50,
      beforeSend(event) {
        if (event.request?.data) event.request.data = scrub(event.request.data);
        if (event.request?.headers) event.request.headers = scrub(event.request.headers);
        if (event.request?.cookies) delete event.request.cookies;
        if (event.extra) event.extra = scrub(event.extra);
        if (event.contexts) event.contexts = scrub(event.contexts);
        if (Array.isArray(event.breadcrumbs)) {
          event.breadcrumbs = event.breadcrumbs.map((b) =>
            b?.data ? { ...b, data: scrub(b.data) } : b,
          );
        }
        return event;
      },
    });
  } catch (err) {
    console.warn('SENTRY_DSN set but @sentry/node unavailable; Sentry disabled:', err.message);
  }
}
