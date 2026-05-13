function ForgotPasswordForm({ authData, setAuthData, onSubmit, onCancel, sent }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
      <h2 className="text-2xl font-semibold text-white">Reset your password</h2>
      <p className="mt-2 text-slate-400">Enter the email address you registered with and we'll send you a reset link.</p>
      {sent ? (
        <div className="mt-6 rounded-2xl border border-cyan-700/40 bg-slate-950/60 px-5 py-4 text-sm text-cyan-200">
          If an account with that email exists, a reset link is on its way. The link expires in 15 minutes.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <label htmlFor="forgot-email" className="block text-sm font-semibold text-slate-300">Email</label>
          <input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={authData.forgotEmail}
            onChange={(event) => setAuthData((prev) => ({ ...prev, forgotEmail: event.target.value }))}
            className="w-full rounded-3xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
          />
          <button className="w-full rounded-3xl bg-cyan-500 px-6 py-4 text-sm font-semibold text-slate-950 transition duration-300 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
            Send reset link
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="mt-4 text-sm text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        Back to sign in
      </button>
    </div>
  );
}

export default ForgotPasswordForm;
