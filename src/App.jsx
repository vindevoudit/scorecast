import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
import { useNotifications } from './hooks/useNotifications';
import { useGames } from './hooks/useGames';
import DashboardView from './views/DashboardView';
import AuthView from './views/AuthView';
import SkeletonView from './views/SkeletonView';

// Tier 13 — App.jsx is the layout shell. The full provider stack lives in
// main.jsx (NotificationProvider → AuthProvider → DataProvider). The three
// views consume the contexts they need directly. App.jsx only owns the
// outer chrome (gradient background, title, status banner) and the
// boot/auth/dashboard view switch.
function App() {
  const { user } = useAuth();
  const { bootDone, loading } = useData();
  const { status } = useNotifications();
  const { games } = useGames();

  let body;
  if (!bootDone || (loading && (!user || games.length === 0))) {
    body = <SkeletonView />;
  } else if (user) {
    body = <DashboardView />;
  } else {
    body = <AuthView />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_48%),linear-gradient(180deg,_#020617_0%,_#050b18_100%)] px-4 py-10 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.35em] text-cyan-400/80">Bantryx</p>
              <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Join groups, make picks, and climb the leaderboards!
              </h1>
              <p className="mt-4 max-w-2xl text-slate-400 sm:text-lg">
                Pick your match winners, compete against your friends and the world, earn points for
                risky calls and underdog upsets, and see how you stack up on the live leaderboards.
                It's football prediction made social, competitive, and fun!
              </p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 px-6 py-5 text-center shadow-[0_24px_80px_rgba(15,23,42,0.4)]">
              <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Predict & Win</p>
              <p className="mt-3 text-2xl font-semibold text-white">Bantryx</p>
              <p className="mt-2 text-sm text-slate-400">
                Pick smart, earn points, dominate leaderboards.
              </p>
            </div>
          </div>

          {status && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-3xl border border-cyan-500/30 bg-slate-950/90 px-5 py-4 text-sm text-cyan-200 shadow-[0_20px_60px_rgba(6,182,212,0.12)] transition duration-300"
            >
              {status}
            </div>
          )}
        </div>

        {body}
      </div>
    </div>
  );
}

export default App;
