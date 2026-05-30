'use strict';

import { useState } from 'react';
import { useData } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';

// Phase 0 T29-5 — manual data refresh.
//
// Why this exists: the installed PWA caches /api/games + /api/leagues via
// Workbox StaleWhileRevalidate (see src/sw.js). SWR paints the cached payload
// instantly while a background revalidation lands — but React state was
// already populated from the stale cache and there's no signal to re-hydrate,
// so the UI sticks until the user closes + reopens the PWA. This button is the
// user-driven escape hatch.
//
// Behavior:
//   1. authed   → DataContext.revalidate() re-fetches every user-scoped slot
//      anon    → loadAnonDashboard() refreshes the public reads
//   2. defensive postMessage({type:'SKIP_WAITING'}) so any waiting SW activates
//      immediately — covers the rare case where it actually is a stale SW
//   3. spin icon for the duration, toast on settle, debounce against re-clicks
function RefreshButton() {
  const { user, browseAsGuest } = useAuth();
  const { revalidate, loadAnonDashboard } = useData();
  const { showStatus } = useNotifications();
  const [refreshing, setRefreshing] = useState(false);

  const handleClick = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (user && !browseAsGuest) {
        await revalidate();
      } else {
        await loadAnonDashboard();
      }
      // Defensive — if a new SW is sitting in 'waiting', this wakes it up so
      // the next fetch gets fresh assets. No-op when there's no controller
      // (e.g. desktop without an installed PWA).
      if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        try {
          navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
        } catch {
          // Cross-origin / no-controller safety — ignore.
        }
      }
      showStatus('Refreshed');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={refreshing}
      aria-label="Refresh data"
      title="Refresh data"
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-default bg-elevated/80 text-fg transition-colors duration-200 hover:bg-overlay hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 md:h-10 md:w-10"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-5 w-5 ${refreshing ? 'motion-safe:animate-spin' : ''}`}
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 4v5h-5" />
      </svg>
    </button>
  );
}

export default RefreshButton;
