import { useState } from 'react';

function downloadRecoveryCodes(codes) {
  const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scorecast-recovery-codes.txt';
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
    <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">Two-factor authentication</h3>
          <p className="mt-1 text-sm text-slate-300">
            {enabled ? 'Enabled — codes from your authenticator are required at sign-in.' : 'Add an authenticator code on top of your password.'}
          </p>
        </div>
        {mode === 'idle' && !enabled && (
          <button
            type="button"
            onClick={startSetup}
            disabled={busy}
            className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
          >
            Enable
          </button>
        )}
        {mode === 'idle' && enabled && (
          <button
            type="button"
            onClick={() => { setMode('disable'); setErr(''); }}
            disabled={busy}
            className="rounded-2xl border border-rose-700/50 bg-slate-900 px-4 py-2 text-sm font-semibold text-rose-200 hover:border-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
          >
            Disable
          </button>
        )}
      </div>

      {mode === 'setup' && setupData && (
        <form onSubmit={submitSetup} className="mt-5 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <img
              src={setupData.qrCodeDataUrl}
              alt="2FA QR code"
              className="h-40 w-40 shrink-0 rounded-2xl bg-white p-2"
            />
            <div className="min-w-0 space-y-2 text-sm text-slate-300">
              <p>Scan with Google Authenticator, 1Password, Authy, or any TOTP app.</p>
              <p className="break-all text-xs text-slate-400">
                Or enter this secret manually: <span className="font-mono text-slate-200">{setupData.secret}</span>
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-amber-300">Recovery codes — shown only once</p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm text-amber-100">
              {setupData.recoveryCodes.map((c) => (<li key={c}>{c}</li>))}
            </ul>
            <button
              type="button"
              onClick={() => downloadRecoveryCodes(setupData.recoveryCodes)}
              className="mt-3 rounded-xl border border-amber-500/40 px-3 py-1 text-xs font-semibold text-amber-200 hover:border-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              Download as .txt
            </button>
          </div>
          <label className="block text-xs uppercase tracking-[0.25em] text-slate-400">
            Enter the 6-digit code from your app to confirm
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 font-mono text-lg text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
          {err && <p className="text-sm text-rose-300">{err}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
            >
              Confirm and enable
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-2xl border border-slate-600 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === 'disable' && (
        <form onSubmit={submitDisable} className="mt-5 space-y-4">
          {useRecovery ? (
            <label className="block text-xs uppercase tracking-[0.25em] text-slate-400">
              Recovery code
              <input
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                placeholder="XXXXX-XXXXX"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 font-mono text-lg text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
              />
            </label>
          ) : (
            <label className="block text-xs uppercase tracking-[0.25em] text-slate-400">
              6-digit code from your authenticator
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 font-mono text-lg text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => { setUseRecovery((v) => !v); setErr(''); }}
            className="text-sm text-cyan-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
          </button>
          {err && <p className="text-sm text-rose-300">{err}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || (useRecovery ? recoveryCode.length < 8 : code.length !== 6)}
              className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-50"
            >
              Disable 2FA
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-2xl border border-slate-600 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default TwoFactorSetup;
