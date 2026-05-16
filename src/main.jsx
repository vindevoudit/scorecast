import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { installClientErrorReporter } from './lib/clientErrorReporter';
import { initSentry } from './lib/sentry';
import { applyTheme, getStoredTheme } from './lib/theme';
import { NotificationProvider } from './contexts/NotificationContext';
import { AuthProvider } from './contexts/AuthContext';
import { AuthGateProvider } from './contexts/AuthGateContext';
import { DataProvider } from './contexts/DataContext';
import './index.css';

// Apply theme SYNCHRONOUSLY before React mounts so we never flash the wrong
// palette during boot. (Tier 11 Chunk 1.)
applyTheme(getStoredTheme());

initSentry();
installClientErrorReporter();

// Tier 13 Chunk 3 — provider stack. Order matters: NotificationProvider has
// no deps; AuthProvider depends on it (showStatus on auth flow); DataProvider
// depends on AuthContext (user state) + NotificationContext + useRequest.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <NotificationProvider>
        <AuthProvider>
          <AuthGateProvider>
            <DataProvider>
              <App />
            </DataProvider>
          </AuthGateProvider>
        </AuthProvider>
      </NotificationProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
