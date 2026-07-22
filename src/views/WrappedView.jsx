// World Cup Aftermatch (user-facing name; code keeps `wrapped`) — the sidebar
// entry (self view). Fetches /api/me/wrapped
// (self-only) and renders a launch tile; pressing Play mounts the full-screen
// <WrappedStory />. When the user has no scored World Cup picks yet, an empty
// state invites them to make some. Follows the TrophyCabinetView pattern; it's
// lazy-loaded by DashboardView so its chunk only ships when opened.

import { useEffect, useState } from 'react';
import { useRequest } from '../hooks/useRequest';
import { useAuth } from '../hooks/useAuth';
import EmptyState from '../components/EmptyState';
import WrappedStory from '../components/wrapped/WrappedStory';

const SPARKLE_ICON = (
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
    <path d="M12 3l1.8 4.9L18.7 9.7 13.8 11.5 12 16.4 10.2 11.5 5.3 9.7 10.2 7.9z" />
    <path d="M19 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
    <path d="M5 15l.6 1.6L7.2 17l-1.6.6L5 19.2 4.4 17.6 2.8 17l1.6-.4z" />
  </svg>
);

function WrappedView() {
  const request = useRequest();
  const { user } = useAuth();
  const [wrapped, setWrapped] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    request('/api/me/wrapped')
      .then((data) => {
        if (!cancelled) setWrapped(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load your Aftermatch');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request, user]);

  if (!user) return null;

  if (loading && !wrapped) {
    return <p className="text-sm text-fg-muted">Loading your Aftermatch…</p>;
  }
  if (error) {
    return (
      <p className="rounded-3xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
        {error}
      </p>
    );
  }
  if (!wrapped) return null;

  const tournamentName = wrapped.tournament?.name || 'World Cup 2026';

  if (!wrapped.hasData) {
    return (
      <EmptyState
        icon={SPARKLE_ICON}
        title="Your Aftermatch is warming up"
        description={`Make some ${tournamentName} predictions — once your picks are settled, your Aftermatch unlocks here.`}
      />
    );
  }

  return (
    <div className="motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
      <div className="bg-stadium-vignette relative overflow-hidden rounded-3xl border border-default bg-elevated/80 p-8 text-center shadow-glow">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-overlay/70 text-accent">
          {SPARKLE_ICON}
        </div>
        <p className="text-xs uppercase tracking-[0.3em] text-accent/80">Bantryx</p>
        <h2 className="mt-2 text-3xl font-semibold text-fg sm:text-4xl">
          Your {tournamentName} Aftermatch
        </h2>
        <p className="mx-auto mt-3 max-w-md text-fg-muted">
          {wrapped.summary.points.toLocaleString('en-US')} points · {wrapped.summary.picks}{' '}
          prediction{wrapped.summary.picks === 1 ? '' : 's'}. Relive your tournament, one moment at
          a time.
        </p>
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-accent px-7 py-3 font-semibold text-accent-fg shadow-brand-glow-strong hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
          Play
        </button>
      </div>

      {playing ? <WrappedStory wrapped={wrapped} onClose={() => setPlaying(false)} /> : null}
    </div>
  );
}

export default WrappedView;
