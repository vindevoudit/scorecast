import { useEffect, useRef, useState } from 'react';
import { timeAgo } from '../utils/time';

function NotificationBell({ request, onError }) {
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        className="relative inline-flex h-12 w-12 items-center justify-center rounded-3xl bg-slate-800 text-cyan-300 transition duration-200 hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        <span aria-hidden="true" className="text-xl">
          🔔
        </span>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-3xl border border-slate-800 bg-slate-900/95 p-4 shadow-[0_30px_80px_rgba(15,23,42,0.65)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-xs text-cyan-300 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
            {items.length === 0 ? (
              <p className="text-xs text-slate-500">No notifications yet.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.read && markRead(n.id)}
                  className={`block w-full rounded-2xl px-3 py-2 text-left text-sm transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                    n.read
                      ? 'bg-slate-950/50 text-slate-500'
                      : 'bg-slate-950/80 text-slate-100 hover:bg-slate-900'
                  }`}
                >
                  <p className="font-semibold">{n.title}</p>
                  {n.body && <p className="mt-1 text-xs text-slate-400">{n.body}</p>}
                  <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
                    {timeAgo(n.createdAt)}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
