# ScoreCast / Bantryx accessibility

Bantryx targets [WCAG 2.1 AA](https://www.w3.org/WAI/WCAG21/quickref/?versions=2.1&levels=aa) for both light and dark themes. This document captures the standards the app is built against, what has been verified, and the known gaps. If you spot an issue, please open a GitHub issue with the label `a11y`.

## Standards followed

- **Semantic HTML landmarks.** Each view renders a single `<main id="main">`; the sidebar wraps its primary navigation in `<nav aria-label="Primary navigation">`. The skip-to-content link in the top-left jumps focus to `#main`.
- **Keyboard navigation.** Every interactive control is reachable via Tab; modals + dropdowns (ConfirmModal, SignInModal, ProfileDrawer, UserMenu, NotificationBell, ThemeToggle, SearchBar) trap focus while open and return focus to the trigger on close. Escape closes the topmost open overlay; the mobile sidebar drawer defers to a stacked modal so the modal closes first.
- **ARIA states + roles.** Sidebar tabs carry `role="tab"` + `aria-selected` + `aria-current="page"` on the active item. Icon-only buttons (hamburger, sidebar collapse, mobile search, notification bell, back-to-landing pill, dialog close) all have `aria-label`s; decorative icons (avatar initial, brand wordmark, in-button SVGs) carry `aria-hidden="true"`. Inline form errors render with `role="alert"` so screen readers announce them.
- **Touch targets.** Every interactive control is at least 44×44 px (Apple HIG floor). Pick buttons, sidebar collapse, mobile drawer close, and the notification pill were specifically audited in Tier 11 Chunk 3.
- **Color contrast.** Body text targets 4.5:1, large + UI text targets 3:1. The accent token darkens to cyan-600 in light mode to maintain contrast on near-white surfaces.
- **Reduced motion.** A global `prefers-reduced-motion: reduce` rule in [src/index.css](src/index.css) clamps all animation/transition durations to 0.01 ms. The onboarding tour additionally consults `useReducedMotion()` and disables its Radix dialog animation when set.
- **iOS focus zoom.** Form inputs use `font-size: 16px` on viewports < 768 px to prevent Safari's auto-zoom on focus.
- **Safe areas.** The app shell respects `env(safe-area-inset-*)` on iOS notch + home-indicator devices.

## What is verified

- Manual keyboard navigation through the dashboard's primary flows (games → pick → leaderboard → groups → profile → admin) in both light and dark mode.
- Playwright suite (15 specs) exercises every action via accessible-name selectors (`getByRole`), which would fail if essential labels were missing.
- The mobile-screenshot project ([tests/e2e/screenshots/](tests/e2e/screenshots/)) renders every key view on three real device profiles (iPhone SE / iPhone 13 / Pixel 5).

## Known gaps

- **No axe-core/react in dev yet.** Planned as a Tier 11 Chunk 4 follow-up. Once wired, it will log a11y violations to the browser console on every render in dev.
- **No automated WCAG contrast audit.** Manual spot-checks have been done; an automated Lighthouse / pa11y pass is on the backlog.
- **Onboarding tour does not yet anchor to specific DOM elements.** The 4 steps render as centered modals; a future enhancement could position each step near the GameCard pick button / sidebar tab it references.
- **AuthView's branched returns now share a `<main id="main">` wrapper** (Tier 11 Chunk 4) — earlier branches that returned components directly are wrapped. If you add a new branch, make sure it returns inside the shared `<main>`.

## How to report an a11y issue

Open a GitHub issue at [github.com/anthropics/...](https://github.com) (or whichever repository you cloned this from) with the `a11y` label. Include:

- The browser + assistive technology you were using
- A short reproduction (URL or view + action)
- Expected vs actual behavior
- A screenshot or screen-reader transcript if possible
