// Tier 30 Phase 1 Chunk 1.3 — LeaderboardView. Lifts the Leaderboard
// surface out of DashboardView's inline 2-column block and into a
// dedicated view with three sub-tabs:
//
//   Overall → the global leaderboard (clean: top-3 + the viewer's own
//             "your position" row when off-page; no friends interleaved)
//   Groups  → the existing GroupLeaderboardCard with its group picker
//   Friends → the viewer + every accepted friend, scored server-side
//             (`leaderboard.friends`) so a friend or the viewer below the
//             overall top-N still appears
//
// LeaderboardFiltersBar sits ABOVE the SubTabs since league/season scope
// applies to all three modes consistently.

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
  // `entries` is the server-side friends block (`leaderboard.friends`): the
  // viewer + every accepted friend, already scored from the materialized
  // tables and sorted by points DESC — so a friend (or the viewer) below the
  // overall top-N still appears here. Ranks are local to this view ("rank
  // among friends"), assigned by LeaderboardCard from list position.
  //
  // The block always includes the viewer themselves, so gate the empty state
  // on the *friend* set rather than `entries.length` — otherwise a friendless
  // user would see only their own lonely row instead of the "add friends"
  // nudge.
  const hasFriends = friendUserIds && friendUserIds.length > 0;
  if (!hasFriends || !entries || entries.length === 0) {
    return (
      <EmptyState
        title="No friends on the leaderboard yet"
        description={
          hasFriends
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
      entries={entries}
      currentUserId={currentUserId}
      onSelectUser={onSelectUser}
      isFiltered={isFiltered}
      friendUserIds={friendUserIds}
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
  // GET /api/friends returns { id: <friendship id>, userId: <friend's user id> }.
  // Leaderboard rows + LeaderboardCard's friendUserIds prop are keyed on the
  // USER id — map f.userId, not f.id (the friendship id never matches a row and
  // left the Friends tab showing only the current user).
  const friendUserIds = (friends?.friends || []).map((f) => f.userId);

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
          viewerRow={leaderboard.overallMeta?.viewerRow}
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
          entries={leaderboard.friends}
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
