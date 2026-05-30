function hashString(s) {
  let hash = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
}

function colorsFor(username) {
  const hash = hashString(username || '?');
  const hue = hash % 360;
  return {
    bg: `hsl(${hue}, 55%, 35%)`,
    border: `hsl(${hue}, 55%, 50%)`,
  };
}

function initial(name) {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase() || '?';
}

function Avatar({ username, displayName, size = 36, className = '' }) {
  const seed = (displayName || username || '?').toLowerCase();
  const { bg, border } = colorsFor(seed);
  const letter = initial(displayName || username);
  const fontSize = Math.round(size * 0.45);
  // Tier 30 Phase 2 — token-discipline cleanup. The previous `text-white`
  // Tailwind class violated the design-token invariant. The avatar's bg is
  // HSL(*, 55%, 35%) — mid-dark in BOTH themes — so a near-white
  // foreground reads correctly regardless of theme. Inline `color` lives
  // alongside the inline `background` (both theme-independent) instead of
  // routing through a non-existent token; `text-accent-fg` would resolve
  // to slate-950 in dark mode and be unreadable on the colored disk.
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        background: bg,
        border: `1px solid ${border}`,
        color: '#ffffff',
        fontSize,
        lineHeight: 1,
      }}
    >
      {letter}
    </span>
  );
}

export default Avatar;
