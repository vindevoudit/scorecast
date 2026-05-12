let SentryReact = null;

export async function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  try {
    SentryReact = await import('@sentry/react');
    SentryReact.init({
      dsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0,
    });
  } catch (_) {
    // VITE_SENTRY_DSN set but package unavailable; stay disabled
    SentryReact = null;
  }
}

export function captureException(error, context) {
  if (!SentryReact) return;
  try {
    SentryReact.captureException(error, context);
  } catch (_) {
    // never let Sentry break the app
  }
}

export function isEnabled() {
  return Boolean(SentryReact);
}
