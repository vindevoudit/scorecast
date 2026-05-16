// Tier 11 Chunk 1 — Theme toggle. Segmented-control style: System | Light |
// Dark. Lives in ProfileView Settings post-Chunk 2; until then it can be
// dropped anywhere for ad-hoc verification.

import { useTheme } from '../lib/theme';

const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-1 rounded-2xl border border-default bg-elevated/60 p-1"
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(opt.value)}
            className={[
              'rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              active ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default ThemeToggle;
