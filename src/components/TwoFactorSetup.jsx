// Tier 11 Chunk 2 — TwoFactorSetup migrated onto Button + Input.

import { useState } from 'react';
import { Button, Input } from './ui';

function downloadRecoveryCodes(codes) {
  const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bantryx-recovery-codes.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function TwoFactorSetup({ enabled, busy, onSetupRequest, onConfirm, onDisable }) {
  const [mode, setMode] = useState('idle');
  const [setupData, setSetupData] = useState(null);
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [err, setErr] = useState('');

  const reset = () => {
    setMode('idle');
    setSetupData(null);
    setCode('');
    setRecoveryCode('');
    setUseRecovery(false);
    setErr('');
  };

  const startSetup = async () => {
    setErr('');
    try {
      const data = await onSetupRequest();
      if (data) {
        setSetupData(data);
        setMode('setup');
      }
    } catch (e) {
      setErr(e.message || 'Could not start 2FA setup');
    }
  };

  const submitSetup = async (event) => {
    event.preventDefault();
    setErr('');
    try {
      const ok = await onConfirm(code);
      if (ok) reset();
    } catch (e) {
      setErr(e.message || 'Could not confirm code');
    }
  };

  const submitDisable = async (event) => {
    event.preventDefault();
    setErr('');
    const payload = useRecovery ? { recoveryCode } : { code };
    try {
      const ok = await onDisable(payload);
      if (ok) reset();
    } catch (e) {
      setErr(e.message || 'Could not disable 2FA');
    }
  };

  return (
    <div className="rounded-3xl border border-default bg-elevated/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">
            Two-factor authentication
          </h3>
          <p className="mt-1 text-sm text-fg">
            {enabled
              ? 'Enabled — codes from your authenticator are required at sign-in.'
              : 'Add an authenticator code on top of your password.'}
          </p>
        </div>
        {mode === 'idle' && !enabled ? (
          <Button onClick={startSetup} disabled={busy}>
            Enable
          </Button>
        ) : null}
        {mode === 'idle' && enabled ? (
          <Button
            variant="destructive"
            onClick={() => {
              setMode('disable');
              setErr('');
            }}
            disabled={busy}
          >
            Disable
          </Button>
        ) : null}
      </div>

      {mode === 'setup' && setupData ? (
        <form onSubmit={submitSetup} className="mt-5 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <img
              src={setupData.qrCodeDataUrl}
              alt="2FA QR code"
              className="h-40 w-40 shrink-0 rounded-2xl bg-white p-2"
            />
            <div className="min-w-0 space-y-2 text-sm text-fg">
              <p>Scan with Google Authenticator, 1Password, Authy, or any TOTP app.</p>
              <p className="break-all text-xs text-fg-muted">
                Or enter this secret manually:{' '}
                <span className="font-mono text-fg">{setupData.secret}</span>
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-warning">
              Recovery codes — shown only once
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm text-warning">
              {setupData.recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => downloadRecoveryCodes(setupData.recoveryCodes)}
              className="mt-3"
            >
              Download as .txt
            </Button>
          </div>
          <Input
            label="Enter the 6-digit code from your app to confirm"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            className="font-mono text-lg"
          />
          {err ? <p className="text-sm text-danger">{err}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.length !== 6}>
              Confirm and enable
            </Button>
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {mode === 'disable' ? (
        <form onSubmit={submitDisable} className="mt-5 space-y-4">
          {useRecovery ? (
            <Input
              label="Recovery code"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX"
              className="font-mono text-lg"
            />
          ) : (
            <Input
              label="6-digit code from your authenticator"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              className="font-mono text-lg"
            />
          )}
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
          {err ? <p className="text-sm text-danger">{err}</p> : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="destructive"
              disabled={busy || (useRecovery ? recoveryCode.length < 8 : code.length !== 6)}
            >
              Disable 2FA
            </Button>
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export default TwoFactorSetup;
