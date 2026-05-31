// Tier 11 Chunk 2 — RegisterForm migrated. ids preserved for Playwright.

import { useState } from 'react';
import { Button, Card, Input, PasswordInput } from './ui';

function RegisterForm({ authData, setAuthData, onSubmit, errors = {}, clearError }) {
  const mismatch =
    authData.registerPasswordConfirm.length > 0 &&
    authData.registerPassword !== authData.registerPasswordConfirm;
  // Tier 18 Chunk 6 — Terms acceptance checkbox. Submit is gated on it
  // being checked; the actual value is wired into AuthContext.handleRegister
  // via the `acceptedTerms` slot on authData.
  const [termsChecked, setTermsChecked] = useState(Boolean(authData.acceptedTerms));
  const onToggleTerms = (event) => {
    const next = event.target.checked;
    setTermsChecked(next);
    setAuthData((prev) => ({ ...prev, acceptedTerms: next }));
  };
  // Tier 20 Chunk 1 — 13+ age self-attestation. Same gating pattern as
  // the terms checkbox; both must be ticked before Register enables.
  const [ageChecked, setAgeChecked] = useState(Boolean(authData.confirmedAge));
  const onToggleAge = (event) => {
    const next = event.target.checked;
    setAgeChecked(next);
    setAuthData((prev) => ({ ...prev, confirmedAge: next }));
  };

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
          onChange={(event) => {
            setAuthData((prev) => ({ ...prev, registerUsername: event.target.value }));
            clearError?.('username');
          }}
          error={errors.username}
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
          onChange={(event) => {
            setAuthData((prev) => ({ ...prev, registerEmail: event.target.value }));
            clearError?.('email');
          }}
          error={errors.email}
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
        {/* Tier 30 Phase 3 A2 — Optional referral code. Server-side
            validation accepts 8 hex chars; we lift the character cap to
            16 on the input so a copy-paste with stray whitespace gets
            trimmed by the AuthContext handler rather than rejected here. */}
        <Input
          id="register-referral-code"
          name="referralCode"
          label="Referral code (optional)"
          autoComplete="off"
          maxLength={16}
          placeholder="From a friend? Enter their code."
          value={authData.registerReferralCode}
          onChange={(event) =>
            setAuthData((prev) => ({
              ...prev,
              registerReferralCode: event.target.value.toUpperCase(),
            }))
          }
          error={errors.referralCode}
        />
        <label className="flex items-start gap-3 text-sm text-fg-muted">
          <input
            id="register-confirm-age"
            name="confirmedAge"
            type="checkbox"
            checked={ageChecked}
            onChange={onToggleAge}
            required
            className="mt-1 h-4 w-4 shrink-0 rounded border-default bg-overlay/60 text-accent focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span>
            I confirm I am at least 13 years old (or the minimum age required where I live).
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-fg-muted">
          <input
            id="register-accept-terms"
            name="acceptedTerms"
            type="checkbox"
            checked={termsChecked}
            onChange={onToggleTerms}
            required
            className="mt-1 h-4 w-4 shrink-0 rounded border-default bg-overlay/60 text-accent focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span>
            I have read and agree to the{' '}
            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline hover:text-accent-soft"
            >
              Terms of Service
            </a>{' '}
            and the{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline hover:text-accent-soft"
            >
              Privacy Policy
            </a>
            .
          </span>
        </label>
        <Button
          type="submit"
          variant="secondary"
          size="lg"
          className="w-full"
          disabled={!termsChecked || !ageChecked}
        >
          Register
        </Button>
      </form>
    </Card>
  );
}

export default RegisterForm;
