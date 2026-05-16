// Tier 11 Chunk 2 — ForgotPasswordForm migrated.

import { Button, Card, Input } from './ui';

function ForgotPasswordForm({ authData, setAuthData, onSubmit, onCancel, sent }) {
  return (
    <Card variant="default" className="p-8 shadow-glow">
      <h2 className="text-2xl font-semibold text-fg">Reset your password</h2>
      <p className="mt-2 text-fg-muted">
        Enter the email address you registered with and we'll send you a reset link.
      </p>
      {sent ? (
        <div className="mt-6 rounded-2xl border border-accent/40 bg-overlay/60 px-5 py-4 text-sm text-accent-soft">
          If an account with that email exists, a reset link is on its way. The link expires in 15
          minutes.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <Input
            id="forgot-email"
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            required
            maxLength={254}
            value={authData.forgotEmail}
            onChange={(event) =>
              setAuthData((prev) => ({ ...prev, forgotEmail: event.target.value }))
            }
          />
          <Button type="submit" variant="primary" size="lg" className="w-full">
            Send reset link
          </Button>
        </form>
      )}
      <Button variant="link" onClick={onCancel} className="mt-4 text-sm text-fg-muted">
        Back to sign in
      </Button>
    </Card>
  );
}

export default ForgotPasswordForm;
