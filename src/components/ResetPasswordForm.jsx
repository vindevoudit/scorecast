function ResetPasswordForm({ authData, setAuthData, onSubmit, onCancel }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
      <h2 className="text-2xl font-semibold text-white">Choose a new password</h2>
      <p className="mt-2 text-slate-400">Enter a new password for your account. The reset link expires after 15 minutes.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <label htmlFor="reset-password" className="block text-sm font-semibold text-slate-300">New password</label>
        <input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={200}
          value={authData.resetPassword}
          onChange={(event) => setAuthData((prev) => ({ ...prev, resetPassword: event.target.value }))}
          className="w-full rounded-3xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
        />
        <p className="text-xs text-slate-500">Must be at least 8 characters.</p>
        <button className="w-full rounded-3xl bg-cyan-500 px-6 py-4 text-sm font-semibold text-slate-950 transition duration-300 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
          Set new password
        </button>
      </form>
      <button
        type="button"
        onClick={onCancel}
        className="mt-4 text-sm text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        Cancel
      </button>
    </div>
  );
}

export default ResetPasswordForm;
