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
  };
}
