import { useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
import { useGames } from './hooks/useGames';
import { clearChunkReloadFlag } from './lib/lazyWithReload';
import DashboardView from './views/DashboardView';
import AuthView from './views/AuthView';
import SkeletonView from './views/SkeletonView';
import SignInModal from './components/SignInModal';
import OnboardingTour from './components/OnboardingTour';
import TermsAcceptanceModal from './components/TermsAcceptanceModal';
import Terms from './components/legal/Terms';
import Privacy from './components/legal/Privacy';
import Copyright from './components/legal/Copyright';
import CookiePolicy from './components/legal/CookiePolicy';
import Help from './components/legal/Help';
import { needsTermsAcceptance } from './lib/terms';

// Tier 18 Chunk 6 — pathname-based routing for the four legal pages.
// The SPA fallback in server.js serves index.html for any non-/api/ path,
// so /terms, /privacy, /copyright, /cookies all reach the browser as a
// normal SPA boot. We short-circuit the view switch here so anon visitors
// AND authed users see the same legal copy.
function renderLegalForPath(pathname) {
  if (typeof pathname !== 'string') return null;
  const normalized = pathname.replace(/\/+$/, '') || '/';
  switch (normalized) {
    case '/terms':
      return <Terms />;
    case '/privacy':
      return <Privacy />;
    case '/copyright':
      return <Copyright />;
    case '/cookies':
      return <CookiePolicy />;
    case '/help':
      return <Help />;
    default:
      return null;
  }
}

// App.jsx is the layout shell. The provider stack lives in main.jsx
// (NotificationProvider → AuthProvider → DataProvider). Three views consume
// contexts directly. App.jsx only owns the gradient background + boot/auth/
// dashboard view switch — toasts live inside NotificationProvider (Tier 11
// Chunk 2 swapped the inline status banner for a Radix toast viewport).
function App() {
  const { user, browseAsGuest, showAuth } = useAuth();
  const { bootDone, loading, view } = useData();
  const { games } = useGames();

  // Once the boot resolves cleanly with the current bundle, clear the
  // chunk-reload sentinel so the NEXT stale-deploy gets a fresh single
  // reload attempt. Guards against reload loops on truly broken builds.
  useEffect(() => {
    if (bootDone) clearChunkReloadFlag();
  }, [bootDone]);

  // Tier 18 Chunk 6 — legal pages take priority over every other view.
  // Anon visitors AND authed users see the same content; no auth gate,
  // no skeleton wait.
  const legalPage = renderLegalForPath(
    typeof window !== 'undefined' ? window.location.pathname : '/',
  );
  if (legalPage) return legalPage;

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

  // Tier 18 Chunk 6 — Terms acceptance gate. Mounts a blocking modal
  // whenever an authed user's recorded version is missing or older than
  // CURRENT_TERMS_VERSION. Anon + guest users never see it.
  const showTermsGate = Boolean(user) && !browseAsGuest && needsTermsAcceptance(user);

  // Tier 11 Chunk 4 — first-run onboarding tour. Mounts only when:
  //   - the user is signed in (anon visitors don't get a tour)
  //   - they haven't completed/skipped it before
  //   - they're on the Games view (the natural landing spot post-register)
  //   - games have loaded (avoid empty-state confusion)
  //   - terms gate is NOT showing (don't stack two dialogs)
  const showOnboarding =
    Boolean(user) &&
    !browseAsGuest &&
    user?.onboardingCompletedAt == null &&
    view === 'games' &&
    games.length > 0 &&
    !showTermsGate;

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
      {/* Fluid UI tier — keyed mount triggers a fade-in whenever the view
          switches (Skeleton → Dashboard on boot, Dashboard ↔ Auth on
          login/logout). motion-safe: drops the animation entirely for
          reduced-motion users. */}
      <div
        key={body.type.name || 'view'}
        className="mx-auto max-w-7xl space-y-4 motion-safe:duration-220 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0"
      >
        {body}
      </div>
      <SignInModal />
      {showTermsGate ? <TermsAcceptanceModal /> : null}
      {showOnboarding ? <OnboardingTour /> : null}
    </div>
  );
}

export default App;
