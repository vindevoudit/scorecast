// Tier 11 Chunk 2 — ResetPasswordForm migrated.

import { Button, Card, Input } from './ui';

function ResetPasswordForm({ authData, setAuthData, onSubmit, onCancel }) {
  return (
    <Card variant="default" className="p-8 shadow-glow">
      <h2 className="text-2xl font-semibold text-fg">Choose a new password</h2>
      <p className="mt-2 text-fg-muted">
        Enter a new password for your account. The reset link expires after 15 minutes.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <Input
          id="reset-password"
          name="password"
          type="password"
          label="New password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={200}
          helper="Must be at least 8 characters."
          value={authData.resetPassword}
          onChange={(event) =>
            setAuthData((prev) => ({ ...prev, resetPassword: event.target.value }))
          }
        />
        <Button type="submit" variant="primary" size="lg" className="w-full">
          Set new password
        </Button>
      </form>
      <Button variant="link" onClick={onCancel} className="mt-4 text-sm text-fg-muted">
        Cancel
      </Button>
    </Card>
  );
}

export default ResetPasswordForm;
