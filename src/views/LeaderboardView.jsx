// Tier 30 Phase 1 Chunk 1.3 — LeaderboardView. Lifts the Leaderboard
// surface out of DashboardView's inline 2-column block and into a
// dedicated view with three sub-tabs:
//
//   Overall → the existing global leaderboard (top-3 + self + friends
//             compact view; expandable)
//   Groups  → the existing GroupLeaderboardCard with its group picker
//   Friends → a friends-only filter of the overall rows (client-side;
//             reuses `leaderboard.overall` so no extra server hit)
//
// LeaderboardFiltersBar sits ABOVE the SubTabs since league/season scope
// applies to all three modes consistently.

import { useMemo } from 'react';
import LeaderboardCard from '../components/LeaderboardCard';
import GroupLeaderboardCard from '../components/GroupLeaderboardCard';
import LeaderboardFiltersBar from '../components/LeaderboardFiltersBar';
import EmptyState from '../components/EmptyState';
import SubTabs from '../components/SubTabs';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';

function FriendsLeaderboardSection({
  entries,
  currentUserId,
  friendUserIds,
  isFiltered,
  onSelectUser,
}) {
  // Friends-only projection: keep entries where userId is in the friend
  // set OR matches the current user. Rank survives from the source
  // ordering by re-numbering through the filter (so a friend at rank
  // 117 still renders as rank 117 if expanded? No — we deliberately
  // re-rank to give "rank among friends" since this is the friends
  // view, not a slice of global standings). Spec choice: re-rank.
  const friendsRows = useMemo(() => {
    if (!entries || entries.length === 0) return [];
    const idSet = new Set(friendUserIds || []);
    if (currentUserId) idSet.add(currentUserId);
    return entries.filter((e) => idSet.has(e.userId));
  }, [entries, friendUserIds, currentUserId]);

  if (friendsRows.length === 0) {
    return (
      <EmptyState
        title="No friends on the leaderboard yet"
        description={
          friendUserIds && friendUserIds.length > 0
            ? "Your friends haven't picked any games in this scope yet."
            : 'Add friends from the Friends tab to see how you stack up against them.'
        }
      />
    );
  }

  return (
    <LeaderboardCard
      title="Friends"
      description="Where you and your accepted friends stand. Re-ranked locally to focus the comparison."
      entries={friendsRows}
      currentUserId={currentUserId}
      onSelectUser={onSelectUser}
      isFiltered={isFiltered}
    />
  );
}

function LeaderboardView() {
  const { user } = useAuth();
  const {
    groups,
    friends,
    leaderboard,
    groupOrderBy,
    groupOffset,
    groupLimit,
    selectedGroupId,
    openProfile,
    handleChangeGroupOrder,
    handleChangeGroupOffset,
    handleGroupSelection,
    leaderboardFilters,
    loadMoreLeaderboard,
    collapseLeaderboard,
    leaderboardLoadingMore,
  } = useData();
  const isFiltered = Boolean(leaderboardFilters.leagueId || leaderboardFilters.seasonId);
  const friendUserIds = (friends?.friends || []).map((f) => f.id);

  const tabs = [
    {
      value: 'overall',
      label: 'Overall',
      content: (
        <LeaderboardCard
          title="Overall Leaderboard"
          entries={leaderboard.overall}
          currentUserId={user?.id}
          onSelectUser={openProfile}
          isFiltered={isFiltered}
          friendUserIds={friendUserIds}
          total={leaderboard.overallMeta?.total}
          onLoadMore={loadMoreLeaderboard}
          onCollapse={collapseLeaderboard}
          loadingMore={leaderboardLoadingMore}
        />
      ),
    },
    {
      value: 'groups',
      label: 'Groups',
      content: (
        <GroupLeaderboardCard
          groups={groups}
          selectedGroupId={selectedGroupId}
          onGroupSelection={handleGroupSelection}
          leaderboardGroup={leaderboard.group}
          currentUserId={user?.id}
          onSelectUser={openProfile}
          groupMeta={leaderboard.groupMeta}
          orderBy={groupOrderBy}
          offset={groupOffset}
          limit={groupLimit}
          onChangeOrder={handleChangeGroupOrder}
          onChangeOffset={handleChangeGroupOffset}
          isFiltered={isFiltered}
        />
      ),
    },
    {
      value: 'friends',
      label: 'Friends',
      content: (
        <FriendsLeaderboardSection
          entries={leaderboard.overall}
          currentUserId={user?.id}
          friendUserIds={friendUserIds}
          isFiltered={isFiltered}
          onSelectUser={openProfile}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4 motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
      <LeaderboardFiltersBar />
      <SubTabs tabs={tabs} defaultValue="overall" ariaLabel="Leaderboard sections" />
    </div>
  );
}

export default LeaderboardView;
