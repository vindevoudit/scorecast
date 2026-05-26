// Tier 11 Chunk 2 — NotificationBell tokenized.
// Fluid UI tier — migrated to Radix Popover so the dropdown gains real
// entrance/exit motion (zoom-in + slide-down-from-top) and inherits the
// outside-click / Escape handling that was previously hand-rolled.

import { useEffect, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { timeAgo } from '../utils/time';
import { useRequest } from '../hooks/useRequest';
import { useNotifications } from '../hooks/useNotifications';
import { useData } from '../hooks/useData';
import { Popover, PopoverTrigger, PopoverContent } from './ui';

function NotificationBell() {
  const request = useRequest();
  const { showStatus } = useNotifications();
  const { navigateToDeepLink } = useData();
  const onError = (msg) => {
    if (msg && msg !== 'Session expired') showStatus(msg);
  };
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [listRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });

  const load = async () => {
    try {
      const data = await request('/api/notifications');
      setItems(data.items || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (error) {
      onError?.(error.message);
    }
  };

  useEffect(() => {
    load();
    // PWA Chunk 5 — drop the poll cadence from 30s to 5 min when a service
    // worker is active. Active SW => the user is on a build that wires Web
    // Push, so real-time notifications arrive via push instead of polling.
    // Worst case (user has SW but never subscribed): bell freshness lags by
    // up to 5 min, which is unobtrusive and saves a lot of backend load.
    const hasServiceWorker =
      typeof navigator !== 'undefined' && navigator.serviceWorker?.controller != null;
    const intervalMs = hasServiceWorker ? 5 * 60 * 1000 : 30 * 1000;
    const id = setInterval(load, intervalMs);
    // DataContext fires `scorecast:revalidate` on tab visibility + SW push.
    // Reload the bell immediately so the unread badge updates in lockstep
    // with the rest of the dashboard instead of waiting for the poll tick.
    const onRevalidate = () => load();
    window.addEventListener('scorecast:revalidate', onRevalidate);
    return () => {
      clearInterval(id);
      window.removeEventListener('scorecast:revalidate', onRevalidate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markRead = async (id) => {
    try {
      await request(`/api/notifications/${id}/read`, { method: 'POST' });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      onError?.(error.message);
    }
  };

  const markAll = async () => {
    try {
      await request('/api/notifications/read-all', { method: 'POST' });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error) {
      onError?.(error.message);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative w-full md:w-auto">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            className="relative flex h-12 w-full items-center justify-between gap-2 rounded-3xl bg-overlay px-4 text-accent transition duration-200 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:w-12 md:justify-center md:px-0"
          >
            {/* Mobile: full-width pill with "Notifications" label on the left
                and the bell emoji on the right. Desktop: icon-only square. */}
            <span className="text-sm font-semibold md:hidden">Notifications</span>
            <span aria-hidden="true" className="text-xl">
              🔔
            </span>
            {unreadCount > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-accent-fg">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="z-40 w-80 max-w-[calc(100vw-1.5rem)] rounded-3xl border border-default bg-elevated p-4 shadow-glow duration-150 ease-out-expo data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-2"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-fg">Notifications</p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={markAll}
                className="text-xs text-accent hover:text-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div ref={listRef} className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
            {items.length === 0 ? (
              <p className="text-xs text-fg-subtle">No notifications yet.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    // Mark read first so the optimistic state flips before
                    // the deep-link consumer re-renders. Both side effects
                    // are no-ops if not applicable (already read / no link).
                    if (!n.read) markRead(n.id);
                    if (n.link) {
                      navigateToDeepLink(n.link);
                      setOpen(false);
                    }
                  }}
                  className={`block w-full rounded-2xl px-3 py-2 text-left text-sm transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    n.read
                      ? 'bg-overlay/50 text-fg-subtle'
                      : 'bg-overlay/80 text-fg hover:bg-overlay'
                  }`}
                >
                  <p className="font-semibold">{n.title}</p>
                  {n.body ? <p className="mt-1 text-xs text-fg-muted">{n.body}</p> : null}
                  <p className="mt-1 text-[10px] uppercase tracking-widest text-fg-subtle">
                    {timeAgo(n.createdAt)}
                  </p>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </div>
    </Popover>
  );
}

export default NotificationBell;
