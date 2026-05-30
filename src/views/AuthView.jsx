import { useCallback, useEffect, useState } from 'react';
import LoginForm from '../components/LoginForm';
import RegisterForm from '../components/RegisterForm';
import ForgotPasswordForm from '../components/ForgotPasswordForm';
import ResetPasswordForm from '../components/ResetPasswordForm';
import Landing from '../components/Landing';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';

// Tier 13 Chunk 6 — auth panel: login / register / forgot / reset /
// 2FA challenge. AuthContext owns the JWT lifecycle; DataContext owns
// the post-login dashboard fetch — this view composes the two so the
// happy path remains "submit → user appears → games + leaderboard
// hydrate" without App.jsx mediating.

// Register error → field mapper. Server returns `{error: "That username
// is already taken"}` / `{error: "That email is already in use"}` from
// routes/auth.js:54-67; surface those inline on the offending field via
// the <Input error={...}> slot. Substring match (lowercase) so a future
// copy tweak on the server keeps working as long as the keyword stays.
function mapRegisterError(message) {
  if (!message) return {};
  const lower = message.toLowerCase();
  if (lower.includes('username is already taken')) {
    return { username: 'That username is already taken' };
  }
  if (lower.includes('email is already in use')) {
    return { email: 'That email is already in use' };
  }
  return {};
}

