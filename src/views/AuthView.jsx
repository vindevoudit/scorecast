import LoginForm from '../components/LoginForm';
import RegisterForm from '../components/RegisterForm';
import ForgotPasswordForm from '../components/ForgotPasswordForm';
import ResetPasswordForm from '../components/ResetPasswordForm';
import TwoFactorChallenge from '../components/TwoFactorChallenge';
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
    handleLogin: authLogin,
    handleRegister: authRegister,
    handleForgotPassword,
    handleResetPassword,
    handle2faVerify: auth2faVerify,
    initialAuthData,
  } = useAuth();
  const { loadDashboard } = useData();

  // Wrap the three auth flows that produce a session so the dashboard
  // fetch runs immediately after a successful login/register/2fa.
  const handleLogin = async (event) => {
    const result = await authLogin(event);
    if (result?.user) await loadDashboard().catch(() => {});
  };

  const handleRegister = async (event) => {
    const result = await authRegister(event);
    if (result?.user) await loadDashboard().catch(() => {});
  };

  const handle2faVerify = async (payload) => {
    const result = await auth2faVerify(payload);
    if (result?.user) await loadDashboard().catch(() => {});
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

  return (
    <div className="grid gap-6 lg:grid-cols-2">
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
  );
}

export default AuthView;
