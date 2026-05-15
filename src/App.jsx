import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
import { useNotifications } from './hooks/useNotifications';
import { useGames } from './hooks/useGames';
import DashboardView from './views/DashboardView';
import AuthView from './views/AuthView';
import SkeletonView from './views/SkeletonView';

// App.jsx is the layout shell. The provider stack lives in main.jsx
// (NotificationProvider → AuthProvider → DataProvider). Three views consume
// contexts directly. App.jsx only owns the gradient background, the global
// status banner, and the boot/auth/dashboard view switch — the hero/title
// chrome was removed when the sidebar nav landed.
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_48%),linear-gradient(180deg,_#020617_0%,_#050b18_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-4">
        {status && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-3xl border border-cyan-500/30 bg-slate-950/90 px-5 py-4 text-sm text-cyan-200 shadow-[0_20px_60px_rgba(6,182,212,0.12)] transition duration-300"
          >
            {status}
          </div>
        )}

        {body}
      </div>
    </div>
  );
}

export default App;
