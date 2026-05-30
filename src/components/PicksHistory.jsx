// Tier 11 Chunk 2 — PicksHistory tokenized.
// Post-Tier-4b — also respects `leaderboardFilters` from useData(): rows
// whose game isn't in the active league/season scope are hidden, and the
// summary stat shows scope-aware win counts when filtering. The same
// LeaderboardFiltersBar component used by the Leaderboard tab mounts at
// the top of this view so a single dropdown change scopes both surfaces.
// Tier 18 Chunk 4 — segmented `[Mine] [Friends']` toggle to switch
// between own picks and friends' picks.
// Tier 30 Phase 1 Chunk 1.3 — segmented toggle promoted to SubTabs so the
// active mode survives a URL share + we get a consistent visual primitive
// across every surface. Status / League / Season filters lift above the
// SubTabs since they apply to both modes; the Friend filter (Friends-only)
// stays inside the Friends sub-tab content.

import { useEffect, useMemo, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import SubTabs from './SubTabs';
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

// Apply the status + league + season filters to the row set. Shared by
// both panels so the filtering math stays in one place.
function applyFilters(rows, { statusFilter, leaderboardFilters }) {
  const scoped =
    leaderboardFilters.leagueId || leaderboardFilters.seasonId
      ? rows.filter((r) => {
          if (leaderboardFilters.leagueId && r.game.leagueId !== leaderboardFilters.leagueId) {
            return false;
          }
          if (leaderboardFilters.seasonId && r.game.seasonId !== leaderboardFilters.seasonId) {
            return false;
          }
          return true;
        })
      : rows;
  if (statusFilter === 'all') return scoped;
  if (statusFilter === 'wins') return scoped.filter((r) => r.status === 'won');
  if (statusFilter === 'draws') return scoped.filter((r) => r.status === 'draw');
  if (statusFilter === 'losses') return scoped.filter((r) => r.status === 'lost');
  if (statusFilter === 'pending')
    return scoped.filter((r) => r.status === 'pending' || r.status === 'live');
  return scoped;
}

function PickRow({ entry }) {
  const { game, status, points, kind } = entry;
  const choice = kind === 'mine' ? entry.pick.choice : entry.row.choice;
  const chosenTeam = displayTeamName(choice === 'home' ? game.homeTeam : game.awayTeam);
  return (
    <div className="rounded-3xl bg-overlay/70 p-4">
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
              <Avatar username={entry.row.username} displayName={entry.row.displayName} size={20} />
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
        <div className="flex shrink-0 items-center gap-3">{statusBadge(status, points)}</div>
      </div>
    </div>
  );
}

function MinePicksPanel({ picks, games, statusFilter, leaderboardFilters }) {
  const [listRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });
  const isScoped = Boolean(leaderboardFilters.leagueId || leaderboardFilters.seasonId);

  const baseRows = useMemo(() => {
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
      .filter((r) => r.game)
      .sort(comparePicksByPendingThenRecent);
  }, [picks, games]);

  const filtered = useMemo(
    () => applyFilters(baseRows, { statusFilter, leaderboardFilters }),
    [baseRows, statusFilter, leaderboardFilters],
  );

  return (
    <div ref={listRef} className="space-y-3">
      {baseRows.length === 0 ? (
        <EmptyState
          title="No picks yet"
          description="Head to the Matches tab and back a winner — your history will show up here."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={isScoped ? 'No picks on these matches yet' : 'Nothing matches that filter'}
          description={
            isScoped
              ? 'No picks fall in this league/season. Clear the filter to see everything.'
              : 'Try another filter, or pick more games.'
          }
        />
      ) : (
        filtered.map((entry) => <PickRow key={entry.key} entry={entry} />)
      )}
    </div>
  );
}

