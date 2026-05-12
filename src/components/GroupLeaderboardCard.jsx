import { LeaderboardRow } from './LeaderboardCard';
import EmptyState from './EmptyState';

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
}) {
  const total = groupMeta?.total ?? leaderboardGroup.length;
  const viewerRow = groupMeta?.viewerRow || null;
  const viewerIsOnPage = viewerRow && leaderboardGroup.some((r) => r.userId === viewerRow.userId);
  const canPrev = offset > 0;
  const canNext = offset + leaderboardGroup.length < total;

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">Group Leaderboard</h2>
          <p className="mt-2 text-slate-400">Choose a group to see the current ranking.</p>
        </div>
        {groups.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="sm:w-auto">
              <span className="sr-only">Choose group</span>
              <select
                value={selectedGroupId}
                onChange={onGroupSelection}
                className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400 sm:w-auto"
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
            {onChangeOrder && (
              <label className="sm:w-auto">
                <span className="sr-only">Sort by</span>
                <select
                  value={orderBy}
                  onChange={(e) => onChangeOrder(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400 sm:w-auto"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>Sort: {opt.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No group membership found.</p>
        )}
      </div>

      <div className="mt-6 max-h-96 space-y-3 overflow-y-auto pr-2">
        {leaderboardGroup.length === 0 ? (
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
            {viewerRow && !viewerIsOnPage && (
              <div className="border-t border-slate-800 pt-3">
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-slate-500">Your position</p>
                <LeaderboardRow
                  entry={viewerRow}
                  rank={viewerRow.rank}
                  isCurrentUser
                  onSelectUser={onSelectUser}
                />
              </div>
            )}
          </>
        )}
      </div>

      {(canPrev || canNext) && (
        <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
          <span>{offset + 1}–{Math.min(offset + leaderboardGroup.length, total)} of {total}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onChangeOffset?.(Math.max(0, offset - limit))}
              disabled={!canPrev}
              className="rounded-2xl border border-slate-600 bg-slate-900/90 px-3 py-1 font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => onChangeOffset?.(offset + limit)}
              disabled={!canNext}
              className="rounded-2xl border border-slate-600 bg-slate-900/90 px-3 py-1 font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default GroupLeaderboardCard;
