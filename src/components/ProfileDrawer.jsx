// Tier 11 Chunk 2 — ProfileDrawer tokenized. Stays as a manual right-anchored
// drawer (rather than wrapping the Dialog primitive) because the layout is
// inherently a side panel; the close button is mapped to the Button primitive.
// Tier 11 Chunk 3 — On < md: the drawer slides up as a bottom sheet (full
// width, ~88dvh tall, rounded top corners); md+ keeps the right-anchored
// side panel.

import { lazy, Suspense, useEffect } from 'react';
import { useData } from '../hooks/useData';
import { Button } from './ui';

const ProfileView = lazy(() => import('./ProfileView'));

function ProfileDrawer() {
  const {
    profileUsername,
    profile,
    profileLoading,
    profileBusy,
    closeProfile,
    handleFriendAction,
  } = useData();
  const open = Boolean(profileUsername);
  const loading = profileLoading;
  const busy = profileBusy;
  const onClose = closeProfile;
  const onFriendAction = handleFriendAction;

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
      className="fixed inset-0 z-50 flex items-end justify-end bg-base/80 md:items-stretch"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="h-[88dvh] w-full overflow-y-auto rounded-t-3xl border-t border-default bg-elevated p-6 shadow-glow md:h-full md:max-w-lg md:rounded-none md:rounded-l-3xl md:border-l md:border-t-0"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.3em] text-fg-subtle">Profile</p>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        {loading || !profile ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : (
          <Suspense fallback={<p className="text-sm text-fg-muted">Loading…</p>}>
            <ProfileView profile={profile} onFriendAction={onFriendAction} busy={busy} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default ProfileDrawer;
