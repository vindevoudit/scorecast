function RegisterForm({ authData, setAuthData, onSubmit }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
      <h2 className="text-2xl font-semibold text-white">Create an account</h2>
      <p className="mt-2 text-slate-400">Start your own pool and invite friends instantly.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <label htmlFor="register-username" className="block text-sm font-semibold text-slate-300">Username</label>
        <input
          id="register-username"
          name="username"
          autoComplete="username"
          value={authData.registerUsername}
          onChange={(event) => setAuthData((prev) => ({ ...prev, registerUsername: event.target.value }))}
          className="w-full rounded-3xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
        />
        <label htmlFor="register-password" className="block text-sm font-semibold text-slate-300">Password</label>
        <input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={authData.registerPassword}
          onChange={(event) => setAuthData((prev) => ({ ...prev, registerPassword: event.target.value }))}
          className="w-full rounded-3xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
        />
        <button className="w-full rounded-3xl bg-slate-100 px-6 py-4 text-sm font-semibold text-slate-950 transition duration-300 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
          Register
        </button>
      </form>
    </div>
  );
}

export default RegisterForm;
