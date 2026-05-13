import { useState } from 'react';

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
    <div className="mx-auto max-w-lg rounded-3xl border border-slate-800 bg-slate-900/85 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
      <h2 className="text-2xl font-semibold text-white">Two-factor authentication</h2>
      <p className="mt-2 text-slate-400">Enter the 6-digit code from your authenticator app to finish signing in.</p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {useRecovery ? (
          <label htmlFor="challenge-recovery" className="block text-sm font-semibold text-slate-300">
            Recovery code
            <input
              id="challenge-recovery"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX"
              autoComplete="one-time-code"
              className="mt-2 w-full rounded-3xl border border-slate-700 bg-slate-950/80 px-5 py-4 font-mono text-lg text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
        ) : (
          <label htmlFor="challenge-code" className="block text-sm font-semibold text-slate-300">
            6-digit code
            <input
              id="challenge-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="123456"
              autoFocus
              className="mt-2 w-full rounded-3xl border border-slate-700 bg-slate-950/80 px-5 py-4 font-mono text-2xl tracking-widest text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
        )}
        {err && <p className="text-sm text-rose-300">{err}</p>}
        <button
          type="submit"
          disabled={busy || (useRecovery ? recoveryCode.length < 8 : code.length !== 6)}
          className="w-full rounded-3xl bg-cyan-500 px-6 py-4 text-sm font-semibold text-slate-950 transition duration-300 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
        >
          Verify and sign in
        </button>
      </form>
      <div className="mt-4 flex justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={() => { setUseRecovery((v) => !v); setErr(''); }}
          className="text-cyan-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default TwoFactorChallenge;
