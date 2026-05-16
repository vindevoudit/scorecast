import { useAuth } from '../hooks/useAuth';

// InlineGatePanel — replaces an entire composer / form surface (e.g., the
// comment textarea, the "Create a new group" form) for anonymous visitors
// with a small "Sign in to {label}" card and two CTAs. Used where modal
// gating would feel jarring because the surface is large + always visible.
function InlineGatePanel({ label, description }) {
  const { setShowAuth } = useAuth();

  const goToAuth = () => {
    setShowAuth(true);
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6 text-center">
      <h3 className="text-base font-semibold text-white">Sign in to {label}</h3>
      <p className="mt-2 text-sm text-slate-400">
        {description || 'Create a free account or sign in to take part.'}
      </p>
      <div className="mt-5 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={goToAuth}
          className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition duration-200 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          Create account
        </button>
        <button
          type="button"
          onClick={goToAuth}
          className="rounded-2xl border border-slate-700 bg-slate-900/80 px-5 py-3 text-sm font-semibold text-cyan-300 transition duration-200 hover:border-slate-500 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}

export default InlineGatePanel;
