// Account settings: change the address on the user's account while signed
// in. PATCHes /api/me/email which bcrypt-compares currentPassword, sends a
// "your email was changed" notification to the OLD address, overwrites
// users.email, clears emailVerifiedAt, and queues a verification email to
// the new address.

import { useState } from 'react';
import { Badge, Button, Input, PasswordInput } from './ui';

// Phase 0 P0-4 — short relative-time helper for "Sent N min ago". Bands
// at min / hour / day so we don't render "Sent 12537 seconds ago".
function formatRelativeSent(timestamp) {
  if (!timestamp) return null;
  const sentMs = new Date(timestamp).getTime();
  if (!Number.isFinite(sentMs)) return null;
  const diffSec = Math.max(0, Math.floor((Date.now() - sentMs) / 1000));
  if (diffSec < 60) return 'Sent just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Sent ${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Sent ${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `Sent ${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

function ChangeEmailPanel({
  currentEmail,
  verified,
  lastVerificationSentAt,
  onChangeEmail,
  onResendVerification,
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
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
          {/* Phase 0 P0-4 — observability + recovery affordance when the
              user's email isn't verified yet. Surfaces last-sent timestamp
              + an explicit Resend button so spam-filtered initial mails
              have a visible path forward. */}
          {currentEmail && !verified && onResendVerification ? (
            <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <span className="text-xs text-fg-muted">
                {formatRelativeSent(lastVerificationSentAt) || 'Verification email pending.'}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={resending}
                onClick={async () => {
                  setResending(true);
                  try {
                    await onResendVerification();
                  } finally {
                    setResending(false);
                  }
                }}
              >
                {resending ? 'Sending…' : 'Resend'}
              </Button>
            </div>
          ) : null}
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
