'use strict';

import { useData } from './useData';

export function useLeaderboard() {
  const {
    leaderboard,
    groupOrderBy,
    groupOffset,
    groupLimit,
    handleChangeGroupOrder,
    handleChangeGroupOffset,
    handleGroupSelection,
    refreshLeaderboard,
    loadMoreLeaderboard,
    collapseLeaderboard,
    leaderboardLoadingMore,
    overallLimit,
  } = useData();
  return {
    leaderboard,
    groupOrderBy,
    groupOffset,
    groupLimit,
    handleChangeGroupOrder,
    handleChangeGroupOffset,
    handleGroupSelection,
    refreshLeaderboard,
    loadMoreLeaderboard,
    collapseLeaderboard,
    leaderboardLoadingMore,
    overallLimit,
  };
}
