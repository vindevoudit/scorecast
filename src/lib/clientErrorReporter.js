const ENDPOINT = '/api/client-errors';
const MAX_REPORTS_PER_WINDOW = 5;
const WINDOW_MS = 60 * 1000;
const MAX_STACK_LENGTH = 8192;
const MAX_MESSAGE_LENGTH = 500;

let reportCount = 0;
let windowStart = 0;
let lastReqId = null;

function withinThrottle() {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    reportCount = 0;
  }
  if (reportCount >= MAX_REPORTS_PER_WINDOW) return false;
  reportCount += 1;
  return true;
}

function clip(value, max) {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

export function setLastRequestId(reqId) {
  if (typeof reqId === 'string' && reqId.length > 0 && reqId.length <= 200) {
    lastReqId = reqId;
  }
}

function notifyUI(error) {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('scorecast:client-error', {
        detail: { message: error?.message || 'unknown' },
      }),
    );
  } catch (_) {
    // event dispatch is best-effort; ignore
  }
}

export async function reportClientError(error) {
  if (!withinThrottle()) return;
  notifyUI(error);
  try {
    const body = {
      message: clip(error?.message, MAX_MESSAGE_LENGTH) || 'unknown',
      stack: clip(error?.stack, MAX_STACK_LENGTH),
      componentStack: clip(error?.componentStack, MAX_STACK_LENGTH),
      url: clip(typeof window !== 'undefined' ? window.location.href : undefined, 500),
      reqId: clip(error?.reqId || lastReqId || undefined, 200),
      userAgent: clip(typeof navigator !== 'undefined' ? navigator.userAgent : undefined, 500),
      level: error?.level === 'warn' ? 'warn' : 'error',
    };
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch (_) {
    // never let reporting failure cascade back into the listener
  }
}

export function installClientErrorReporter() {
  if (typeof window === 'undefined') return;
  if (window.__scorecastErrorReporterInstalled) return;
  window.__scorecastErrorReporterInstalled = true;

  window.addEventListener('error', (event) => {
    reportClientError({
      message: event?.message,
      stack: event?.error?.stack,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    reportClientError({
      message:
        reason?.message || (typeof reason === 'string' ? reason : 'Unhandled promise rejection'),
      stack: reason?.stack,
    });
  });
}
