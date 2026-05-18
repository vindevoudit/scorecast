'use strict';

// Tier 13 Chunk 3 — AuthContext. Owns user state + the auth flow:
// register / login (with optional 2FA challenge) / logout / forgot-password
// / reset-password / 2FA setup / confirm / disable / verify. Also consumes
// verifyToken / resetToken from the URL on first mount and routes to the
// appropriate view.
//
// /api/auth/* paths are CSRF-exempt + skip the refresh-retry path, so this
// context calls apiClient directly rather than going through useRequest.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import { useNotifications } from './NotificationContext';

const initialAuthData = {
  loginUsername: '',
  loginPassword: '',
  registerUsername: '',
  registerPassword: '',
  registerPasswordConfirm: '',
  registerEmail: '',
  forgotEmail: '',
  resetPassword: '',
  resetToken: '',
  groupName: '',
  groupVisibility: 'private',
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { setStatus, showStatus } = useNotifications();
  const [user, setUser] = useState(null);
  const [authData, setAuthData] = useState(initialAuthData);
  const [authView, setAuthView] = useState('auth');
  const [forgotSent, setForgotSent] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  // Anonymous browse flag. When true, App.jsx renders DashboardView with
  // `user === null` so visitors can explore games / leaderboards / public
  // groups without an account. Set by Landing's "Browse as guest" CTA and
  // by performLogout (so logout sends users back to the anon dashboard,
  // not the auth grid). Persisted to localStorage so refreshing stays in
  // browse mode.
  const [browseAsGuest, setBrowseAsGuestState] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('sc_browse_as_guest') === '1';
    } catch {
      return false;
    }
  });
  const setBrowseAsGuest = useCallback((next) => {
    setBrowseAsGuestState(next);
    try {
      if (next) window.localStorage.setItem('sc_browse_as_guest', '1');
      else window.localStorage.removeItem('sc_browse_as_guest');
    } catch {
      // localStorage can throw in private-mode browsers; ignore.
    }
  }, []);

  // showAuth controls whether AuthView shows the Landing (false) or the
  // login + register grid (true). Promoted from AuthView's local state so
  // the SignInModal (mounted at the app root) can flip it. Initial value
  // reads `sc_visited` so returning users skip the Landing.
  const [showAuth, setShowAuth] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('sc_visited') === '1';
    } catch {
      return false;
    }
  });

  // Consume verifyToken / resetToken from the URL once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get('verifyToken');
    const resetToken = params.get('resetToken');
    if (verifyToken) {
      fetch('/api/auth/verify-email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verifyToken }),
      })
        .then((res) => {
          if (res.ok) {
            setStatus("Email verified — you're all set.");
          } else {
            setStatus('That verification link is invalid or expired.');
          }
          setTimeout(() => setStatus(''), 4000);
        })
        .catch(() => {});
      params.delete('verifyToken');
      const next = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
    }
    if (resetToken) {
      setAuthData((prev) => ({ ...prev, resetToken }));
      setAuthView('reset');
      params.delete('resetToken');
      const next = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
    }
  }, [setStatus]);

  // Imperative session reset hook for useRequest / DataContext to call when
  // a request returns 401 for an authenticated user. Returns user state to
  // null; DataContext owns clearing its own slots in response.
  const clearSession = useCallback(() => {
    setUser(null);
    showStatus('Session expired — please sign in again.');
  }, [showStatus]);

  const handleLogin = useCallback(
    async (event) => {
      event?.preventDefault?.();
      try {
        const data = await apiFetch('/api/login', {
          method: 'POST',
          body: JSON.stringify({
            username: authData.loginUsername,
            password: authData.loginPassword,
          }),
        });
        if (data?.challenge) {
          setAuthData((prev) => ({ ...prev, loginPassword: '' }));
          setAuthView('twofa');
          return { challenge: true };
        }
        setUser(data.user);
        setAuthData(initialAuthData);
        return { user: data.user };
      } catch (error) {
        showStatus(error.message);
        throw error;
      }
    },
    [authData.loginUsername, authData.loginPassword, showStatus],
  );

  const handleRegister = useCallback(
    async (event) => {
      event?.preventDefault?.();
      if (authData.registerPassword !== authData.registerPasswordConfirm) {
        const mismatchError = new Error('Passwords do not match');
        showStatus(mismatchError.message);
        throw mismatchError;
      }
      try {
        const data = await apiFetch('/api/register', {
          method: 'POST',
          body: JSON.stringify({
            username: authData.registerUsername,
            password: authData.registerPassword,
            email: authData.registerEmail,
          }),
        });
        setUser(data.user);
        setAuthData(initialAuthData);
        showStatus('Check your email for a verification link.');
        return { user: data.user };
      } catch (error) {
        showStatus(error.message);
        throw error;
      }
    },
    [
      authData.registerUsername,
      authData.registerPassword,
      authData.registerPasswordConfirm,
      authData.registerEmail,
      showStatus,
    ],
  );

  const handleForgotPassword = useCallback(
    async (event) => {
      event?.preventDefault?.();
      try {
        await apiFetch('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email: authData.forgotEmail }),
        });
        setForgotSent(true);
      } catch (error) {
        showStatus(error.message);
      }
    },
    [authData.forgotEmail, showStatus],
  );

  const handleResetPassword = useCallback(
    async (event) => {
      event?.preventDefault?.();
      try {
        await apiFetch('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token: authData.resetToken, password: authData.resetPassword }),
        });
        setAuthData((prev) => ({ ...prev, resetPassword: '', resetToken: '' }));
        setAuthView('auth');
        showStatus('Password updated. Sign in with your new password.');
      } catch (error) {
        showStatus(error.message);
      }
    },
    [authData.resetToken, authData.resetPassword, showStatus],
  );

  const handle2faVerify = useCallback(async (payload) => {
    const data = await apiFetch('/api/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setUser(data.user);
    setAuthData(initialAuthData);
    setAuthView('auth');
    return data;
  }, []);

  const handle2faSetup = useCallback(
    async (currentPassword) =>
      apiFetch('/api/me/2fa/setup', {
        method: 'POST',
        body: JSON.stringify({ currentPassword }),
      }),
    [],
  );

  const handle2faConfirm = useCallback(
    async (code) => {
      await apiFetch('/api/me/2fa/confirm', { method: 'POST', body: JSON.stringify({ code }) });
      setUser((u) => (u ? { ...u, twoFactorEnabled: true } : u));
      showStatus('Two-factor authentication enabled.');
      return true;
    },
    [showStatus],
  );

  const handle2faDisable = useCallback(
    async (payload) => {
      await apiFetch('/api/me/2fa/disable', { method: 'POST', body: JSON.stringify(payload) });
      setUser((u) => (u ? { ...u, twoFactorEnabled: false } : u));
      showStatus('Two-factor authentication disabled.');
      return true;
    },
    [showStatus],
  );

  const performLogout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (_) {
      // best-effort; still clear local state
    }
    setUser(null);
    setConfirmingLogout(false);
    // Post-logout, redirect to the marketing landing page. Both flags reset
    // so AuthView falls through to <Landing />, and `sc_visited` is cleared
    // so a refresh after logout still lands there — an explicit sign-out is
    // a fresh start, not a "returning user" experience.
    setBrowseAsGuest(false);
    setShowAuth(false);
    try {
      window.localStorage.removeItem('sc_visited');
    } catch {
      // private-mode browsers can throw on localStorage; ignore.
    }
  }, [setBrowseAsGuest]);

  const value = {
    user,
    setUser,
    authData,
    setAuthData,
    authView,
    setAuthView,
    forgotSent,
    setForgotSent,
    confirmingLogout,
    setConfirmingLogout,
    browseAsGuest,
    setBrowseAsGuest,
    showAuth,
    setShowAuth,
    clearSession,
    handleLogin,
    handleRegister,
    handleForgotPassword,
    handleResetPassword,
    handle2faVerify,
    handle2faSetup,
    handle2faConfirm,
    handle2faDisable,
    performLogout,
    initialAuthData,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