function FriendsPicksPanel({ friendsPicks, games, statusFilter, leaderboardFilters }) {
  const [listRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });
  const [friendFilter, setFriendFilter] = useState('all');
  const isScoped = Boolean(leaderboardFilters.leagueId || leaderboardFilters.seasonId);

  const baseRows = useMemo(() => {
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

  // Unique friends in the current feed, sorted by display name. Driven
  // off the rows so we only surface friends with picks in scope.
  const friendOptions = useMemo(() => {
    const seen = new Map();
    for (const r of baseRows) {
      if (seen.has(r.row.userId)) continue;
      seen.set(r.row.userId, {
        id: r.row.userId,
        label: r.row.displayName || r.row.username,
      });
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.label.toLowerCase().localeCompare(b.label.toLowerCase()),
    );
  }, [baseRows]);

  // Reset the friend filter if the previously-selected friend no longer
  // appears in the feed (unfriended mid-session / picks aged out).
  useEffect(() => {
    if (friendFilter === 'all') return;
    if (!friendOptions.some((opt) => opt.id === friendFilter)) {
      setFriendFilter('all');
    }
  }, [friendFilter, friendOptions]);

  const byFriend = useMemo(() => {
    if (friendFilter === 'all') return baseRows;
    return baseRows.filter((r) => r.row.userId === friendFilter);
  }, [baseRows, friendFilter]);

  const filtered = useMemo(
    () => applyFilters(byFriend, { statusFilter, leaderboardFilters }),
    [byFriend, statusFilter, leaderboardFilters],
  );

  return (
    <div className="space-y-4">
      <label className="inline-flex min-h-9 items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-fg">
        <span className="text-fg-muted">Friend</span>
        <span className="sr-only">Filter by friend</span>
        <select
          value={friendFilter}
          onChange={(e) => setFriendFilter(e.target.value)}
          disabled={friendOptions.length === 0}
          className="rounded-xl border border-default bg-elevated/90 px-3 py-1 text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          <option value="all">All friends</option>
          {friendOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <div ref={listRef} className="space-y-3">
        {baseRows.length === 0 ? (
          <EmptyState
            title="No friend picks yet"
            description="When your friends make picks, they'll show up here. Add friends from the Friends tab."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={isScoped ? 'No picks on these matches yet' : 'Nothing matches that filter'}
            description={
              isScoped
                ? 'No picks fall in this league/season. Clear the filter to see everything.'
                : 'Try another filter, or pick from a different friend.'
            }
          />
        ) : (
          filtered.map((entry) => <PickRow key={entry.key} entry={entry} />)
        )}
      </div>
    </div>
  );
}

function PicksHistory({ picks, games }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const { leaderboardFilters, friendsPicks } = useData();
  const isScoped = Boolean(leaderboardFilters.leagueId || leaderboardFilters.seasonId);

  const tabs = [
    {
      value: 'mine',
      label: 'Mine',
      content: (
        <MinePicksPanel
          picks={picks}
          games={games}
          statusFilter={statusFilter}
          leaderboardFilters={leaderboardFilters}
        />
      ),
    },
    {
      value: 'friends',
      label: 'Friends',
      content: (
        <FriendsPicksPanel
          friendsPicks={friendsPicks}
          games={games}
          statusFilter={statusFilter}
          leaderboardFilters={leaderboardFilters}
        />
      ),
    },
  ];

  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold text-fg">Picks</h2>
            {isScoped ? (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                Filtered
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-fg-muted">
            Switch between your own picks and your friends'; filter by status or scope.
          </p>
        </div>
      </div>

      {/* Status + league/season filter rail. Applies to both Mine and
          Friends sub-tabs (status state is shared). Pills on md+, native
          <select> on phones so 5 pills don't overflow the rail. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="hidden flex-wrap gap-2 md:flex" role="tablist" aria-label="Filter picks">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={statusFilter === f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`inline-flex min-h-9 items-center rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                statusFilter === f.id
                  ? 'bg-accent text-accent-fg'
                  : 'border border-default bg-elevated/80 text-fg hover:border-strong'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="inline-flex min-h-9 items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-fg md:hidden">
          <span className="text-fg-muted">Status</span>
          <span className="sr-only">Filter picks</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-default bg-elevated/90 px-3 py-1 text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <LeaderboardFiltersBar label="Filter by" />
      </div>

      {/* SubTabs primitive — replaces the prior custom segmented toggle.
          URL key `?tab=mine|friends` survives refresh and deep-links. */}
      <div className="mt-6">
        <SubTabs tabs={tabs} defaultValue="mine" ariaLabel="Pick source" />
      </div>
    </div>
  );
}

export default PicksHistory;
