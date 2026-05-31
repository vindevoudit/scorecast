// Tier 11 Chunk 2 — EmptyState. Tokenized + optional `icon` slot for the
// states pass in Wave F.
//
// Tier 30 Phase 2 — when no `icon` is passed, render the default stadium
// silhouette below (a simple grandstand mark). Stroke-only currentColor
// glyph; inherits text-fg-subtle so it reads as quiet structure above
// the headline without competing with it. Callers that want a different
// icon (Wave F per-surface art) still override via the icon prop.

const STADIUM_ICON = (
  <svg
    viewBox="0 0 40 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-10 w-16"
  >
    {/* Pitch line */}
    <path d="M2 21h36" />
    {/* Grandstand silhouette — two angled sections */}
    <path d="M3 21l4-7h26l4 7" />
    {/* Floodlight masts */}
    <path d="M7 14V8M33 14V8" />
    {/* Lights */}
    <circle cx="7" cy="7" r="1" fill="currentColor" />
    <circle cx="33" cy="7" r="1" fill="currentColor" />
    {/* Centre circle */}
    <circle cx="20" cy="21" r="2.6" />
  </svg>
);

function EmptyState({ title, description, action, icon }) {
  const renderedIcon = icon === undefined ? STADIUM_ICON : icon;
  return (
    <div className="rounded-3xl border border-dashed border-default bg-elevated/50 px-6 py-10 text-center">
      {renderedIcon ? (
        <div className="mx-auto mb-3 flex items-center justify-center text-fg-subtle">
          {renderedIcon}
        </div>
      ) : null}
      <p className="text-base font-semibold text-fg">{title}</p>
      {description ? <p className="mt-2 text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
