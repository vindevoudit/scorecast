// Tier 30 Phase 2 — custom inline SVG icons for the Landing feature cards.
// Replaces the four emoji previously used (🎯 👥 🏆 🎖️) so the icons read
// as a consistent stroke-weight system instead of a colour mishmash that
// the OS chooses. Each glyph is stroke-only (currentColor) so the parent
// plaque controls the colour via the accent token — light + dark themes
// both get correct contrast for free.
//
// Render shape: a 48×48 plaque (rounded-xl border + bg-overlay) hosting a
// 28×28 SVG glyph. Consumers pass `name` matching one of the icon ids
// below.

const ICONS = {
  target: (
    <svg
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  ),
  group: (
    <svg
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="8.5" r="3" />
      <circle cx="17" cy="9.5" r="2.5" />
      <path d="M3 19c0-3 2.8-5 6-5s6 2 6 5" />
      <path d="M15 19c0-2.2 1.8-4 4-4s4 1.5 4 4" />
    </svg>
  ),
  trophy: (
    <svg
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
      <path d="M8 6H5a3 3 0 0 0 3 4" />
      <path d="M16 6h3a3 3 0 0 1-3 4" />
      <path d="M12 13v3" />
      <path d="M9 20h6" />
      <path d="M10 16h4l-0.5 4h-3z" />
    </svg>
  ),
  medal: (
    <svg
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3l3 7m5-7l-3 7" />
      <circle cx="12" cy="15" r="5.5" />
      <path d="M12 12.5l0.9 1.8 2 0.3-1.45 1.4 0.35 2L12 17.05l-1.8 0.95 0.35-2L9.1 14.6l2-0.3z" />
    </svg>
  ),
};

function FeatureIcon({ name, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-default bg-overlay text-accent shadow-led ${className}`}
    >
      {ICONS[name] ?? null}
    </span>
  );
}

export default FeatureIcon;
