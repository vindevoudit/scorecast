import EmptyState from './EmptyState';
import Avatar from './Avatar';

export function LeaderboardRow({ entry, rank, isCurrentUser, onSelectUser }) {
  const baseClass = `flex w-full items-center justify-between gap-3 rounded-3xl px-4 py-4 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
    isCurrentUser
      ? 'border border-cyan-400/40 bg-cyan-500/10'
      : 'bg-slate-950/70 hover:bg-slate-900/95'
  }`;

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {rank != null && (
          <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-slate-500">
            {rank}.
          </span>
        )}
        <Avatar username={entry.username} displayName={entry.displayName} size={28} />
        <span
          className={`min-w-0 truncate text-sm ${isCurrentUser ? 'font-semibold text-white' : 'text-slate-300'}`}
        >
          {entry.displayName || entry.username}
          {isCurrentUser && (
            <span className="ml-2 text-xs uppercase tracking-widest text-cyan-300">you</span>
          )}
        </span>
      </div>
      <div className="shrink-0 text-sm font-semibold tabular-nums text-white">{entry.points}</div>
    </>
  );

  if (onSelectUser) {
    return (
      <button type="button" onClick={() => onSelectUser(entry.username)} className={baseClass}>
        {content}
      </button>
    );
  }

  return <div className={baseClass}>{content}</div>;
}

function LeaderboardCard({ title, entries, currentUserId, description, onSelectUser }) {
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
              onSelectUser={onSelectUser}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default LeaderboardCard;
