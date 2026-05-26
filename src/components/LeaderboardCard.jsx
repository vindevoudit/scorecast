// Tier 11 Chunk 2 — LeaderboardCard tokenized.
// Tier 8.6 — masked rows (entry.isMasked) suppress click-to-open-drawer and
// dim the row visually so the privacy state is legible without hiding rank.
// Tier 18 Chunk 3 — compact view that shows top-3 + viewer + friends with
// `… N more players` dividers between gaps and an [Expand] toggle. Friends
// stay unmasked because they're inside the viewer's friend set; masking
// logic in services/LeaderboardService is unchanged.

import { useMemo, useState } from 'react';
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

// Tier 18 Chunk 3 — compact mode. Returns either a flat list of full
// rows (when expanded or when compact would already show everyone) or
// an interleaved row/divider list that surfaces top-3 + self + friends
// and collapses the rest into "… N more players" markers.
function buildCompact({ entries, currentUserId, friendSet }) {
  if (entries.length === 0) return { items: [], rowCount: 0 };
  const visible = new Set();
  for (let i = 0; i < Math.min(3, entries.length); i += 1) {
    visible.add(entries[i].userId);
  }
  if (currentUserId) visible.add(currentUserId);
  for (const id of friendSet) visible.add(id);

  const items = [];
  let lastRank = 0;
  let rowCount = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const rank = i + 1;
    if (!visible.has(entry.userId)) continue;
    const gap = rank - lastRank - 1;
    if (gap > 0) {
      items.push({ type: 'divider', count: gap, key: `gap-${rank}` });
    }
    items.push({ type: 'row', entry, rank, key: entry.userId });
    rowCount += 1;
    lastRank = rank;
  }
  const trailingGap = entries.length - lastRank;
  if (trailingGap > 0) {
    items.push({ type: 'divider', count: trailingGap, key: 'gap-end' });
  }
  return { items, rowCount };
}

function GapDivider({ count }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">
      <span className="bg-default/60 h-px flex-1" aria-hidden="true" />
      <span>
        … {count} more {count === 1 ? 'player' : 'players'}
      </span>
      <span className="bg-default/60 h-px flex-1" aria-hidden="true" />
    </div>
  );
}

function LeaderboardCard({
  title,
  entries,
  currentUserId,
  description,
  onSelectUser,
  isFiltered = false,
  friendUserIds, // Iterable of user ids — passed by DashboardView from useFriends().
}) {
  const [expanded, setExpanded] = useState(false);
  const friendSet = useMemo(() => {
    if (!friendUserIds) return new Set();
    return friendUserIds instanceof Set ? friendUserIds : new Set(friendUserIds);
  }, [friendUserIds]);

  const compact = useMemo(
    () => buildCompact({ entries, currentUserId, friendSet }),
    [entries, currentUserId, friendSet],
  );

  // When the compact projection would already render every row (e.g. small
  // leaderboard, or the viewer's whole friend group sits across all ranks)
  // there's nothing to expand into — skip the toggle entirely.
  const canExpand = compact.rowCount < entries.length;
  const showExpanded = expanded || !canExpand;

  // When a filter is active and the resulting list is "everyone at 0 pts"
  // (which renders identical to truly empty), surface the scope so the
  // user understands the filter is the cause rather than missing data.
  const allZeroPoints = entries.length > 0 && entries.every((e) => (e.points || 0) === 0);
  const showFilteredEmpty = isFiltered && (entries.length === 0 || allZeroPoints);
  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-semibold text-fg">{title}</h2>
        {isFiltered ? (
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            Filtered
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-fg-muted">
        {description || 'Top performers based on correct picks and probability scoring.'}
      </p>
      <div className="mt-6 max-h-96 space-y-3 overflow-y-auto pr-2">
        {showFilteredEmpty ? (
          <EmptyState
            title="No picks in this scope yet"
            description="Try a different league/season, or clear the filter to see global rankings."
          />
        ) : entries.length === 0 ? (
          <EmptyState
            title="No leaderboard data yet"
            description="Once games have results, points will appear here."
          />
        ) : showExpanded ? (
          entries.map((entry, index) => (
            <LeaderboardRow
              key={entry.userId}
              entry={entry}
              rank={index + 1}
              isCurrentUser={entry.userId === currentUserId}
              onSelectUser={onSelectUser}
            />
          ))
        ) : (
          compact.items.map((item) =>
            item.type === 'row' ? (
              <LeaderboardRow
                key={item.key}
                entry={item.entry}
                rank={item.rank}
                isCurrentUser={item.entry.userId === currentUserId}
                onSelectUser={onSelectUser}
              />
            ) : (
              <GapDivider key={item.key} count={item.count} />
            ),
          )
        )}
      </div>
      {canExpand ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            className="rounded-full border border-default bg-elevated/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted transition duration-200 hover:border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {expanded ? 'Show fewer' : `Show all ${entries.length} players`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default LeaderboardCard;
