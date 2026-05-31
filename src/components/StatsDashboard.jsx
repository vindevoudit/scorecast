// Tier 30 Phase 3 C1 — Personal stats dashboard.
//
// Mounted as a Stats sub-tab inside ProfileView. Recharts (~15 KB gzip
// tree-shaken) is split into its own 'charts' vite chunk so the dashboard
// only ships when the user opens this tab.
//
// Server payload shape (see services/StatsService.js):
//   { window, summary, pointsOverTime, winRateTrend, perLeague,
//     pickTimeHeatmap, blindSpot, mostDisagreedFriend }

import { Component, useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useRequest } from '../hooks/useRequest';
import EmptyState from './EmptyState';

const WINDOWS = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'season', label: 'Season' },
];

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shortDate(key) {
  if (!key) return '';
  const [, m, d] = key.split('-');
  return `${m}/${d}`;
}

// Defensive boundary: recharts has occasionally surfaced render-time errors
// under React 18 strict mode or Vite dev's HMR. Without this, a chart crash
// would unmount the whole dashboard. With it, the rest of the surface stays
// usable and the user sees a one-line note instead of a blank tab.
class ChartErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err) {
    console.error('Stats chart crashed:', err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <p className="rounded-3xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          One of the charts failed to render. Reload to try again.
        </p>
      );
    }
    return this.props.children;
  }
}

function StatTile({ label, value, accent }) {
  return (
    <div className="rounded-2xl bg-overlay/70 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-fg-muted">{label}</p>
      <p className={`font-led mt-1 text-2xl tabular-nums ${accent ? 'text-accent' : 'text-fg'}`}>
        {value}
      </p>
    </div>
  );
}

