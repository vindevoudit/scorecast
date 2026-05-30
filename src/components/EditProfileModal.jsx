// Tier 30 Phase 1 Chunk 1.1 — EditProfileModal. Lifts the inline
// displayName + bio edit form out of ProfileView so the profile surface
// is read-only by default. Triggered by the "Edit profile" button in
// ProfileView (own profile) and by a Settings → Account drive-by.
//
// Uses the existing Dialog primitive (Radix-backed; gives us focus trap,
// Escape, click-outside, aria-modal). Mirrors ConfirmModal's `open` +
// `onCancel` shape so consumers stay familiar.

import { useEffect, useState } from 'react';
import { Button, Input, Textarea } from './ui';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from './ui/Dialog';

function EditProfileModal({ open, profile, onSave, onCancel, busy = false }) {
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');

  // Reset local state every time the dialog re-opens. Without this, the
  // form would carry over edits the user abandoned on a previous open.
  useEffect(() => {
    if (open) {
      setDisplayName(profile?.displayName || '');
      setBio(profile?.bio || '');
    }
  }, [open, profile?.displayName, profile?.bio]);

  const submit = async (event) => {
    event.preventDefault();
    if (!onSave) return;
    await onSave({
      displayName: displayName.trim(),
      bio: bio.trim(),
    });
    // The dialog will close via the parent flipping `open` to false; we
    // don't dismiss locally so the parent can keep it open on validation
    // failure if it ever surfaces one.
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onCancel?.())}>
      <DialogContent>
        <DialogTitle>Edit profile</DialogTitle>
        <DialogDescription>
          Pick a display name and bio that other Bantryx players will see.
        </DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Input
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
            placeholder={profile?.username || ''}
          />
          <div>
            <Textarea
              label="Bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="Tell people who you are…"
            />
            <span className="mt-1 block text-right text-xs tabular-nums text-fg-subtle">
              {bio.length} / 280
            </span>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default EditProfileModal;
