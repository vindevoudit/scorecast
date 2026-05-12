import BadgeWall from './BadgeWall';

function formatDate(value) {
  return new Date(value).toLocaleString([], { dateStyle: 'medium' });
}

function recentPickStatus(pick) {
  if (!pick.result) return { label: 'Pending', cls: 'bg-slate-700/60 text-slate-200' };
  if (pick.choice === pick.result) {
    return { label: `Won +${pick.points}`, cls: 'bg-emerald-500/15 text-emerald-300' };
  }
  return { label: 'Missed', cls: 'bg-rose-500/15 text-rose-300' };
}

function friendButtonProps(friendStatus) {
  switch (friendStatus) {
    case 'none': return { label: 'Add friend', action: 'request' };
    case 'pending-out': return { label: 'Cancel request', action: 'cancel' };
    case 'pending-in': return { label: 'Accept request', action: 'accept' };
    case 'friends': return { label: 'Unfriend', action: 'unfriend' };
    default: return null;
  }
}

function ProfileView({ profile, onFriendAction, busy }) {
  if (!profile) return null;

  const winRatePct = Math.round((profile.winRate || 0) * 100);
  const friendBtn = friendButtonProps(profile.friendStatus);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-400/80">Profile</p>
          <h2 className="mt-2 truncate text-3xl font-semibold text-white">{profile.username}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {profile.role === 'admin' && (
              <span className="mr-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">Admin</span>
            )}
            Joined {formatDate(profile.joinedAt)}
          </p>
        </div>
        {friendBtn && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onFriendAction?.(friendBtn.action)}
            className="shrink-0 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition duration-200 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {friendBtn.label}
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-3xl bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Total points</p>
          <p className="mt-2 text-2xl font-semibold text-white tabular-nums">{profile.totalPoints}</p>
        </div>
        <div className="rounded-3xl bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Picks made</p>
          <p className="mt-2 text-2xl font-semibold text-white tabular-nums">{profile.picksMade}</p>
        </div>
        <div className="rounded-3xl bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Picks won</p>
          <p className="mt-2 text-2xl font-semibold text-white tabular-nums">{profile.picksWon}</p>
        </div>
        <div className="rounded-3xl bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Win rate</p>
          <p className="mt-2 text-2xl font-semibold text-white tabular-nums">{winRatePct}%</p>
        </div>
      </div>

      {profile.headToHead && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Head-to-head</p>
          <p className="mt-2 text-sm text-slate-200">
            You {profile.headToHead.viewerWins} — {profile.headToHead.targetWins} {profile.username}
            {profile.headToHead.ties > 0 && ` (${profile.headToHead.ties} tie${profile.headToHead.ties === 1 ? '' : 's'})`}
          </p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">Badges</h3>
        <div className="mt-3">
          <BadgeWall catalog={profile.catalog} earned={profile.badges} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">Recent picks</h3>
        <div className="mt-3 space-y-2">
          {profile.recentPicks.length === 0 ? (
            <p className="text-sm text-slate-500">No picks yet.</p>
          ) : (
            profile.recentPicks.map((pick) => {
              const status = recentPickStatus(pick);
              const team = pick.choice === 'home' ? pick.homeTeam : pick.awayTeam;
              return (
                <div key={pick.gameId} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-950/70 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-200">
                      {pick.homeTeam} <span className="text-slate-500">vs</span> {pick.awayTeam}
                    </p>
                    <p className="text-xs text-slate-500">Picked {team} · {formatDate(pick.date)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${status.cls}`}>
                    {status.label}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default ProfileView;
