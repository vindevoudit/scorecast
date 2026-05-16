// Tier 11 Chunk 1 — design tokens wired through CSS custom properties.
//
// Every semantic name (`bg-base`, `text-fg-muted`, `border-default`, etc.)
// resolves to `rgb(var(--c-<name>) / <alpha-value>)` so utilities like
// `bg-base/80` continue to work. Variable definitions live in
// [src/index.css](src/index.css) under `:root` (dark) and
// `:root[data-theme='light']` (light).

const withAlpha = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        glow: 'var(--shadow-glow)',
      },
      colors: {
        // Legacy alias retained so existing references don't break during
        // Chunk 2's component migration. Resolves to bg-elevated.
        surface: withAlpha('bg-elevated'),

        // Semantic surface tokens — used as bg-base, bg-elevated, bg-overlay
        base: withAlpha('bg-base'),
        elevated: withAlpha('bg-elevated'),
        overlay: withAlpha('bg-overlay'),

        // Foreground text tokens — text-fg, text-fg-muted, text-fg-subtle
        fg: {
          DEFAULT: withAlpha('fg'),
          muted: withAlpha('fg-muted'),
          subtle: withAlpha('fg-subtle'),
        },

        // Accent (brand cyan) — text-accent, bg-accent, text-accent-soft, etc.
        accent: {
          DEFAULT: withAlpha('accent'),
          strong: withAlpha('accent-strong'),
          soft: withAlpha('accent-soft'),
          fg: withAlpha('accent-fg'),
        },

        // Divider — same RGB values as the border tokens, but exposed as
        // a color so `bg-divider` / `bg-divider-strong` resolve. Useful for
        // 1px-strip dividers (gap-px on a parent + colored bg).
        divider: {
          DEFAULT: withAlpha('border-default'),
          strong: withAlpha('border-strong'),
        },

        // Status
        success: withAlpha('success'),
        warning: withAlpha('warning'),
        danger: withAlpha('danger'),
        info: withAlpha('info'),
      },
      // Border tokens are extended separately so `border-default` /
      // `border-strong` resolve cleanly (Tailwind generates border-color
      // utilities from this map). The legacy palette is preserved via the
      // spread of theme('colors') so `border-slate-800` etc. keep working
      // during the Chunk 2 migration.
      borderColor: ({ theme }) => ({
        ...theme('colors'),
        DEFAULT: withAlpha('border-default'),
        default: withAlpha('border-default'),
        strong: withAlpha('border-strong'),
      }),
    },
  },
  plugins: [],
};
