// Account settings: change password while signed in. Posts to /api/me/password
// which bcrypt-compares currentPassword, swaps in the new hash, then revokes
// every refresh token on the account and reissues a fresh pair for this
// session — so the user stays signed in here but every other device is
// kicked out.

import { useState } from 'react';
import { Button, PasswordInput } from './ui';

function ChangePasswordPanel({ onChangePassword }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setErr('');
    setOpen(false);
  };

  const mismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword ? 'Passwords do not match' : '';

  const submit = async (event) => {
    event.preventDefault();
    setErr('');
    if (newPassword !== confirmPassword) {
      setErr('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setErr('New password must be at least 8 characters');
      return;
    }
    setBusy(true);
    try {
      await onChangePassword({ currentPassword, newPassword });
      reset();
    } catch (e) {
      setErr(e.message || 'Could not change password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-default bg-elevated/70 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">
            Password
          </h3>
          <p className="mt-1 text-sm text-fg">
            Change your password. Other signed-in devices will be signed out.
          </p>
        </div>
        {!open ? (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Change password
          </Button>
        ) : null}
      </div>

      {open ? (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <PasswordInput
            id="change-password-current"
            label="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <PasswordInput
            id="change-password-new"
            label="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            helper="At least 8 characters."
            required
          />
          <PasswordInput
            id="change-password-confirm"
            label="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            error={mismatch}
            required
          />
          {err ? (
            <p className="text-sm text-danger" role="alert">
              {err}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Saving…' : 'Save password'}
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

export default ChangePasswordPanel;
