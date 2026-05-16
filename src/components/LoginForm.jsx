// Tier 11 Chunk 2 — LoginForm. Migrated onto Card + Input + Button
// primitives. The #login-username / #login-password ids are preserved
// because Playwright targets them directly.

import { Button, Card, Input } from './ui';

function LoginForm({ authData, setAuthData, onSubmit, onForgotPassword }) {
  return (
    <Card variant="default" className="p-8 shadow-glow">
      <h2 className="text-2xl font-semibold text-fg">Login</h2>
      <p className="mt-2 text-fg-muted">Sign in to continue.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
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
        <Input
          id="login-password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          value={authData.loginPassword}
          onChange={(event) =>
            setAuthData((prev) => ({ ...prev, loginPassword: event.target.value }))
          }
        />
        <Button type="submit" variant="primary" size="lg" className="w-full">
          Sign in
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
