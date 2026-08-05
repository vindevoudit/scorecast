// Tier 34 — top-level sport selector. Sits above the league filter on Matches
// and Leaderboards.
//
// Deliberately a visible pill row rather than another <select> in the filter
// bar: a second sport is a headline feature, and burying it in a dropdown
// nobody opens would make cricket effectively undiscoverable.
//
// URL keys are distinct per surface (?sport= for matches, ?lbSport= for
// leaderboards), matching the existing ?league= / ?lbLeague= split — choosing
// a sport to browse should not silently rescope your standings.

import { useEffect, useState } from 'react';
import { SPORTS, sportLabel, sportIcon } from '../utils/sports';
import { useData } from '../hooks/useData';

function readUrlSport(key) {
  if (typeof window === 'undefined') return '';
  const value = new URLSearchParams(window.location.search).get(key);
  return SPORTS.includes(value) ? value : '';
}

function writeUrlSport(key, value) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(key, value);
  else params.delete(key);
  const qs = params.toString();
  // replaceState, not pushState — a filter change is not a navigation, and
  // stacking them would make Back mean "undo one filter tweak".
  window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

const SURFACES = {
  games: { urlKey: 'sport', label: 'Sport' },
  leaderboard: { urlKey: 'lbSport', label: 'Standings' },
};

/**
 * Reads and writes its own slice of DataContext, the same way GameFiltersBar
 * and LeaderboardFiltersBar do, so mounting it is a single self-contained tag.
 *
 * @param {'games'|'leaderboard'} surface  which filter slot to drive
 */
function SportSwitcher({ surface = 'games', allowAll = true }) {
  const { gameFilters, applyGameFilters, leaderboardFilters, applyLeaderboardFilters } = useData();
  const { urlKey, label } = SURFACES[surface] || SURFACES.games;
  const isGames = surface === 'games';
  const filters = isGames ? gameFilters : leaderboardFilters;
  const value = filters.sport ?? '';
  const onChange = (sport) =>
    isGames
      ? applyGameFilters({ ...gameFilters, sport })
      : applyLeaderboardFilters({ ...leaderboardFilters, sport });

  const [hydrated, setHydrated] = useState(false);

  // Adopt the URL's sport once on mount. Guarded so a later render cannot
  // stomp a user's click back to the URL value.
  useEffect(() => {
    if (hydrated) return;
    setHydrated(true);
    const fromUrl = readUrlSport(urlKey);
    if (fromUrl && fromUrl !== value) onChange(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const select = (next) => {
    writeUrlSport(urlKey, next);
    onChange(next);
  };

  const options = allowAll ? ['', ...SPORTS] : SPORTS;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
        {label}
      </span>
      <div
        role="tablist"
        aria-label="Filter by sport"
        className="flex flex-wrap gap-1 rounded-2xl border border-default bg-overlay/50 p-1"
      >
        {options.map((sport) => {
          const active = value === sport;
          return (
            <button
              key={sport || 'all'}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => select(sport)}
              className={[
                'rounded-xl px-3 py-1.5 text-xs font-semibold transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                active
                  ? 'shadow-brand-glow bg-accent/15 text-accent'
                  : 'text-fg-muted hover:bg-overlay hover:text-fg',
              ].join(' ')}
            >
              {sport ? `${sportIcon(sport)} ${sportLabel(sport)}` : 'All sports'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default SportSwitcher;
