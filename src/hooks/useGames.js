'use strict';

// Tier 13 Chunk 3 — selector hooks on useData. Components can import the
// narrow slice they need instead of the full DataContext value.
import { useMemo } from 'react';
import { useData } from './useData';

export function useGames() {
  const { games, refreshGames } = useData();

  const segmented = useMemo(() => {
    const now = Date.now();
    const upcoming = [];
    const live = [];
    const completed = [];
    for (const game of games) {
      if (game.result) completed.push(game);
      else if (new Date(game.date).getTime() > now) upcoming.push(game);
      else live.push(game);
    }
    return { upcomingGames: upcoming, liveGames: live, completedGames: completed };
  }, [games]);

  return { games, refreshGames, ...segmented };
}
