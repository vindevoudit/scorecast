import { LeaderboardRow } from './LeaderboardCard';
import EmptyState from './EmptyState';

function GroupLeaderboardCard({ groups, selectedGroupId, onGroupSelection, leaderboardGroup, currentUserId, onSelectUser }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">Group Leaderboard</h2>
          <p className="mt-2 text-slate-400">Choose a group to see the current ranking.</p>
        </div>
        {groups.length > 0 ? (
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
          leaderboardGroup.map((entry, index) => (
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

export default GroupLeaderboardCard;
