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

// Tier 30 Phase 2 — rank-primary hierarchy. The rank now leads each row
// as a 36×36 rounded-xl pill in `.font-display` (Bebas Neue) so the
// numeral itself carries the visual weight; the username drops to
// standard weight. Top-3 are colour-coded — #1 gold via `bg-warning/40`,
// #2 silver via `bg-fg-subtle/30`, #3 bronze via `bg-warning/20`. Ranks
// 4+ stay neutral on `bg-overlay`. Outside the top-3, the pill picks up
// a subtle `shadow-led` glow that visually anchors the leading edge of
// each row without competing with the rank itself.
function rankPillClass(rank) {
  if (rank === 1) return 'bg-warning/40 text-fg shadow-led';
  if (rank === 2) return 'bg-fg-subtle/30 text-fg';
  if (rank === 3) return 'bg-warning/20 text-fg';
  return 'bg-overlay text-fg-muted';
}

export function LeaderboardRow({ entry, rank, isCurrentUser, onSelectUser }) {
  const baseClass = `flex w-full items-center justify-between gap-3 rounded-3xl px-4 py-4 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    isCurrentUser ? 'border border-accent/40 bg-accent/10' : 'bg-overlay/70 hover:bg-overlay'
  } ${entry.isMasked ? 'italic text-fg-muted' : ''}`;

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {rank != null ? (
          <span
            className={`font-display inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg tabular-nums ${rankPillClass(
              rank,
            )}`}
            aria-label={`Rank ${rank}`}
          >
            {rank}
          </span>
        ) : null}
        <Avatar username={entry.username} displayName={entry.displayName} size={32} />
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
//
// Tier 33 — `total` is the server-reported true population size; defaults
// to `entries.length` when the caller doesn't paginate (Friends sub-tab).
// The trailing divider counts up to `total`, not just `entries.length`,
// so a compact card on a 200-player leaderboard with only the first 50
// loaded honestly says "… 197 more players" instead of "… 47 more".
function buildCompact({ entries, currentUserId, friendSet, total }) {
  if (entries.length === 0) return { items: [], rowCount: 0 };
  const truthTotal = typeof total === 'number' && total >= entries.length ? total : entries.length;
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
    const rank = entry.rank ?? i + 1;
    if (!visible.has(entry.userId)) continue;
    const gap = rank - lastRank - 1;
    if (gap > 0) {
      items.push({ type: 'divider', count: gap, key: `gap-${rank}` });
    }
    items.push({ type: 'row', entry, rank, key: entry.userId });
    rowCount += 1;
    lastRank = rank;
  }
  const trailingGap = truthTotal - lastRank;
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
  // Tier 33 — progressive expansion for the Overall sub-tab. When `onLoadMore`
  // is provided AND `total > entries.length`, expanded view renders a
  // "Show more" CTA that fetches the next 50 rows. Omitted by the Friends
  // sub-tab (which is a client-side filter, not a paginated server fetch).
  total,
  onLoadMore,
  onCollapse,
  loadingMore = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const friendSet = useMemo(() => {
    if (!friendUserIds) return new Set();
    return friendUserIds instanceof Set ? friendUserIds : new Set(friendUserIds);
  }, [friendUserIds]);

  const truthTotal = typeof total === 'number' ? total : entries.length;
  const hasMoreToLoad = typeof total === 'number' && entries.length < total && !!onLoadMore;
  const canCollapsePaging = typeof total === 'number' && entries.length > 50 && !!onCollapse;

  const compact = useMemo(
    () => buildCompact({ entries, currentUserId, friendSet, total: truthTotal }),
    [entries, currentUserId, friendSet, truthTotal],
  );

  // When the compact projection would already render every row (e.g. small
  // leaderboard, or the viewer's whole friend group sits across all ranks)
  // there's nothing to expand into — skip the toggle entirely.
  const canExpand = compact.rowCount < entries.length || hasMoreToLoad;
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
      {/* The fixed-height scroll box is only needed for the expanded 50-row
          list. In compact mode the list is short (top-3 + self + friends +
          dividers), so capping it clipped the trailing "… N more players"
          summary at the bottom edge — size to content instead. */}
      <div className={`mt-6 space-y-3 ${showExpanded ? 'max-h-96 overflow-y-auto pr-2' : ''}`}>
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
              rank={entry.rank ?? index + 1}
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
      {/* Tier 33 — CTAs:
         - Compact state: "Show all N players" expands the in-memory rows.
         - Expanded + has more on server: "Show more" fetches the next page;
           paired with "Show fewer" to collapse back to the default first
           page (visible whenever we've already loaded past the default 50).
         - Expanded + no more available + nothing extra loaded: "Show fewer"
           collapses the row list back to compact mode (no fetch). */}
      {canExpand && !showExpanded ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            className="rounded-full border border-default bg-elevated/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted transition duration-200 hover:border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Show all {truthTotal} {truthTotal === 1 ? 'player' : 'players'}
          </button>
        </div>
      ) : null}
      {showExpanded && (hasMoreToLoad || canCollapsePaging || compact.rowCount < entries.length) ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {compact.rowCount < entries.length || canCollapsePaging ? (
            <button
              type="button"
              onClick={async () => {
                if (canCollapsePaging) {
                  await onCollapse();
                }
                setExpanded(false);
              }}
              className="rounded-full border border-default bg-elevated/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted transition duration-200 hover:border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Show fewer
            </button>
          ) : null}
          {hasMoreToLoad ? (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              aria-busy={loadingMore}
              className="rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent transition duration-200 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {loadingMore ? 'Loading…' : `Show ${Math.min(50, truthTotal - entries.length)} more`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default LeaderboardCard;
