// React.lazy wrapper that auto-reloads on stale-chunk errors.
//
// When a new deploy ships, the user's currently-running JS bundle still
// references chunk URLs with the OLD build's hashes. The first time they
// open a tab that triggers a `React.lazy(() => import(...))` dynamic
// import, the fetch hits a URL the server no longer has — server returns
// a 404, browser throws "Failed to fetch dynamically imported module" or
// "is not a valid JavaScript MIME type" (the latter if some intermediary
// returned HTML instead).
//
// The fix is to detect that exact failure mode and force a hard reload —
// the user re-fetches index.html, which references the NEW chunk hashes,
// and the second mount succeeds. sessionStorage guards against reload
// loops if the issue persists across the fresh boot.
import { lazy } from 'react';

const RELOAD_FLAG = 'sc:chunk-reload-attempt';

function isChunkLoadError(err) {
  const message = err?.message || '';
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('is not a valid JavaScript MIME type') ||
    message.includes('Loading chunk') ||
    message.includes('Loading CSS chunk')
  );
}

export function lazyWithReload(importer) {
  return lazy(() =>
    importer().catch((err) => {
      if (!isChunkLoadError(err)) throw err;
      try {
        if (typeof window === 'undefined') throw err;
        const previousAttempt = window.sessionStorage.getItem(RELOAD_FLAG);
        if (previousAttempt) {
          // Already reloaded once and STILL hitting the stale chunk —
          // bubble the error to ErrorBoundary so the user sees something
          // actionable rather than a reload loop.
          throw err;
        }
        window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
        window.location.reload();
        // Return an empty component while the reload fires so React doesn't
        // bubble the rejection. The page is about to be replaced anyway.
        return { default: () => null };
      } catch {
        throw err;
      }
    }),
  );
}

// Once a successful boot completes (any time after first paint with the
// current bundle), clear the reload flag so the NEXT stale deploy gets a
// fresh single-reload attempt.
export function clearChunkReloadFlag() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // ignore
  }
}
