// Account settings: change the address on the user's account while signed
// in. PATCHes /api/me/email which bcrypt-compares currentPassword, sends a
// "your email was changed" notification to the OLD address, overwrites
// users.email, clears emailVerifiedAt, and queues a verification email to
// the new address.

import { useState } from 'react';
import { Badge, Button, Input, PasswordInput } from './ui';

function ChangeEmailPanel({ currentEmail, verified, onChangeEmail }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reset = () => {
    setEmail('');
    setCurrentPassword('');
    setErr('');
    setOpen(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    setErr('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setErr('Enter the new email address');
      return;
    }
    if (trimmed === (currentEmail || '').toLowerCase()) {
      setErr('That is already your email address');
      return;
    }
    setBusy(true);
    try {
      await onChangeEmail({ email: trimmed, currentPassword });
      reset();
    } catch (e) {
      setErr(e.message || 'Could not change email');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-default bg-elevated/70 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">Email</h3>
          <p className="mt-1 text-sm text-fg">
            {currentEmail ? (
              <>
                Current: <span className="font-medium">{currentEmail}</span>{' '}
                {verified ? (
                  <Badge tone="success">Verified</Badge>
                ) : (
                  <Badge tone="warning">Not verified</Badge>
                )}
              </>
            ) : (
              'No email on file.'
            )}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            Changing your email sends a notification to the old address and a verification link to
            the new one.
          </p>
        </div>
        {!open ? (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Change email
          </Button>
        ) : null}
      </div>

      {open ? (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Input
            id="change-email-new"
            type="email"
            label="New email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            required
          />
          <PasswordInput
            id="change-email-password"
            label="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          {err ? (
            <p className="text-sm text-danger" role="alert">
              {err}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Saving…' : 'Save email'}
            </Button>
            <Button size="sm" variant="secondary" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export default ChangeEmailPanel;
