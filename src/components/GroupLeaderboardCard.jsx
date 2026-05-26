// Tier 11 Chunk 2 — GroupLeaderboardCard tokenized.

import { LeaderboardRow } from './LeaderboardCard';
import EmptyState from './EmptyState';
import { Button } from './ui';

const SORT_OPTIONS = [
  { value: 'points', label: 'Points' },
  { value: 'winRate', label: 'Win rate' },
  { value: 'username', label: 'Name' },
];

function GroupLeaderboardCard({
  groups,
  selectedGroupId,
  onGroupSelection,
  leaderboardGroup,
  currentUserId,
  onSelectUser,
  groupMeta,
  orderBy = 'points',
  offset = 0,
  limit = 20,
  onChangeOrder,
  onChangeOffset,
  isFiltered = false,
}) {
  const total = groupMeta?.total ?? leaderboardGroup.length;
  const viewerRow = groupMeta?.viewerRow || null;
  const viewerIsOnPage = viewerRow && leaderboardGroup.some((r) => r.userId === viewerRow.userId);
  const canPrev = offset > 0;
  const canNext = offset + leaderboardGroup.length < total;
  const allZeroPoints =
    leaderboardGroup.length > 0 && leaderboardGroup.every((e) => (e.points || 0) === 0);
  const showFilteredEmpty = isFiltered && (leaderboardGroup.length === 0 || allZeroPoints);

  const selectClass =
    'w-full min-w-0 rounded-2xl border border-default bg-elevated/90 px-4 py-3 text-sm text-fg outline-none transition duration-200 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <div className="flex flex-col gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold text-fg">Group Leaderboard</h2>
            {isFiltered ? (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                Filtered
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-fg-muted">Choose a group to see the current ranking.</p>
        </div>
        {groups.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="min-w-0 flex-1 basis-40">
              <span className="sr-only">Choose group</span>
              <select value={selectedGroupId} onChange={onGroupSelection} className={selectClass}>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            {onChangeOrder ? (
              <label className="min-w-0 flex-1 basis-40">
                <span className="sr-only">Sort by</span>
                <select
                  value={orderBy}
                  onChange={(e) => onChangeOrder(e.target.value)}
                  className={selectClass}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      Sort: {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">No group membership found.</p>
        )}
      </div>

      <div className="mt-6 max-h-96 space-y-3 overflow-y-auto pr-2">
        {showFilteredEmpty ? (
          <EmptyState
            title="No picks in this scope yet"
            description="Members have no scored picks in this league/season. Try clearing the filter."
          />
        ) : leaderboardGroup.length === 0 ? (
          <EmptyState
            title="No group leaderboard data yet"
            description="Members earn points once games have results."
          />
        ) : (
          <>
            {leaderboardGroup.map((entry) => (
              <LeaderboardRow
                key={entry.userId}
                entry={entry}
                rank={entry.rank}
                isCurrentUser={entry.userId === currentUserId}
                onSelectUser={onSelectUser}
              />
            ))}
            {viewerRow && !viewerIsOnPage ? (
              <div className="border-t border-default pt-3">
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-fg-subtle">
                  Your position
                </p>
                <LeaderboardRow
                  entry={viewerRow}
                  rank={viewerRow.rank}
                  isCurrentUser
                  onSelectUser={onSelectUser}
                />
              </div>
            ) : null}
          </>
        )}
      </div>

      {canPrev || canNext ? (
        <div className="mt-4 flex items-center justify-between text-xs text-fg-muted">
          <span>
            {offset + 1}–{Math.min(offset + leaderboardGroup.length, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onChangeOffset?.(Math.max(0, offset - limit))}
              disabled={!canPrev}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onChangeOffset?.(offset + limit)}
              disabled={!canNext}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default GroupLeaderboardCard;
