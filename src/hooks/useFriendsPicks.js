'use strict';

// Tier 18 Chunk 4 — selector for friends' picks. DataContext stores a flat
// array; consumers usually want it grouped by game (for the GameCard inline
// expand) or sorted by recency (for the PicksHistory Friends tab). Memo'd
// here so both surfaces share the same derived shape without recomputing.

import { useMemo } from 'react';
import { useData } from './useData';

export function useFriendsPicks() {
  const { friendsPicks } = useData();

  const byGame = useMemo(() => {
    const map = new Map();
    for (const row of friendsPicks) {
      const list = map.get(row.gameId);
      if (list) list.push(row);
      else map.set(row.gameId, [row]);
    }
    // Stable order within each game: most-recent pick first. Friend rows
    // with identical submittedAt land in array-insertion order.
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    }
    return map;
  }, [friendsPicks]);

  return { friendsPicks, byGame };
}
