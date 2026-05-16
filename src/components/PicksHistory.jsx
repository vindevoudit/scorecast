// Tier 11 Chunk 2 — PicksHistory tokenized.

import { useMemo, useState } from 'react';
import EmptyState from './EmptyState';
import { Badge } from './ui';
import { pickStatus, scorePick } from '../utils/scoring';

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
  if (status === 'lost') return <Badge tone="danger">Missed</Badge>;
  if (status === 'live') return <Badge tone="warning">Live</Badge>;
  return <Badge tone="neutral">Pending</Badge>;
}

function PicksHistory({ picks, games }) {
  const [filter, setFilter] = useState('all');

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

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'wins') return rows.filter((r) => r.status === 'won');
    if (filter === 'losses') return rows.filter((r) => r.status === 'lost');
    if (filter === 'pending')
      return rows.filter((r) => r.status === 'pending' || r.status === 'live');
    return rows;
  }, [rows, filter]);

  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-fg">My Picks</h2>
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

      <div className="mt-6 space-y-3">
        {rows.length === 0 ? (
          <EmptyState
            title="No picks yet"
            description="Head to the Games tab and back a winner — your history will show up here."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nothing matches that filter"
            description="Try another filter, or pick more games."
          />
        ) : (
          filtered.map(({ pick, game, status, points }) => {
            const chosenTeam = pick.choice === 'home' ? game.homeTeam : game.awayTeam;
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
                      {game.homeTeam} <span className="text-fg-subtle">vs</span> {game.awayTeam}
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
