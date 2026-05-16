// Tier 11 Chunk 2 — TwoFactorChallenge migrated.

import { useState } from 'react';
import { Button, Card, Input } from './ui';

function TwoFactorChallenge({ onSubmit, onCancel, busy }) {
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [err, setErr] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErr('');
    const payload = useRecovery ? { recoveryCode } : { code };
    try {
      await onSubmit(payload);
    } catch (e) {
      setErr(e.message || 'Code did not match');
    }
  };

  return (
    <Card variant="default" className="mx-auto max-w-lg p-8 shadow-glow">
      <h2 className="text-2xl font-semibold text-fg">Two-factor authentication</h2>
      <p className="mt-2 text-fg-muted">
        Enter the 6-digit code from your authenticator app to finish signing in.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {useRecovery ? (
          <Input
            id="challenge-recovery"
            label="Recovery code"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
            placeholder="XXXXX-XXXXX"
            autoComplete="one-time-code"
            className="font-mono text-lg"
          />
        ) : (
          <Input
            id="challenge-code"
            label="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            placeholder="123456"
            autoFocus
            className="font-mono text-2xl tracking-widest"
          />
        )}
        {err ? <p className="text-sm text-danger">{err}</p> : null}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          disabled={busy || (useRecovery ? recoveryCode.length < 8 : code.length !== 6)}
        >
          Verify and sign in
        </Button>
      </form>
      <div className="mt-4 flex justify-between gap-3 text-sm">
        <Button
          variant="link"
          onClick={() => {
            setUseRecovery((v) => !v);
            setErr('');
          }}
          className="text-sm"
        >
          {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
        </Button>
        <Button variant="link" onClick={onCancel} className="text-sm text-fg-muted">
          Cancel
        </Button>
      </div>
    </Card>
  );
}

export default TwoFactorChallenge;
