// Tier 11 Chunk 2 — NotificationBell tokenized.

import { useEffect, useRef, useState } from 'react';
import { timeAgo } from '../utils/time';
import { useRequest } from '../hooks/useRequest';
import { useNotifications } from '../hooks/useNotifications';

function NotificationBell() {
  const request = useRequest();
  const { showStatus } = useNotifications();
  const onError = (msg) => {
    if (msg && msg !== 'Session expired') showStatus(msg);
  };
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef(null);

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
    const id = setInterval(load, 30 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

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
    <div ref={containerRef} className="relative w-full md:w-auto">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
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

      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-3xl border border-default bg-elevated p-4 shadow-glow">
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
          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
            {items.length === 0 ? (
              <p className="text-xs text-fg-subtle">No notifications yet.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.read && markRead(n.id)}
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
        </div>
      ) : null}
    </div>
  );
}

export default NotificationBell;
