// Tier 11 Chunk 2 — LoginForm. Migrated onto Card + Input + Button
// primitives. The #login-username / #login-password ids are preserved
// because Playwright targets them directly.

import { useState } from 'react';
import { Button, Card, Input, PasswordInput } from './ui';

function LoginForm({ authData, setAuthData, onSubmit, onForgotPassword }) {
  // P1-14 — local submitting flag prevents double-submit on a slow
  // network. The parent's onSubmit (AuthView.handleLogin) is async and
  // resolves only after the dashboard fetch lands; wrapping it here
  // gives us a single source of truth for the disabled state without
  // touching the parent or the AuthContext flow.
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async (event) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(event);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card variant="default" className="p-8 shadow-glow">
      <h2 className="text-2xl font-semibold text-fg">Login</h2>
      <p className="mt-2 text-fg-muted">Sign in to continue.</p>
      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <Input
          id="login-username"
          name="username"
          label="Username"
          autoComplete="username"
          value={authData.loginUsername}
          onChange={(event) =>
            setAuthData((prev) => ({ ...prev, loginUsername: event.target.value }))
          }
        />
        <PasswordInput
          id="login-password"
          name="password"
          label="Password"
          autoComplete="current-password"
          value={authData.loginPassword}
          onChange={(event) =>
            setAuthData((prev) => ({ ...prev, loginPassword: event.target.value }))
          }
        />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      {onForgotPassword ? (
        <Button variant="link" onClick={onForgotPassword} className="mt-4 text-sm">
          Forgot password?
        </Button>
      ) : null}
    </Card>
  );
}

export default LoginForm;
