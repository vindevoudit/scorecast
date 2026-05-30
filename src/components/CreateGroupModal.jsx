// Tier 30 Phase 1 Chunk 1.3 — CreateGroupModal. Lifts the always-mounted
// "Create a new group" form out of DashboardView's Groups view and into
// a Radix-Dialog modal triggered by a `+ New group` button. Net effect:
// the Groups view becomes a clean list-of-things surface; creation is a
// distinct one-tap intent.
//
// State is owned locally so the modal's open/close lifecycle resets the
// form to the user's last canceled state without leaking across opens.
// The submit handler is provided by the caller (DashboardView still owns
// `handleCreateGroup` through DataContext).

import { useEffect, useState } from 'react';
import { Button, Input } from './ui';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from './ui/Dialog';

const VISIBILITY_OPTIONS = [
  {
    value: 'public',
    label: 'Public',
    description: 'Discoverable and free to join.',
  },
  {
    value: 'private',
    label: 'Private',
    description: 'Discoverable. Join by request, invitation, or password.',
  },
  {
    value: 'secret',
    label: 'Secret',
    description: 'Hidden. Invite-only.',
  },
];

function CreateGroupModal({ open, onCreate, onCancel, busy = false }) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('secret');
  const [password, setPassword] = useState('');

  // Reset form to the default state on every open so a canceled draft
  // doesn't carry over. Mirrors EditProfileModal's reset hook.
  useEffect(() => {
    if (open) {
      setName('');
      setVisibility('secret');
      setPassword('');
    }
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    if (!onCreate) return;
    const payload = { name, visibility };
    // Server schema rejects password+non-private combos — only send when
    // the user picked Private AND typed something.
    if (visibility === 'private' && password) payload.password = password;
    await onCreate(payload);
    // Parent flips `open` to false on success; we don't close locally so
    // a future validation-error path could keep the dialog open.
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onCancel?.())}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Create a new group</DialogTitle>
        <DialogDescription>
          Invite friends and compare scores in your private pool.
        </DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <Input
            id="create-group-name"
            label="Group name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Friday Football"
            autoFocus
            required
          />

          {/* Three-tier visibility radio block carried over from the old
              inline form. Each option includes the one-line tagline so
              users can pick without reading docs. */}
          <fieldset className="rounded-3xl border border-default bg-overlay/50 px-4 py-3">
            <legend className="px-2 text-xs uppercase tracking-[0.25em] text-fg-muted">
              Visibility
            </legend>
            <div className="flex flex-col gap-3 pt-2 text-sm text-fg">
              {VISIBILITY_OPTIONS.map((opt) => (
                // eslint-disable-next-line jsx-a11y/label-has-associated-control
                <label
                  key={opt.value}
                  htmlFor={`create-group-visibility-${opt.value}`}
                  className="flex items-start gap-2"
                >
                  <input
                    id={`create-group-visibility-${opt.value}`}
                    type="radio"
                    name="create-group-visibility"
                    value={opt.value}
                    checked={visibility === opt.value}
                    onChange={() => setVisibility(opt.value)}
                    className="mt-1"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{opt.label}</span>
                    <span className="text-xs text-fg-muted">{opt.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Optional password — only when user picked Private. Server min 4
              chars (enforced via zod) but the input is intentionally
              uncontrolled in length so the user sees the server's friendly
              "too short" toast rather than a client-side block. */}
          {visibility === 'private' ? (
            <div className="rounded-3xl border border-default bg-overlay/50 px-4 py-3">
              <label
                htmlFor="create-group-password"
                className="block text-xs uppercase tracking-[0.25em] text-fg-muted"
              >
                Password (optional)
              </label>
              <p className="mt-1 text-xs text-fg-muted">
                Anyone with this password can join without owner approval. Leave blank to require
                requests + invitations only.
              </p>
              <Input
                id="create-group-password"
                type="password"
                aria-label="Group password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Min 4 characters"
                autoComplete="off"
                className="mt-2"
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
              Create group
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CreateGroupModal;
