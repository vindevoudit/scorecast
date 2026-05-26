'use strict';

// Tier 19 Chunk 3 — Request-to-join dialog.
//
// Opens when the user clicks "Request to join" on a private group that
// has no password (or as an alternate path on one that does). The user
// can attach an optional 160-char message that the owner sees alongside
// their username in the pending-requests panel.
//
// 24h cooldown after a decline is enforced server-side; the rejection
// surfaces as a toast via DataContext.showStatus and the dialog stays
// open so the user can read the unlock time.

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from './ui/Dialog';
import { Button } from './ui';
import { useData } from '../hooks/useData';

const MESSAGE_MAX = 160;

function JoinRequestDialog({ group, onClose }) {
  const { handleRequestToJoinGroup } = useData();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!group) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await handleRequestToJoinGroup(group.id, message.trim() || null);
      setMessage('');
      onClose?.();
    } catch {
      // Cooldown / dup-request — DataContext surfaced the toast. Keep dialog
      // open so the user can read the message + try again later.
    } finally {
      setSubmitting(false);
    }
  };

  const remaining = MESSAGE_MAX - message.length;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose?.())}>
      <DialogContent>
        <DialogTitle>Request to join &ldquo;{group.name}&rdquo;</DialogTitle>
        <DialogDescription>
          The group owner will be notified and can approve or decline your request.
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label
            htmlFor="join-request-message"
            className="block text-xs uppercase tracking-[0.18em] text-fg-muted"
          >
            Message (optional)
          </label>
          <textarea
            id="join-request-message"
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, MESSAGE_MAX))}
            placeholder="Why do you want to join?"
            rows={3}
            className="w-full resize-none rounded-2xl border border-default bg-overlay/60 px-3 py-2 text-sm text-fg outline-none transition focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          />
          <p className="text-right text-[10px] tabular-nums text-fg-subtle">
            {remaining} character{remaining === 1 ? '' : 's'} left
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default JoinRequestDialog;
