// PWA install — early `beforeinstallprompt` capture.
//
// Chromium fires `beforeinstallprompt` as soon as the manifest validates and
// the service worker activates — often within ~500 ms of first paint. If we
// only attach a listener inside React (e.g. in useStandalone), the event has
// already fired and been dropped by the time the listener mounts.
//
// This module attaches a window-level listener at import time. main.jsx
// imports it BEFORE React renders, so the event is caught no matter how late
// React's tree hydrates. useStandalone reads the cached event on mount via
// `getCapturedInstallPrompt()` and also subscribes to `scorecast:install-ready`
// to receive late-firing events.

let capturedEvent = null;
const listeners = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Per spec we must preventDefault to suppress Chrome's mini-infobar and
    // keep the event reusable. Without this, calling .prompt() later throws.
    event.preventDefault();
    capturedEvent = event;
    // Notify any subscribers registered by React via subscribe(...) below.
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        // ignore — a single bad listener must not block the others
      }
    }
    // Also dispatch a DOM event so non-subscribing code paths can react.
    window.dispatchEvent(new CustomEvent('scorecast:install-ready'));
  });

  // The browser fires `appinstalled` when the user accepts the prompt. Drop
  // our cached event so a stale prompt can't be invoked after install.
  window.addEventListener('appinstalled', () => {
    capturedEvent = null;
  });
}

export function getCapturedInstallPrompt() {
  return capturedEvent;
}

export function consumeCapturedInstallPrompt() {
  const e = capturedEvent;
  capturedEvent = null;
  return e;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
