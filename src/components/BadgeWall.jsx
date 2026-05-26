// Tier 11 Chunk 2 — BadgeWall tokenized.

function BadgeWall({ catalog = [], earned = [] }) {
  const earnedSet = new Set(earned.map((b) => b.slug));

  if (!catalog.length) {
    return <p className="text-sm text-fg-muted">No badges defined yet.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {catalog.map((badge) => {
        const isEarned = earnedSet.has(badge.slug);
        return (
          <div
            key={badge.slug}
            title={badge.description}
            className={`rounded-3xl border p-4 text-center transition duration-200 ${
              isEarned
                ? 'border-accent/40 bg-accent/10 text-fg'
                : 'border-default bg-overlay/60 text-fg-subtle grayscale'
            }`}
          >
            <div className="text-3xl">{badge.emoji}</div>
            <p className="mt-2 text-sm font-semibold">{badge.name}</p>
            <p className="mt-1 text-xs text-fg-muted">{badge.description}</p>
          </div>
        );
      })}
    </div>
  );
}

export default BadgeWall;
