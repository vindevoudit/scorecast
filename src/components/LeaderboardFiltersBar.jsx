// Leaderboard + My Picks filter bar. Mirror of GameFiltersBar but writes
// to its own URL keys (`?lbLeague=&lbSeason=`) and DataContext slot
// (`leaderboardFilters`) so picking a league for stats doesn't also scope
// the games view (and vice versa). Shared by the Leaderboard tab + the My
// Picks tab; both surfaces read `leaderboardFilters` from useData().

import { useEffect, useMemo, useState } from 'react';
import { useRequest } from '../hooks/useRequest';
import { useData } from '../hooks/useData';

function parseUrlFilter() {
  if (typeof window === 'undefined') return { leagueCode: '', seasonYear: '' };
  const params = new URLSearchParams(window.location.search);
  return {
    leagueCode: params.get('lbLeague') || '',
    seasonYear: params.get('lbSeason') || '',
  };
}

function writeUrlFilter({ leagueCode, seasonYear }) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (leagueCode) params.set('lbLeague', leagueCode);
  else params.delete('lbLeague');
  if (seasonYear) params.set('lbSeason', String(seasonYear));
  else params.delete('lbSeason');
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', next);
}

function LeaderboardFiltersBar({ label = 'Stats scope' }) {
  const request = useRequest();
  const { applyLeaderboardFilters } = useData();
  const [leagues, setLeagues] = useState([]);
  const [leagueCode, setLeagueCode] = useState('');
  const [seasonYear, setSeasonYear] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Public endpoint — works for anon viewers too.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await request('/api/leagues');
        if (!cancelled) setLeagues(data || []);
      } catch {
        if (!cancelled) setLeagues([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  // Hydrate from URL once leagues land — code → UUID resolution needs the
  // league list to be present.
  useEffect(() => {
    if (hydrated || leagues.length === 0) return;
    const { leagueCode: urlLeague, seasonYear: urlSeason } = parseUrlFilter();
    if (!urlLeague) {
      setHydrated(true);
      return;
    }
    const league = leagues.find((l) => l.sourceLeagueId === urlLeague);
    if (!league) {
      setHydrated(true);
      return;
    }
    setLeagueCode(league.sourceLeagueId);
    const season = urlSeason ? league.seasons.find((s) => String(s.year) === urlSeason) : null;
    if (season) setSeasonYear(String(season.year));
    applyLeaderboardFilters({
      leagueId: league.id,
      seasonId: season ? season.id : '',
    });
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagues]);

  const selectedLeague = useMemo(
    () => leagues.find((l) => l.sourceLeagueId === leagueCode) || null,
    [leagues, leagueCode],
  );

  const handleLeagueChange = (event) => {
    const code = event.target.value;
    setLeagueCode(code);
    setSeasonYear('');
    const league = leagues.find((l) => l.sourceLeagueId === code) || null;
    writeUrlFilter({ leagueCode: code, seasonYear: '' });
    applyLeaderboardFilters({ leagueId: league ? league.id : '', seasonId: '' });
  };

  const handleSeasonChange = (event) => {
    const year = event.target.value;
    setSeasonYear(year);
    const season =
      selectedLeague && year ? selectedLeague.seasons.find((s) => String(s.year) === year) : null;
    writeUrlFilter({ leagueCode, seasonYear: year });
    applyLeaderboardFilters({
      leagueId: selectedLeague ? selectedLeague.id : '',
      seasonId: season ? season.id : '',
    });
  };

  if (leagues.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-overlay/60 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
        {label}
      </span>
      <label className="flex items-center gap-2 text-sm text-fg">
        <span className="sr-only">League</span>
        <select
          value={leagueCode}
          onChange={handleLeagueChange}
          className="rounded-xl border border-default bg-elevated/90 px-3 py-2 text-sm text-fg outline-none transition focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="">All leagues</option>
          {leagues.map((l) => (
            <option key={l.id} value={l.sourceLeagueId}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      {selectedLeague && selectedLeague.seasons.length > 0 ? (
        <label className="flex items-center gap-2 text-sm text-fg">
          <span className="sr-only">Season</span>
          <select
            value={seasonYear}
            onChange={handleSeasonChange}
            className="rounded-xl border border-default bg-elevated/90 px-3 py-2 text-sm text-fg outline-none transition focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">All seasons</option>
            {selectedLeague.seasons.map((s) => (
              <option key={s.id} value={s.year}>
                {s.year}
                {s.current ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export default LeaderboardFiltersBar;
