function LoginForm({ authData, setAuthData, onSubmit, onForgotPassword }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
      <h2 className="text-2xl font-semibold text-white">Login</h2>
      <p className="mt-2 text-slate-400">Sign in to continue.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <label htmlFor="login-username" className="block text-sm font-semibold text-slate-300">
          Username
        </label>
        <input
          id="login-username"
          name="username"
          autoComplete="username"
          value={authData.loginUsername}
          onChange={(event) =>
            setAuthData((prev) => ({ ...prev, loginUsername: event.target.value }))
          }
          className="w-full rounded-3xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
        />
        <label htmlFor="login-password" className="block text-sm font-semibold text-slate-300">
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={authData.loginPassword}
          onChange={(event) =>
            setAuthData((prev) => ({ ...prev, loginPassword: event.target.value }))
          }
          className="w-full rounded-3xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
        />
        <button className="w-full rounded-3xl bg-cyan-500 px-6 py-4 text-sm font-semibold text-slate-950 transition duration-300 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
          Sign in
        </button>
      </form>
      {onForgotPassword ? (
        <button
          type="button"
          onClick={onForgotPassword}
          className="mt-4 text-sm text-cyan-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          Forgot password?
        </button>
      ) : null}
    </div>
  );
}

export default LoginForm;
