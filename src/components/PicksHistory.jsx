// Tier 11 Chunk 2 — PicksHistory tokenized.
// Post-Tier-4b — also respects `leaderboardFilters` from useData(): rows
// whose game isn't in the active league/season scope are hidden, and the
// summary stat shows scope-aware win counts when filtering. The same
// LeaderboardFiltersBar component used by the Leaderboard tab mounts at
// the top of this view so a single dropdown change scopes both surfaces.
// Tier 18 Chunk 4 — segmented `[Mine] [Friends']` toggle at the top right.
// Friends mode renders rows from useData().friendsPicks (server-computed
// points + masking applied). Per-status filter chips + league/season scope
// apply to both modes.

import { useEffect, useMemo, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import { Badge } from './ui';
import LeaderboardFiltersBar from './LeaderboardFiltersBar';
import { useData } from '../hooks/useData';
import { pickStatus, scorePick } from '../utils/scoring';
import { displayTeamName } from '../utils/teamNames';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'wins', label: 'Wins' },
  { id: 'draws', label: 'Draws' },
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

// Friend-pick rows are server-scored (points field), so client-side status
// derivation only needs the game state + the choice/result comparison.
// Mirrors src/utils/scoring.js `pickStatus` but takes the trimmed friend-row
// shape instead of the full Pick model.
function friendPickStatus(row, game) {
  if (!game) return 'pending';
  if (game.status === 'in-progress') return 'live';
  if (!game.result) return 'pending';
  if (game.result === 'draw') return 'draw';
  if (row.choice === game.result) return 'won';
  return 'lost';
}

// Tier 18 Chunk 4 — comparator used by both Mine and Friends row builders.
// Unresolved picks (pending + live) bubble to the top sorted by kickoff
// ASC (soonest first → live games sit ahead of upcoming since they've
// already started). Resolved picks follow, sorted by kickoff DESC (most
// recently played first).
function isUnresolved(status) {
  return status === 'pending' || status === 'live';
}
function comparePicksByPendingThenRecent(a, b) {
  const aPending = isUnresolved(a.status);
  const bPending = isUnresolved(b.status);
  if (aPending !== bPending) return aPending ? -1 : 1;
  const ta = new Date(a.game.date).getTime();
  const tb = new Date(b.game.date).getTime();
  return aPending ? ta - tb : tb - ta;
}

