import { useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAuthGate } from '../hooks/useAuthGate';

// SignInModal — opens when an anonymous visitor clicks an action-gated
// button. Body: "Sign in to {label}" + two CTAs that exit browse mode and
// land the user on the auth grid. Mounted at the app root so the dialog
// sits above every view. Reuses the focus-trap + Escape pattern from
// ConfirmModal.
function SignInModal() {
  const { gateState, closeGate } = useAuthGate();
  const { setShowAuth } = useAuth();
  const primaryRef = useRef(null);

  useEffect(() => {
    if (!gateState.open) return undefined;
    primaryRef.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape') closeGate();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [gateState.open, closeGate]);

  if (!gateState.open) return null;

  // Both CTAs do the same thing: show the auth grid. browseAsGuest is left
  // alone so a Back from the auth grid returns the visitor to the anon
  // dashboard they were just browsing.
  const goToAuth = () => {
    closeGate();
    setShowAuth(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-in-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
      onClick={closeGate}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.65)]"
      >
        <h2 id="sign-in-modal-title" className="text-xl font-semibold text-white">
          Sign in to {gateState.label}
        </h2>
        <p className="mt-3 text-sm text-slate-400">
          Track your picks, earn points for risky calls, and climb the live leaderboards.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={closeGate}
            className="rounded-2xl border border-slate-600 bg-slate-900/90 px-5 py-3 text-sm font-semibold text-slate-200 transition duration-200 hover:border-slate-500 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={goToAuth}
            className="rounded-2xl border border-slate-600 bg-slate-900/90 px-5 py-3 text-sm font-semibold text-cyan-300 transition duration-200 hover:border-slate-500 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Sign in
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={goToAuth}
            className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition duration-200 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Create account
          </button>
        </div>
      </div>
    </div>
  );
}

export default SignInModal;
