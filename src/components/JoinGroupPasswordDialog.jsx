'use strict';

// Tier 19 Chunk 1 — Password-protected join dialog.
//
// Renders when the user clicks "Enter password" on a private group with a
// password set (surfaced by `canJoinWithPassword` in the search response).
// Submit calls handleJoinGroupWithPassword via DataContext. The server's
// constant-time bcrypt compare + groupJoinPasswordLimiter (10/min/user)
// throttles brute force; the dialog stays open on a wrong-password 403
// so the user can retry without losing their typed value. (403, not 401:
// a 401 would trip useRequest's session-expiry path and log the user out.)

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from './ui/Dialog';
import { Button, Input } from './ui';
import { useData } from '../hooks/useData';

function JoinGroupPasswordDialog({ group, onClose }) {
  const { handleJoinGroupWithPassword } = useData();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!group) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!password) return;
    setSubmitting(true);
    try {
      await handleJoinGroupWithPassword(group.id, password);
      // Success — close + reset.
      setPassword('');
      onClose?.();
    } catch {
      // Wrong password or rate-limited — DataContext already surfaced the
      // toast via showStatus; keep the dialog open so the user can retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose?.())}>
      <DialogContent>
        <DialogTitle>
          Join &ldquo;{group.name}
          {group.discriminator ? ` #${group.discriminator}` : ''}&rdquo;
        </DialogTitle>
        <DialogDescription>
          This group requires a password. Ask the group owner if you don&apos;t have it.
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <Input
            id="join-group-password"
            type="password"
            aria-label="Group password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoComplete="off"
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting || !password}>
              {submitting ? 'Joining…' : 'Join group'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default JoinGroupPasswordDialog;
