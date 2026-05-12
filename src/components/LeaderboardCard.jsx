import EmptyState from './EmptyState';

export function LeaderboardRow({ entry, rank, isCurrentUser }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-3xl px-4 py-4 transition duration-200 ${
        isCurrentUser
          ? 'border border-cyan-400/40 bg-cyan-500/10'
          : 'bg-slate-950/70 hover:bg-slate-900/95'
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-6 shrink-0 text-sm font-semibold text-slate-500 tabular-nums">
          {rank}.
        </span>
        <span className={`min-w-0 truncate text-sm ${isCurrentUser ? 'font-semibold text-white' : 'text-slate-300'}`}>
          {entry.username}
          {isCurrentUser && <span className="ml-2 text-xs uppercase tracking-widest text-cyan-300">you</span>}
        </span>
      </div>
      <div className="shrink-0 text-sm font-semibold text-white tabular-nums">{entry.points}</div>
    </div>
  );
}

function LeaderboardCard({ title, entries, currentUserId, description }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
      <h2 className="text-2xl font-semibold text-white">{title}</h2>
      <p className="mt-2 text-slate-400">
        {description || 'Top performers based on correct picks and probability scoring.'}
      </p>
      <div className="mt-6 max-h-96 space-y-3 overflow-y-auto pr-2">
        {entries.length === 0 ? (
          <EmptyState
            title="No leaderboard data yet"
            description="Once games have results, points will appear here."
          />
        ) : (
          entries.map((entry, index) => (
            <LeaderboardRow
              key={entry.userId}
              entry={entry}
              rank={index + 1}
              isCurrentUser={entry.userId === currentUserId}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default LeaderboardCard;
