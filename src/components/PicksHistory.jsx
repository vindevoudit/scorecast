// Tier 11 Chunk 2 — PicksHistory tokenized.
// Post-Tier-4b — also respects `leaderboardFilters` from useData(): rows
// whose game isn't in the active league/season scope are hidden, and the
// summary stat shows scope-aware win counts when filtering. The same
// LeaderboardFiltersBar component used by the Leaderboard tab mounts at
// the top of this view so a single dropdown change scopes both surfaces.

import { useMemo, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import EmptyState from './EmptyState';
import { Badge } from './ui';
import LeaderboardFiltersBar from './LeaderboardFiltersBar';
import { useData } from '../hooks/useData';
import { pickStatus, scorePick } from '../utils/scoring';
import { displayTeamName } from '../utils/teamNames';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'wins', label: 'Wins' },
  { id: 'losses', label: 'Losses' },
  { id: 'pending', label: 'Pending' },
];

function formatDate(value) {
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function statusBadge(status, points) {
  if (status === 'won') return <Badge tone="success">Won +{points} pts</Badge>;
  if (status === 'draw') return <Badge tone="warning">Drew +{points} pts</Badge>;
  if (status === 'lost') return <Badge tone="danger">Missed</Badge>;
  if (status === 'live') return <Badge tone="warning">Live</Badge>;
  return <Badge tone="neutral">Pending</Badge>;
}

function PicksHistory({ picks, games }) {
  const [filter, setFilter] = useState('all');
  const { leaderboardFilters } = useData();
  const isScoped = Boolean(leaderboardFilters.leagueId || leaderboardFilters.seasonId);
  const [listRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });

  const rows = useMemo(() => {
    const gameById = new Map(games.map((g) => [g.id, g]));
    return picks
      .map((pick) => {
        const game = gameById.get(pick.gameId);
        const status = pickStatus(pick, game);
        const points = scorePick(pick, game);
        return { pick, game, status, points };
      })
      .filter((row) => row.game)
      .sort((a, b) => new Date(b.game.date) - new Date(a.game.date));
  }, [picks, games]);

  // Apply the league/season scope BEFORE the per-status filter so the
  // status counts shown to the user (and the empty-state message) reflect
  // the scoped set.
  const scopedRows = useMemo(() => {
    if (!isScoped) return rows;
    return rows.filter((r) => {
      if (leaderboardFilters.leagueId && r.game.leagueId !== leaderboardFilters.leagueId) {
        return false;
      }
      if (leaderboardFilters.seasonId && r.game.seasonId !== leaderboardFilters.seasonId) {
        return false;
      }
      return true;
    });
  }, [rows, isScoped, leaderboardFilters.leagueId, leaderboardFilters.seasonId]);

  const filtered = useMemo(() => {
    if (filter === 'all') return scopedRows;
    if (filter === 'wins') return scopedRows.filter((r) => r.status === 'won');
    if (filter === 'losses') return scopedRows.filter((r) => r.status === 'lost');
    if (filter === 'pending')
      return scopedRows.filter((r) => r.status === 'pending' || r.status === 'live');
    return scopedRows;
  }, [scopedRows, filter]);

  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold text-fg">My Picks</h2>
            {isScoped ? (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                Filtered
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-fg-muted">Every pick you've made, with outcomes and points.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter picks">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                filter === f.id
                  ? 'bg-accent text-accent-fg'
                  : 'border border-default bg-elevated/80 text-fg hover:border-strong'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <LeaderboardFiltersBar label="Filter by" />
      </div>

      <div ref={listRef} className="mt-6 space-y-3">
        {rows.length === 0 ? (
          <EmptyState
            title="No picks yet"
            description="Head to the Games tab and back a winner — your history will show up here."
          />
        ) : scopedRows.length === 0 ? (
          <EmptyState
            title="No picks on these matches yet"
            description="No picks fall in this league/season. Clear the filter to see everything."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nothing matches that filter"
            description="Try another filter, or pick more games."
          />
        ) : (
          filtered.map(({ pick, game, status, points }) => {
            const chosenTeam = displayTeamName(
              pick.choice === 'home' ? game.homeTeam : game.awayTeam,
            );
            return (
              <div
                key={pick.id || `${pick.userId}-${pick.gameId}`}
                className="rounded-3xl bg-overlay/70 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.25em] text-accent/80">
                      {formatDate(game.date)}
                    </p>
                    <p className="mt-2 truncate text-base font-semibold text-fg">
                      {displayTeamName(game.homeTeam)} <span className="text-fg-subtle">vs</span>{' '}
                      {displayTeamName(game.awayTeam)}
                    </p>
                    <p className="mt-1 text-sm text-fg-muted">
                      Your pick: <span className="text-fg">{chosenTeam}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {statusBadge(status, points)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default PicksHistory;
