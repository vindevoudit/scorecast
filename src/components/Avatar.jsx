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
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        background: bg,
        border: `1px solid ${border}`,
        fontSize,
        lineHeight: 1,
      }}
    >
      {letter}
    </span>
  );
}

export default Avatar;
