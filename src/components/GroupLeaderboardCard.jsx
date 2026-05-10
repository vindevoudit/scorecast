function GroupLeaderboardCard({ groups, selectedGroupId, onGroupSelection, leaderboardGroup }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">Group Leaderboard</h2>
          <p className="mt-2 text-slate-400">Choose a group to see the current ranking.</p>
        </div>
        {groups.length > 0 ? (
          <select
            value={selectedGroupId}
            onChange={onGroupSelection}
            className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-white outline-none transition duration-200 focus:border-cyan-400 sm:w-auto"
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-slate-500">No group membership found.</p>
        )}
      </div>
      <div className="mt-6 space-y-3">
        {leaderboardGroup.length === 0 ? (
          <p className="rounded-3xl bg-slate-950/70 px-4 py-5 text-sm text-slate-400">No group leaderboard data yet.</p>
        ) : (
          leaderboardGroup.map((entry, index) => (
            <div key={entry.userId} className="flex items-center justify-between rounded-3xl bg-slate-950/70 px-4 py-4 transition duration-300 hover:bg-slate-900/95">
              <div className="text-sm text-slate-300">{index + 1}. {entry.username}</div>
              <div className="text-sm font-semibold text-white">{entry.points}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default GroupLeaderboardCard;