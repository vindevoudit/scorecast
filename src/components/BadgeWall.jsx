// Tier 11 Chunk 2 — BadgeWall tokenized.
// Tier 30 Phase 3 A2 — progress bars + locked-but-visible redesign.
//
// Catalog entries with optional `threshold` + `metric` render a progress
// bar fed from `progress[metric]` (the badge progress map surfaced on
// self-view via the profile endpoint's `badgeProgress` field). When
// `progress` is null (other-user profile), bars are suppressed and the
// component falls back to plain earned/locked tiles.

function ProgressBar({ current, threshold }) {
  const clamped = Math.min(Math.max(current, 0), threshold);
  const pct = threshold > 0 ? Math.round((clamped / threshold) * 100) : 0;
  return (
    <div className="mt-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-overlay/80">
        <div
          className="h-full rounded-full bg-accent/70 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] font-semibold tabular-nums text-fg-muted">
        {current.toLocaleString()} / {threshold.toLocaleString()}
      </p>
    </div>
  );
}

function BadgeWall({ catalog = [], earned = [], progress = null }) {
  const earnedSet = new Set(earned.map((b) => b.slug));

  if (!catalog.length) {
    return <p className="text-sm text-fg-muted">No badges defined yet.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {catalog.map((badge) => {
        const isEarned = earnedSet.has(badge.slug);
        // Show the progress bar only on self-view (progress != null), only
        // for catalog entries that opted in via threshold + metric, and only
        // while still locked. Earned badges drop the bar — the tile colour
        // already communicates "done".
        const showBar =
          !isEarned &&
          progress &&
          typeof badge.threshold === 'number' &&
          typeof badge.metric === 'string';
        const current = showBar ? Number(progress[badge.metric] || 0) : 0;
        return (
          <div
            key={badge.slug}
            title={badge.description}
            className={`rounded-3xl border p-4 text-center transition duration-200 ${
              isEarned
                ? 'border-accent/40 bg-accent/10 text-fg'
                : 'border-default bg-overlay/60 text-fg-subtle'
            }`}
          >
            <div className={`text-3xl ${isEarned ? '' : 'grayscale'}`}>{badge.emoji}</div>
            <p className="mt-2 text-sm font-semibold">{badge.name}</p>
            <p className="mt-1 text-xs text-fg-muted">{badge.description}</p>
            {showBar ? <ProgressBar current={current} threshold={badge.threshold} /> : null}
          </div>
        );
      })}
    </div>
  );
}

export default BadgeWall;
