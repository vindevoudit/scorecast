// Tier 11 Chunk 2 — ProfileDrawer tokenized. Sheet from bottom on mobile,
// from right on desktop.
// Fluid UI tier — migrated to Radix Dialog (via low-level primitives so we
// can override the centered-by-default positioning into a sheet layout).
// Gains slide entrance/exit, focus trap, and return-focus-on-close for free.

import { Suspense } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useData } from '../hooks/useData';
import { lazyWithReload } from '../lib/lazyWithReload';
import { Button, Dialog } from './ui';

const ProfileView = lazyWithReload(() => import('./ProfileView'));

function ProfileDrawer() {
  const {
    profileUsername,
    profile,
    profileLoading,
    profileBusy,
    profileError,
    closeProfile,
    handleFriendAction,
  } = useData();
  const open = Boolean(profileUsername);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeProfile();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-base/80 duration-220 ease-out-expo data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-label="User profile"
          className="fixed inset-x-0 bottom-0 z-50 h-[88dvh] w-full overflow-y-auto rounded-t-3xl border-t border-default bg-elevated p-6 shadow-glow duration-220 ease-out-expo focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom md:inset-y-0 md:bottom-auto md:left-auto md:right-0 md:top-0 md:h-full md:w-full md:max-w-lg md:rounded-l-3xl md:rounded-t-none md:border-l md:border-t-0 md:data-[state=closed]:slide-out-to-right md:data-[state=open]:slide-in-from-right"
          style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        >
          <DialogPrimitive.Title className="sr-only">User profile</DialogPrimitive.Title>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.3em] text-fg-subtle">Profile</p>
            <Button size="sm" variant="secondary" onClick={closeProfile}>
              Close
            </Button>
          </div>
          {profileLoading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : profileError ? (
            // Tier 8.6 — same shape for "private" and "friends-only-not-friend"
            // so the friend graph isn't probeable through the UI.
            <div className="space-y-2 rounded-3xl border border-default bg-overlay/70 p-5">
              <h2 className="text-lg font-semibold text-fg">This profile is unavailable</h2>
              <p className="text-sm text-fg-muted">
                {profileUsername
                  ? `@${profileUsername} keeps their profile private or restricted to friends.`
                  : 'This profile is private or restricted to friends.'}
              </p>
            </div>
          ) : !profile ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : (
            <Suspense fallback={<p className="text-sm text-fg-muted">Loading…</p>}>
              <ProfileView
                profile={profile}
                onFriendAction={handleFriendAction}
                busy={profileBusy}
              />
            </Suspense>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}

export default ProfileDrawer;
