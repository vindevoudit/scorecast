import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';

function CaretIcon({ open }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function UserMenu() {
  const { user, setConfirmingLogout } = useAuth();
  const { setView } = useData();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

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

  if (!user) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-3xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:border-slate-600 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        <Avatar username={user.username} displayName={user.displayName} size={28} />
        <span className="hidden max-w-[10rem] truncate sm:inline">{user.username}</span>
        <CaretIcon open={open} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 z-40 mt-2 w-52 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/95 p-1 shadow-[0_30px_80px_rgba(15,23,42,0.65)]"
        >
          <div className="px-3 py-2 text-xs text-slate-400">
            Signed in as
            <p className="mt-0.5 truncate text-sm font-semibold text-white">{user.username}</p>
          </div>
          <div className="my-1 h-px bg-slate-800" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setView('profile');
              setOpen(false);
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition-colors duration-150 hover:bg-slate-800/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            View profile
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirmingLogout(true);
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-cyan-300 transition-colors duration-150 hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