function AuthView() {
  const {
    authData,
    setAuthData,
    authView,
    setAuthView,
    forgotSent,
    setForgotSent,
    showAuth,
    setShowAuth,
    browseAsGuest,
    setBrowseAsGuest,
    handleLogin: authLogin,
    handleRegister: authRegister,
    handleForgotPassword,
    handleResetPassword,
  } = useAuth();
  const { loadDashboard } = useData();
  const [registerErrors, setRegisterErrors] = useState({});
  const clearRegisterError = useCallback((field) => {
    setRegisterErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  // showAuth + setShowAuth come from AuthContext now so the SignInModal can
  // flip them from outside AuthView. Default = `sc_visited === '1'` (set on
  // successful auth) so returning users skip the marketing Landing.

  // Any time we leave the landing for a forgot/reset flow (typically via
  // a `/?resetToken=…` deep-link), pin showAuth=true so that when the flow
  // finishes and authView returns to 'auth', we land on the login + register
  // grid rather than dropping the user back on the marketing page.
  useEffect(() => {
    if (authView === 'forgot' || authView === 'reset') {
      setShowAuth(true);
    }
  }, [authView, setShowAuth]);

  // Mark this browser as a "returning user" so a later logout/refresh sends
  // them straight to the auth grid instead of the marketing landing.
  const markReturning = () => {
    try {
      window.localStorage.setItem('sc_visited', '1');
    } catch {
      // localStorage can throw in private-mode browsers; ignore.
    }
  };

  // Wrap the auth flows that produce a session so the dashboard fetch
  // runs immediately after a successful login/register.
  const handleLogin = async (event) => {
    try {
      const result = await authLogin(event);
      if (result?.user) {
        markReturning();
        await loadDashboard().catch(() => {});
      }
    } catch {
      // AuthContext.handleLogin already surfaced the real message via
      // showStatus before re-throwing. Swallow here so the rejection
      // never becomes an unhandled promise → clientErrorReporter would
      // otherwise clobber the banner with the generic "Something went
      // wrong" toast (the documented Tier 5.5b race).
    }
  };

  const handleRegister = async (event) => {
    try {
      const result = await authRegister(event);
      setRegisterErrors({});
      if (result?.user) {
        markReturning();
        await loadDashboard().catch(() => {});
      }
    } catch (error) {
      // Catch the rejection so it never bubbles as an unhandled promise
      // rejection — otherwise clientErrorReporter would fire the generic
      // "Something went wrong" toast and clobber the real message. The
      // banner with the real text was already set inside
      // AuthContext.handleRegister before it re-threw.
      setRegisterErrors(mapRegisterError(error?.message));
    }
  };

  // Tier 11 Chunk 4 — every AuthView branch returns inside a `<main id="main">`
  // so the skip-to-content link in App.jsx has a valid target on every view.
  let body;
  if (authView === 'reset') {
    body = (
      <div className="mx-auto max-w-lg">
        <ResetPasswordForm
          authData={authData}
          setAuthData={setAuthData}
          onSubmit={handleResetPassword}
          onCancel={() => {
            setAuthData((prev) => ({ ...prev, resetPassword: '', resetToken: '' }));
            setAuthView('auth');
          }}
        />
      </div>
    );
  } else if (authView === 'forgot') {
    body = (
      <div className="mx-auto max-w-lg">
        <ForgotPasswordForm
          authData={authData}
          setAuthData={setAuthData}
          onSubmit={handleForgotPassword}
          sent={forgotSent}
          onCancel={() => {
            setForgotSent(false);
            setAuthData((prev) => ({ ...prev, forgotEmail: '' }));
            setAuthView('auth');
          }}
        />
      </div>
    );
  } else if (!showAuth) {
    body = (
      <Landing
        onSignIn={() => setShowAuth(true)}
        onSignUp={() => setShowAuth(true)}
        onBrowseAsGuest={() => setBrowseAsGuest(true)}
      />
    );
  } else {
    body = (
      <div className="mx-auto w-full max-w-6xl py-6">
        <button
          type="button"
          onClick={() => setShowAuth(false)}
          className="inline-flex items-center gap-2 rounded-2xl border border-default bg-elevated/60 px-4 py-2 text-sm font-semibold text-fg transition duration-200 hover:border-strong hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {browseAsGuest ? 'Back to browsing' : 'Back to home'}
        </button>
        {/* Tier 30 Phase 2 — md+ split layout. Left column carries the
            ambient stadium scene; right column stacks the auth forms.
            Below md the ambient scene is hidden entirely and the forms
            stack as before (mobile UX is unchanged). */}
        <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:items-start">
          <AuthAmbient />
          <div className="grid gap-6">
            <LoginForm
              authData={authData}
              setAuthData={setAuthData}
              onSubmit={handleLogin}
              onForgotPassword={() => {
                setForgotSent(false);
                setAuthView('forgot');
              }}
            />
            <RegisterForm
              authData={authData}
              setAuthData={setAuthData}
              onSubmit={handleRegister}
              errors={registerErrors}
              clearError={clearRegisterError}
            />
          </div>
        </div>
      </div>
    );
  }

  return <main id="main">{body}</main>;
}

// Tier 30 Phase 2 — decorative side panel for the md+ auth layout. Static
// (no motion), self-contained. Hidden below md so mobile users don't get
// half a screen of marketing chrome when they just want to sign in.
// `bg-arena-grid-bold` provides the 40px scoreboard grid; `bg-stadium-
// vignette` darkens the corners; the LIVE chip uses the new
// `animate-led-flicker` Tailwind animation (pure CSS — pauses cleanly
// under `prefers-reduced-motion`).
function AuthAmbient() {
  return (
    <aside
      aria-hidden="true"
      className="bg-arena-grid-bold bg-stadium-vignette relative hidden min-h-[480px] flex-col items-center justify-center overflow-hidden rounded-3xl border border-default p-12 text-center md:flex"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      <p className="text-xs font-light tracking-[0.5em] text-accent">PREDICT · COMPETE · CLIMB</p>
      <h2 className="text-shadow-brand-glow font-display mt-6 text-5xl leading-[0.92] tracking-[0.02em] text-accent-soft lg:text-6xl">
        Welcome back
        <br />
        to the booth.
      </h2>
      <p className="mt-8 max-w-sm text-fg-muted">
        Sign in to see your picks, live leaderboards, and what your friends are calling for this
        match-week.
      </p>
      <span className="mt-10 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-overlay/40 px-4 py-1.5 text-xs tracking-[0.3em] text-fg-muted motion-safe:animate-led-flicker">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent shadow-led" />
        LIVE
      </span>
    </aside>
  );
}

export default AuthView;
