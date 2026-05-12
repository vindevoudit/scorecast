import { useEffect } from 'react';
import ProfileView from './ProfileView';

function ProfileDrawer({ open, profile, loading, onClose, onFriendAction, busy }) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="User profile"
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/80"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-800 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.65)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Profile</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-800/70 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Close
          </button>
        </div>
        {loading || !profile ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <ProfileView profile={profile} onFriendAction={onFriendAction} busy={busy} />
        )}
      </div>
    </div>
  );
}

export default ProfileDrawer;
