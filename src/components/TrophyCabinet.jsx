// Trophy Cabinet — per-stage World Cup placements for one user. Fetches
// `/api/users/:username/trophy-cabinet` and renders a medal showcase header +
// one card per tournament stage showing the subject's placement + percentile
// overall and within their (viewer-visible) ScoreCast groups.
//
// Server payload shape (see services/TrophyService.js):
//   { userId, username, displayName, tournament: { leagueId, name } | null,
//     showcase: { gold, silver, bronze, enteredStages, bestFinish },
//     stages: [ { stage, label, scoredGames, totalGames, entered, points,
//                 overall: { rank, total, topPercent, medal } | null,
//                 groups: [ { groupId, groupName, discriminator, rank, total,
//                             topPercent, points } ] } ] }
//
// Used in two places: <TrophyCabinetView /> (the sidebar entry, self) and the
// Cabinet sub-tab in ProfileView (any profile — the backend gate 404s a hidden
// profile before we get here).

import { useEffect, useState } from 'react';
import { useRequest } from '../hooks/useRequest';
import EmptyState from './EmptyState';
import { stageLabel, MEDAL_EMOJI } from '../utils/stages';

const TROPHY_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-10 w-10"
  >
    <path d="M8 4h8v4a4 4 0 01-8 0V4z" />
    <path d="M8 6H5v1.5A3.5 3.5 0 008.5 11M16 6h3v1.5A3.5 3.5 0 0115.5 11" />
    <path d="M10 12.5h4V16h-4z" />
    <path d="M8 20h8M9.5 20l.5-4M14.5 20l-.5-4" />
  </svg>
);

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function Placement({ rank, total, topPercent, medal }) {
  const emoji = medal ? MEDAL_EMOJI[medal] : null;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {emoji ? <span aria-hidden="true">{emoji}</span> : null}
      <span className="font-led tabular-nums text-fg">{ordinal(rank)}</span>
      <span className="text-fg-subtle">of {total}</span>
      <span className="text-fg-muted">· Top {topPercent}%</span>
    </span>
  );
}

function ShowcaseHeader({ cabinet }) {
  const { showcase } = cabinet;
  const name = cabinet.displayName || cabinet.username;
  const medals = [
    { key: 'gold', emoji: '🥇', count: showcase.gold },
    { key: 'silver', emoji: '🥈', count: showcase.silver },
    { key: 'bronze', emoji: '🥉', count: showcase.bronze },
  ];
  const hasAny = showcase.enteredStages > 0;
  return (
    <div className="rounded-3xl border border-default bg-elevated/80 p-6 shadow-glow">
      <div className="flex items-center gap-3">
        <span className="text-accent">{TROPHY_ICON}</span>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-accent/80">Trophy Cabinet</p>
          <h3 className="mt-1 truncate text-2xl font-semibold text-fg">
            {cabinet.tournament?.name || 'World Cup'}
          </h3>
          <p className="text-sm text-fg-muted">
            {name}
            {hasAny
              ? ` · entered ${showcase.enteredStages} stage${showcase.enteredStages === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {medals.map((m) => (
          <div
            key={m.key}
            className="inline-flex items-center gap-2 rounded-2xl bg-overlay/70 px-4 py-2"
          >
            <span aria-hidden="true" className="text-xl">
              {m.emoji}
            </span>
            <span className="font-led text-xl tabular-nums text-fg">{m.count}</span>
          </div>
        ))}
        {showcase.bestFinish ? (
          <div className="inline-flex items-center gap-2 rounded-2xl bg-overlay/70 px-4 py-2">
            <span className="text-xs uppercase tracking-[0.2em] text-fg-muted">Best finish</span>
            <span className="text-sm font-semibold text-fg">
              {ordinal(showcase.bestFinish.rank)} · {showcase.bestFinish.label}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StageCard({ stage }) {
  const label = stage.label || stageLabel(stage.stage);
  const decided = stage.scoredGames > 0;
  return (
    <div className="rounded-3xl border border-default bg-elevated/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-lg font-semibold text-fg">{label}</h4>
        <span className="text-xs uppercase tracking-[0.18em] text-fg-subtle">
          {stage.scoredGames}/{stage.totalGames} played
        </span>
      </div>

      {!decided ? (
        <p className="mt-3 text-sm text-fg-muted">
          Not decided yet — this stage hasn&apos;t been played.
        </p>
      ) : !stage.entered ? (
        <p className="mt-3 text-sm text-fg-muted">You didn&apos;t pick any games in this stage.</p>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-overlay/70 px-4 py-3">
            <span className="text-xs uppercase tracking-[0.2em] text-fg-muted">Overall</span>
            <Placement {...stage.overall} />
          </div>
          <div className="flex items-center justify-between gap-2 px-1 text-sm">
            <span className="text-fg-subtle">Your points</span>
            <span className="font-led tabular-nums text-fg">{stage.points}</span>
          </div>

          {stage.groups.length > 0 ? (
            <div className="space-y-1.5">
              <p className="px-1 text-xs uppercase tracking-[0.2em] text-fg-muted">Your groups</p>
              {stage.groups.map((g) => (
                <div
                  key={g.groupId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-overlay/50 px-4 py-2.5"
                >
                  <span className="min-w-0 truncate text-sm text-fg">
                    {g.groupName}
                    {g.discriminator ? (
                      <span className="text-fg-subtle"> #{g.discriminator}</span>
                    ) : null}
                  </span>
                  <Placement rank={g.rank} total={g.total} topPercent={g.topPercent} medal={null} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TrophyCabinet({ username }) {
  const request = useRequest();
  const [cabinet, setCabinet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    request(`/api/users/${encodeURIComponent(username)}/trophy-cabinet`)
      .then((data) => {
        if (!cancelled) setCabinet(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load the trophy cabinet');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request, username]);

  if (loading && !cabinet) {
    return <p className="text-sm text-fg-muted">Loading trophy cabinet…</p>;
  }
  if (error) {
    return (
      <p className="rounded-3xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
        {error}
      </p>
    );
  }
  if (!cabinet) return null;

  if (!cabinet.tournament || cabinet.stages.length === 0) {
    return (
      <EmptyState
        icon={TROPHY_ICON}
        title="No tournament yet"
        description="The Trophy Cabinet fills up once World Cup games are played. Check back during the tournament."
      />
    );
  }

  return (
    <div className="space-y-4">
      <ShowcaseHeader cabinet={cabinet} />
      <div className="grid gap-3 md:grid-cols-2">
        {cabinet.stages.map((stage) => (
          <StageCard key={stage.stage} stage={stage} />
        ))}
      </div>
    </div>
  );
}

export default TrophyCabinet;
