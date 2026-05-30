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