function PicksHistory({ picks, games }) {
  const [filter, setFilter] = useState('all');
  const [mode, setMode] = useState('mine');
  // Tier 18 Chunk 4 — Friends mode supports narrowing to one friend at a
  // time. 'all' shows the full feed; otherwise the value is a friend's
  // userId. Reset to 'all' whenever the mode toggles away and back so a
  // stale id from a previous session can't hide rows silently.
  const [friendFilter, setFriendFilter] = useState('all');
  const { leaderboardFilters, friendsPicks } = useData();
  const isScoped = Boolean(leaderboardFilters.leagueId || leaderboardFilters.seasonId);
  const [listRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });

  const myRows = useMemo(() => {
    const gameById = new Map(games.map((g) => [g.id, g]));
    return picks
      .map((pick) => {
        const game = gameById.get(pick.gameId);
        const status = pickStatus(pick, game);
        const points = scorePick(pick, game);
        return {
          kind: 'mine',
          key: pick.id || `${pick.userId}-${pick.gameId}`,
          pick,
          game,
          status,
          points,
        };
      })
      .filter((row) => row.game)
      .sort(comparePicksByPendingThenRecent);
  }, [picks, games]);

  const friendRows = useMemo(() => {
    const gameById = new Map(games.map((g) => [g.id, g]));
    return friendsPicks
      .map((row) => {
        const game = gameById.get(row.gameId);
        const status = friendPickStatus(row, game);
        return { kind: 'friends', key: row.pickId, row, game, status, points: row.points };
      })
      .filter((r) => r.game)
      .sort(comparePicksByPendingThenRecent);
  }, [friendsPicks, games]);

  // Tier 18 Chunk 4 — unique friends in the current feed, sorted by name.
  // Powers the friend-filter dropdown. Driven off the rows (not the friend
  // list) so we only surface friends who actually have picks in scope —
  // a friend with 0 visible picks would just produce an empty dropdown
  // entry. Masked rows use the masked label as the option text.
  const friendOptions = useMemo(() => {
    const seen = new Map();
    for (const r of friendRows) {
      if (seen.has(r.row.userId)) continue;
      seen.set(r.row.userId, {
        id: r.row.userId,
        label: r.row.displayName || r.row.username,
      });
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.label.toLowerCase().localeCompare(b.label.toLowerCase()),
    );
  }, [friendRows]);

  const filteredByFriend = useMemo(() => {
    if (mode !== 'friends' || friendFilter === 'all') return friendRows;
    return friendRows.filter((r) => r.row.userId === friendFilter);
  }, [friendRows, friendFilter, mode]);

  // Reset the friend filter back to "all" when toggling out of Friends
  // mode (or when the previously-selected friend no longer has any rows
  // — e.g. unfriended mid-session or their picks aged out of the window).
  useEffect(() => {
    if (mode !== 'friends') {
      if (friendFilter !== 'all') setFriendFilter('all');
      return;
    }
    if (friendFilter === 'all') return;
    if (!friendOptions.some((opt) => opt.id === friendFilter)) {
      setFriendFilter('all');
    }
  }, [mode, friendFilter, friendOptions]);

  const baseRows = mode === 'mine' ? myRows : filteredByFriend;

  // Apply the league/season scope BEFORE the per-status filter so the
  // status counts shown to the user (and the empty-state message) reflect
  // the scoped set.
  const scopedRows = useMemo(() => {
    if (!isScoped) return baseRows;
    return baseRows.filter((r) => {
      if (leaderboardFilters.leagueId && r.game.leagueId !== leaderboardFilters.leagueId) {
        return false;
      }
      if (leaderboardFilters.seasonId && r.game.seasonId !== leaderboardFilters.seasonId) {
        return false;
      }
      return true;
    });
  }, [baseRows, isScoped, leaderboardFilters.leagueId, leaderboardFilters.seasonId]);

  const filtered = useMemo(() => {
    if (filter === 'all') return scopedRows;
    if (filter === 'wins') return scopedRows.filter((r) => r.status === 'won');
    // Tier 18 Chunk 3 — Draws is its own chip. statusBadge already
    // renders the Drew +N pts badge per Tier 17 draw-scoring, so no
    // rendering change is needed.
    if (filter === 'draws') return scopedRows.filter((r) => r.status === 'draw');
    if (filter === 'losses') return scopedRows.filter((r) => r.status === 'lost');
    if (filter === 'pending')
      return scopedRows.filter((r) => r.status === 'pending' || r.status === 'live');
    return scopedRows;
  }, [scopedRows, filter]);

  const emptyStateForMode =
    mode === 'mine'
      ? {
          title: 'No picks yet',
          description: 'Head to the Games tab and back a winner — your history will show up here.',
        }
      : {
          title: 'No friend picks yet',
          description:
            "When your friends make picks, they'll show up here. Add friends from the Friends panel.",
        };

  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold text-fg">
              {mode === 'mine' ? 'My Picks' : "Friends' Picks"}
            </h2>
            {isScoped ? (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                Filtered
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-fg-muted">
            {mode === 'mine'
              ? "Every pick you've made, with outcomes and points."
              : 'What your friends are picking, with their results.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Tier 18 Chunk 4 — Mine / Friends segmented toggle. Sits above
              the per-status filter chips so the modal hierarchy reads
              left-to-right: which set, then which slice of that set. */}
          <div
            className="inline-flex rounded-full border border-default bg-elevated/80 p-0.5"
            role="tablist"
            aria-label="Pick source"
          >
            {[
              { id: 'mine', label: 'Mine' },
              { id: 'friends', label: 'Friends' },
            ].map((opt) => (
              <button
                key={opt.id}
                role="tab"
                aria-selected={mode === opt.id}
                onClick={() => setMode(opt.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  mode === opt.id ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {opt.label}
              </button>
            ))}
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
      </div>

      {/* Tier 18 Chunk 4 — friend filter (Friends mode only) sits to the
          left of the league/season scope filter so the two read as a
          unified "narrow what you're looking at" row. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {mode === 'friends' ? (
          <label className="flex flex-wrap items-center gap-3 rounded-2xl bg-overlay/60 px-4 py-3 text-sm text-fg">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
              Friend
            </span>
            <span className="sr-only">Filter by friend</span>
            <select
              value={friendFilter}
              onChange={(e) => setFriendFilter(e.target.value)}
              disabled={friendOptions.length === 0}
              className="rounded-xl border border-default bg-elevated/90 px-3 py-2 text-sm text-fg outline-none transition focus:border-accent focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              <option value="all">All friends</option>
              {friendOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <LeaderboardFiltersBar label="Filter by" />
      </div>

      <div ref={listRef} className="mt-6 space-y-3">
        {baseRows.length === 0 ? (
          <EmptyState title={emptyStateForMode.title} description={emptyStateForMode.description} />
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
          filtered.map((entry) => {
            const { game, status, points, kind } = entry;
            const choice = kind === 'mine' ? entry.pick.choice : entry.row.choice;
            const chosenTeam = displayTeamName(choice === 'home' ? game.homeTeam : game.awayTeam);
            return (
              <div key={entry.key} className="rounded-3xl bg-overlay/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.25em] text-accent/80">
                      {formatDate(game.date)}
                    </p>
                    <p className="mt-2 truncate text-base font-semibold text-fg">
                      {displayTeamName(game.homeTeam)} <span className="text-fg-subtle">vs</span>{' '}
                      {displayTeamName(game.awayTeam)}
                    </p>
                    {kind === 'mine' ? (
                      <p className="mt-1 text-sm text-fg-muted">
                        Your pick: <span className="text-fg">{chosenTeam}</span>
                      </p>
                    ) : (
                      <div className="mt-2 flex items-center gap-2 text-sm text-fg-muted">
                        <Avatar
                          username={entry.row.username}
                          displayName={entry.row.displayName}
                          size={20}
                        />
                        <span className={entry.row.isMasked ? 'italic' : ''}>
                          {entry.row.displayName || entry.row.username}
                        </span>
                        <span className="text-fg-subtle">·</span>
                        <span>
                          Pick: <span className="text-fg">{chosenTeam}</span>
                        </span>
                      </div>
                    )}
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
