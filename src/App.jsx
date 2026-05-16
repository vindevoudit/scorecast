import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
import { useGames } from './hooks/useGames';
import DashboardView from './views/DashboardView';
import AuthView from './views/AuthView';
import SkeletonView from './views/SkeletonView';
import SignInModal from './components/SignInModal';
import OnboardingTour from './components/OnboardingTour';

// App.jsx is the layout shell. The provider stack lives in main.jsx
// (NotificationProvider → AuthProvider → DataProvider). Three views consume
// contexts directly. App.jsx only owns the gradient background + boot/auth/
// dashboard view switch — toasts live inside NotificationProvider (Tier 11
// Chunk 2 swapped the inline status banner for a Radix toast viewport).
function App() {
  const { user, browseAsGuest, showAuth } = useAuth();
  const { bootDone, loading, view } = useData();
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

  // Tier 11 Chunk 4 — first-run onboarding tour. Mounts only when:
  //   - the user is signed in (anon visitors don't get a tour)
  //   - they haven't completed/skipped it before
  //   - they're on the Games view (the natural landing spot post-register)
  //   - games have loaded (avoid empty-state confusion)
  const showOnboarding =
    Boolean(user) &&
    !browseAsGuest &&
    user?.onboardingCompletedAt == null &&
    view === 'games' &&
    games.length > 0;

  return (
    <div className="bg-radial-glow px-safe py-safe min-h-[100dvh] bg-base text-fg">
      {/* Tier 11 Chunk 4 — skip-to-content link. Hidden until focused (first
          Tab keystroke on every page) so screen-reader and keyboard users
          can bypass the sidebar/top utility bar and jump straight into
          `<main id="main">` on DashboardView. */}
      <a
        href="#main"
        className="sr-only fixed left-4 top-4 z-[200] rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-accent-fg shadow-glow focus:not-sr-only focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Skip to main content
      </a>
      <div className="mx-auto max-w-7xl space-y-4">{body}</div>
      <SignInModal />
      {showOnboarding ? <OnboardingTour /> : null}
    </div>
  );
}

export default App;
