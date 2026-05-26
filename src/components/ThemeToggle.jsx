// Tier 11 Chunk 1 — Theme toggle.
// Tier 11 Chunk 3 — Reduced to a Light/Dark binary (System removed) and
// added sun/moon icons next to each label. Lives in the ProfileView
// Appearance section.

import { useTheme } from '../lib/theme';

function SunIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    // Tier 19 Chunk 4c — toggle stretches to its row's full width on mobile
    // (where the Appearance card uses `flex-col` and the toggle sat as a
    // small left-aligned pill), then collapses to its natural inline width
    // on `sm+` where the card is `flex-row` and `justify-between` does the
    // alignment work. Each radio button gets `flex-1 sm:flex-none` to share
    // the stretched row evenly without breaking desktop layout.
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex w-full items-center gap-1 rounded-2xl border border-default bg-elevated/60 p-1 sm:inline-flex sm:w-auto"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={[
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex-none',
              active ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default ThemeToggle;
