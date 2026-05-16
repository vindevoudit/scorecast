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
      // Status is the primary signal once Tier 4b is live; result still
      // works as a fallback for legacy/hand-entered games that may not
      // have a synced status. Draws land in `completed` via the
      // status === 'finished' branch even though result is null.
      const status = game.status;
      if (
        game.result ||
        status === 'finished' ||
        status === 'postponed' ||
        status === 'cancelled'
      ) {
        completed.push(game);
      } else if (status === 'in-progress') {
        live.push(game);
      } else if (new Date(game.date).getTime() > now) {
        upcoming.push(game);
      } else {
        // Kickoff has passed but upstream hasn't flagged the match
        // started yet — treat as live so it doesn't sit in `upcoming`.
        live.push(game);
      }
    }
    return { upcomingGames: upcoming, liveGames: live, completedGames: completed };
  }, [games]);

  return { games, refreshGames, ...segmented };
}
