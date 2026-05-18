// Tier 11 Chunk 2 — RegisterForm migrated. ids preserved for Playwright.

import { Button, Card, Input, PasswordInput } from './ui';

function RegisterForm({ authData, setAuthData, onSubmit }) {
  const mismatch =
    authData.registerPasswordConfirm.length > 0 &&
    authData.registerPassword !== authData.registerPasswordConfirm;

  return (
    <Card variant="default" className="p-8 shadow-glow">
      <h2 className="text-2xl font-semibold text-fg">Create an account</h2>
      <p className="mt-2 text-fg-muted">Start your own pool and invite friends instantly.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <Input
          id="register-username"
          name="username"
          label="Username"
          autoComplete="username"
          value={authData.registerUsername}
          onChange={(event) =>
            setAuthData((prev) => ({ ...prev, registerUsername: event.target.value }))
          }
        />
        <Input
          id="register-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          maxLength={254}
          value={authData.registerEmail}
          onChange={(event) =>
            setAuthData((prev) => ({ ...prev, registerEmail: event.target.value }))
          }
        />
        <PasswordInput
          id="register-password"
          name="password"
          label="Password"
          autoComplete="new-password"
          value={authData.registerPassword}
          onChange={(event) =>
            setAuthData((prev) => ({ ...prev, registerPassword: event.target.value }))
          }
        />
        <PasswordInput
          id="register-password-confirm"
          name="passwordConfirm"
          label="Confirm password"
          autoComplete="new-password"
          value={authData.registerPasswordConfirm}
          onChange={(event) =>
            setAuthData((prev) => ({ ...prev, registerPasswordConfirm: event.target.value }))
          }
          error={mismatch ? 'Passwords do not match' : undefined}
        />
        <Button type="submit" variant="secondary" size="lg" className="w-full">
          Register
        </Button>
      </form>
    </Card>
  );
}

export default RegisterForm;
