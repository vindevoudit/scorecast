import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
import { useGames } from './hooks/useGames';
import DashboardView from './views/DashboardView';
import AuthView from './views/AuthView';
import SkeletonView from './views/SkeletonView';
import SignInModal from './components/SignInModal';

// App.jsx is the layout shell. The provider stack lives in main.jsx
// (NotificationProvider → AuthProvider → DataProvider). Three views consume
// contexts directly. App.jsx only owns the gradient background + boot/auth/
// dashboard view switch — toasts live inside NotificationProvider (Tier 11
// Chunk 2 swapped the inline status banner for a Radix toast viewport).
function App() {
  const { user, browseAsGuest, showAuth } = useAuth();
  const { bootDone, loading } = useData();
  const { games } = useGames();

  // View precedence:
  //   1. authed → Dashboard
  //   2. anon clicking Sign in from anywhere → AuthView (showAuth wins over
  //      browseAsGuest so Back returns the visitor to anon-mode, not the
  //      Landing).
  //   3. anon guest → Dashboard (read-only)
  //   4. first-time visitor (no flags) → AuthView (Landing)
  let body;
  if (!bootDone || (loading && games.length === 0)) {
    body = <SkeletonView />;
  } else if (user) {
    body = <DashboardView />;
  } else if (showAuth) {
    body = <AuthView />;
  } else if (browseAsGuest) {
    body = <DashboardView />;
  } else {
    body = <AuthView />;
  }

  return (
    <div className="bg-radial-glow px-safe py-safe min-h-[100dvh] bg-base text-fg">
      <div className="mx-auto max-w-7xl space-y-4">{body}</div>
      <SignInModal />
    </div>
  );
}

export default App;