function PointsOverTimeChart({ data }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="rounded-3xl border border-default bg-elevated/60 p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Points over time</p>
      <p className="mt-1 text-sm text-fg-muted">Daily + running total</p>
      <div className="mt-3 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.18)" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              minTickGap={20}
              tick={{ fontSize: 11, fill: 'currentColor' }}
              className="text-fg-muted"
              stroke="currentColor"
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'currentColor' }}
              className="text-fg-muted"
              stroke="currentColor"
            />
            <Tooltip
              contentStyle={{
                background: 'rgb(15 23 42)',
                border: '1px solid rgb(51 65 85)',
                borderRadius: 12,
                fontSize: 12,
              }}
              labelFormatter={(v) => `Date: ${v}`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="points"
              name="Daily points"
              stroke="#22d3ee"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="cumulative"
              name="Running total"
              stroke="#a855f7"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function WinRateTrendChart({ data }) {
  if (!data || data.length === 0) return null;
  const pct = data.map((d) => ({
    date: d.date,
    winRate: Math.round(d.winRate * 100),
    winRateMA: Math.round(d.winRateMA * 100),
  }));
  return (
    <div className="rounded-3xl border border-default bg-elevated/60 p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Win-rate trend</p>
      <p className="mt-1 text-sm text-fg-muted">Daily % + 14-day moving average</p>
      <div className="mt-3 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pct} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.18)" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              minTickGap={20}
              tick={{ fontSize: 11, fill: 'currentColor' }}
              stroke="currentColor"
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'currentColor' }}
              stroke="currentColor"
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                background: 'rgb(15 23 42)',
                border: '1px solid rgb(51 65 85)',
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(v) => `${v}%`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="winRate"
              name="Daily"
              stroke="#fbbf24"
              strokeWidth={2}
              dot={{ r: 2 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="winRateMA"
              name="14-day MA"
              stroke="#22d3ee"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PerLeagueChart({ data }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="rounded-3xl border border-default bg-elevated/60 p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Per-league breakdown</p>
      <p className="mt-1 text-sm text-fg-muted">Wins / draws / losses</p>
      <div className="mt-3 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.18)" />
            <XAxis
              dataKey="leagueName"
              tick={{ fontSize: 11, fill: 'currentColor' }}
              stroke="currentColor"
            />
            <YAxis tick={{ fontSize: 11, fill: 'currentColor' }} stroke="currentColor" />
            <Tooltip
              contentStyle={{
                background: 'rgb(15 23 42)',
                border: '1px solid rgb(51 65 85)',
                borderRadius: 12,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="wins" name="Wins" stackId="r" fill="#22c55e" />
            <Bar dataKey="draws" name="Draws" stackId="r" fill="#fbbf24" />
            <Bar dataKey="losses" name="Losses" stackId="r" fill="#ef4444" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PickTimeHeatmap({ grid }) {
  const peak = useMemo(() => {
    if (!grid) return 0;
    let max = 0;
    for (const row of grid) for (const cell of row) if (cell > max) max = cell;
    return max;
  }, [grid]);
  if (!grid) return null;
  return (
    <div className="rounded-3xl border border-default bg-elevated/60 p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Pick-time heatmap</p>
      <p className="mt-1 text-sm text-fg-muted">UTC day-of-week × hour</p>
      <div className="mt-3 overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* Hour header */}
          <div
            className="grid gap-px text-[10px] text-fg-muted"
            style={{ gridTemplateColumns: 'auto repeat(24, minmax(14px, 1fr))' }}
          >
            <div />
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="text-center tabular-nums">
                {h % 3 === 0 ? h : ''}
              </div>
            ))}
          </div>
          {/* Rows */}
          {grid.map((row, dow) => (
            <div
              key={dow}
              className="mt-px grid gap-px"
              style={{ gridTemplateColumns: 'auto repeat(24, minmax(14px, 1fr))' }}
            >
              <div className="pr-2 text-[10px] font-semibold text-fg-muted">{DOW_LABELS[dow]}</div>
              {row.map((cell, h) => {
                const intensity = peak > 0 ? cell / peak : 0;
                const bg =
                  cell === 0
                    ? 'rgb(30 41 59 / 0.55)'
                    : `rgb(34 211 238 / ${0.18 + intensity * 0.7})`;
                return (
                  <div
                    key={h}
                    className="aspect-square rounded-[3px]"
                    style={{ background: bg }}
                    title={`${DOW_LABELS[dow]} ${String(h).padStart(2, '0')}:00 UTC · ${cell} pick${
                      cell === 1 ? '' : 's'
                    }`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BlindSpotCard({ blindSpot }) {
  if (!blindSpot) return null;
  return (
    <div className="rounded-3xl border border-default bg-elevated/60 p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Blind spot</p>
      <p className="mt-2 text-lg font-semibold text-fg">{blindSpot.team}</p>
      <p className="mt-1 text-sm text-fg-muted">{blindSpot.insight}</p>
    </div>
  );
}

function MostDisagreedFriendCard({ friend }) {
  if (!friend) return null;
  const name = friend.displayName || friend.username || 'A friend';
  return (
    <div className="rounded-3xl border border-default bg-elevated/60 p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Most disagreed with</p>
      <p className="mt-2 text-lg font-semibold text-fg">{name}</p>
      <p className="mt-1 text-sm text-fg-muted">
        {friend.disagreements} of {friend.sharedPicks} shared pick
        {friend.sharedPicks === 1 ? '' : 's'} differ.
      </p>
    </div>
  );
}

function StatsDashboard() {
  const request = useRequest();
  const [window, setWindow] = useState('30d');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    request(`/api/me/stats?window=${window}`)
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load stats');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request, window]);

  const summary = stats?.summary;
  const winRatePct =
    summary && summary.scored > 0 ? Math.round((summary.wins / summary.scored) * 100) : 0;
  const hasAnyData = summary && summary.picks > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-fg">Your stats</h3>
          <p className="text-sm text-fg-muted">Trends, leagues, and what to watch for.</p>
        </div>
        <div
          className="inline-flex items-center gap-1 rounded-2xl border border-default bg-elevated/60 p-1"
          role="tablist"
          aria-label="Stats window"
        >
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              type="button"
              role="tab"
              aria-selected={window === w.value}
              onClick={() => setWindow(w.value)}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
                window === w.value ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !stats ? (
        <p className="rounded-3xl border border-default bg-elevated/40 px-4 py-8 text-center text-sm text-fg-muted">
          Loading stats…
        </p>
      ) : null}

      {error && !loading ? (
        <p className="rounded-3xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {stats && !hasAnyData && !loading ? (
        <EmptyState
          title="No stats in this window yet"
          description="Make a pick on the Matches tab — your trends will appear here."
        />
      ) : null}

      {stats && hasAnyData ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile label="Picks" value={summary.picks} />
            <StatTile label="Scored" value={summary.scored} />
            <StatTile label="Wins" value={summary.wins} accent />
            <StatTile label="Win rate" value={`${winRatePct}%`} />
          </div>
          <ChartErrorBoundary>
            <PointsOverTimeChart data={stats.pointsOverTime} />
            <WinRateTrendChart data={stats.winRateTrend} />
            <PerLeagueChart data={stats.perLeague} />
            <PickTimeHeatmap grid={stats.pickTimeHeatmap} />
          </ChartErrorBoundary>
          <div className="grid gap-4 sm:grid-cols-2">
            <BlindSpotCard blindSpot={stats.blindSpot} />
            <MostDisagreedFriendCard friend={stats.mostDisagreedFriend} />
          </div>
        </>
      ) : null}
    </div>
  );
}

export default StatsDashboard;
