export function SkeletonGameCard() {
  return (
    <div
      aria-hidden="true"
      className="animate-pulse rounded-3xl border border-slate-800 bg-slate-900/60 p-5"
    >
      <div className="h-3 w-32 rounded-full bg-slate-800/80" />
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="h-24 rounded-3xl bg-slate-950/70" />
        <div className="h-24 rounded-3xl bg-slate-950/70" />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="h-11 rounded-3xl bg-slate-800/70" />
        <div className="h-11 rounded-3xl bg-slate-800/70" />
      </div>
    </div>
  );
}

export function SkeletonLeaderboardRow() {
  return (
    <div
      aria-hidden="true"
      className="flex animate-pulse items-center justify-between rounded-3xl bg-slate-950/70 px-4 py-4"
    >
      <div className="h-3 w-32 rounded-full bg-slate-800/80" />
      <div className="h-3 w-10 rounded-full bg-slate-800/80" />
    </div>
  );
}
