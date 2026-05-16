import { useEffect } from 'react';
import LoginForm from '../components/LoginForm';
import RegisterForm from '../components/RegisterForm';
import ForgotPasswordForm from '../components/ForgotPasswordForm';
import ResetPasswordForm from '../components/ResetPasswordForm';
import TwoFactorChallenge from '../components/TwoFactorChallenge';
import Landing from '../components/Landing';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';

// Tier 13 Chunk 6 — auth panel: login / register / forgot / reset /
// 2FA challenge. AuthContext owns the JWT lifecycle; DataContext owns
// the post-login dashboard fetch — this view composes the two so the
// happy path remains "submit → user appears → games + leaderboard
// hydrate" without App.jsx mediating.
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
    handle2faVerify: auth2faVerify,
    initialAuthData,
  } = useAuth();
  const { loadDashboard } = useData();

  // showAuth + setShowAuth come from AuthContext now so the SignInModal can
  // flip them from outside AuthView. Default = `sc_visited === '1'` (set on
  // successful auth) so returning users skip the marketing Landing.

  // Any time we leave the landing for a forgot/reset/2FA flow (typically
  // via a `/?resetToken=…` deep-link), pin showAuth=true so that when the
  // flow finishes and authView returns to 'auth', we land on the login +
  // register grid rather than dropping the user back on the marketing page.
  useEffect(() => {
    if (authView === 'forgot' || authView === 'reset' || authView === 'twofa') {
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

  // Wrap the three auth flows that produce a session so the dashboard
  // fetch runs immediately after a successful login/register/2fa.
  const handleLogin = async (event) => {
    const result = await authLogin(event);
    if (result?.user) {
      markReturning();
      await loadDashboard().catch(() => {});
    }
  };

  const handleRegister = async (event) => {
    const result = await authRegister(event);
    if (result?.user) {
      markReturning();
      await loadDashboard().catch(() => {});
    }
  };

  const handle2faVerify = async (payload) => {
    const result = await auth2faVerify(payload);
    if (result?.user) {
      markReturning();
      await loadDashboard().catch(() => {});
    }
  };

  if (authView === 'twofa') {
    return (
      <TwoFactorChallenge
        onSubmit={handle2faVerify}
        onCancel={() => {
          setAuthView('auth');
          setAuthData(initialAuthData);
        }}
      />
    );
  }

  if (authView === 'reset') {
    return (
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
  }

  if (authView === 'forgot') {
    return (
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
  }

  if (!showAuth) {
    return (
      <Landing
        onSignIn={() => setShowAuth(true)}
        onSignUp={() => setShowAuth(true)}
        onBrowseAsGuest={() => setBrowseAsGuest(true)}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl py-6">
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
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <LoginForm
          authData={authData}
          setAuthData={setAuthData}
          onSubmit={handleLogin}
          onForgotPassword={() => {
            setForgotSent(false);
            setAuthView('forgot');
          }}
        />
        <RegisterForm authData={authData} setAuthData={setAuthData} onSubmit={handleRegister} />
      </div>
    </div>
  );
}

export default AuthView;
