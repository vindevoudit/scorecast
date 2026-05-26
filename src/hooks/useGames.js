'use strict';

// Tier 13 Chunk 3 — selector hooks on useData. Components can import the
// narrow slice they need instead of the full DataContext value.
import { useMemo } from 'react';
import { useData } from './useData';

// Tier 18 Chunk 3 — day-bucket key in the viewer's local timezone.
// `en-CA` reliably produces YYYY-MM-DD across browsers/locales (the
// CA locale uses ISO date order by design — safer than constructing
// from getFullYear/getMonth/getDate which can desync at midnight
// boundaries depending on timezone).
export function dayKey(value) {
  return new Date(value).toLocaleDateString('en-CA');
}

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

  // Tier 18 Chunk 3 — Map<YYYY-MM-DD, Game[]> for the calendar viewer.
  // Same source array, just a different shape — components that already
  // use `games` / `upcomingGames` / etc. are unaffected.
  const byDay = useMemo(() => {
    const map = new Map();
    for (const game of games) {
      const key = dayKey(game.date);
      const list = map.get(key);
      if (list) {
        list.push(game);
      } else {
        map.set(key, [game]);
      }
    }
    return map;
  }, [games]);

  return { games, refreshGames, byDay, ...segmented };
}
