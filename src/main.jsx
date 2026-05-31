import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { installClientErrorReporter } from './lib/clientErrorReporter';
import { initSentry } from './lib/sentry';
import { applyTheme, getStoredTheme } from './lib/theme';
// PWA install — capture `beforeinstallprompt` at module-import time, before
// React mounts. Chromium fires the event soon after first paint; if we wait
// until useStandalone mounts (inside DashboardView -> InstallPrompt) the
// event has already fired and been dropped. See src/lib/installCapture.js.
import './lib/installCapture';
import { NotificationProvider } from './contexts/NotificationContext';
import { AuthProvider } from './contexts/AuthContext';
import { AuthGateProvider } from './contexts/AuthGateContext';
import { DataProvider } from './contexts/DataContext';
import { LazyMotion, domAnimation } from './lib/motion';
// Tier 30 Phase 2 follow-up — self-host Orbitron via @fontsource so the
// WOFF2 ships with our bundle instead of cross-origin from fonts.gstatic.
// User reported FOUT on first desktop load: Google Fonts CSS would parse
// after the JS bundle started, the WOFF2 download then raced React's
// first paint, and BANTRYX flashed in the fallback monospace before
// swapping to Orbitron. Bundling the latin-600/700 subsets puts the
// font request on the same critical path as the main CSS — Vite emits
// the WOFF2 as a hashed asset, browser caches it aggressively. Imported
// BEFORE ./index.css so the @font-face declarations land before any
// utility using `font-led` is parsed.
import '@fontsource/orbitron/latin-600.css';
import '@fontsource/orbitron/latin-700.css';
// Tier 30 Phase 3 A4 (share-card redesign) — the 9:16 ShareableCard uses
// weight 800 for the BANTRYX wordmark, VS glyph, and chosen-team line.
// Without this import the browser would faux-bold the 700 face inside the
// rasterised PNG, which looks distinctly NOT Orbitron.
import '@fontsource/orbitron/latin-800.css';
import './index.css';

// Apply theme SYNCHRONOUSLY before React mounts so we never flash the wrong
// palette during boot. (Tier 11 Chunk 1.)
applyTheme(getStoredTheme());

initSentry();
installClientErrorReporter();

// Tier 13 Chunk 3 — provider stack. Order matters: NotificationProvider has
// no deps; AuthProvider depends on it (showStatus on auth flow); DataProvider
// depends on AuthContext (user state) + NotificationContext + useRequest.
//
// Tier 30 Phase 2 — `<LazyMotion features={domAnimation} strict>` wraps the
// whole tree. `domAnimation` is the ~12 KB gzip bundle covering everything
// we need (variants, gestures, layoutId, AnimatePresence). `strict` makes
// `<motion.div>` (full bundle) throw at dev time so we never accidentally
// import the heavyweight namespace — every animated element must use the
// `m` alias re-exported from `src/lib/motion.js`.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LazyMotion features={domAnimation} strict>
        <NotificationProvider>
          <AuthProvider>
            <AuthGateProvider>
              <DataProvider>
                <App />
              </DataProvider>
            </AuthGateProvider>
          </AuthProvider>
        </NotificationProvider>
      </LazyMotion>
    </ErrorBoundary>
  </React.StrictMode>,
);
