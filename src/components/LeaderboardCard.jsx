// Tier 11 Chunk 2 — LeaderboardCard tokenized.
// Tier 8.6 — masked rows (entry.isMasked) suppress click-to-open-drawer and
// dim the row visually so the privacy state is legible without hiding rank.

import EmptyState from './EmptyState';
import Avatar from './Avatar';

export function LeaderboardRow({ entry, rank, isCurrentUser, onSelectUser }) {
  const baseClass = `flex w-full items-center justify-between gap-3 rounded-3xl px-4 py-4 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    isCurrentUser ? 'border border-accent/40 bg-accent/10' : 'bg-overlay/70 hover:bg-overlay'
  } ${entry.isMasked ? 'italic text-fg-muted' : ''}`;

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {rank != null ? (
          <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-fg-subtle">
            {rank}.
          </span>
        ) : null}
        <Avatar username={entry.username} displayName={entry.displayName} size={28} />
        <span
          className={`min-w-0 truncate text-sm ${isCurrentUser ? 'font-semibold text-fg' : 'text-fg'}`}
        >
          {entry.displayName || entry.username}
          {isCurrentUser ? (
            <span className="ml-2 text-xs uppercase tracking-widest text-accent">you</span>
          ) : null}
          {entry.isMasked ? (
            <span className="ml-2 text-xs uppercase tracking-widest text-fg-subtle">private</span>
          ) : null}
        </span>
      </div>
      <div className="shrink-0 text-sm font-semibold tabular-nums text-fg">{entry.points}</div>
    </>
  );

  if (onSelectUser && !entry.isMasked) {
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
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <h2 className="text-2xl font-semibold text-fg">{title}</h2>
      <p className="mt-2 text-fg-muted">
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
