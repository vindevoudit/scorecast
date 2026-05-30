// Tier 30 Phase 2 — named motion variants.
//
// Each export is a plain object compatible with motion/react's variants /
// transition / props API. Lifting them out of the components keeps the
// JSX readable AND lets multiple surfaces share a tempo (e.g. the same
// spring shape used for sidebar tab indicator + leaderboard row shimmer
// stays in sync without copy-paste drift).
//
// Conventions:
//  - Easing curves use the `out-expo` cubic from tailwind.config.js
//    (`cubic-bezier(0.16, 1, 0.3, 1)`) — feels like the page is settling
//    rather than snapping. Springs are reserved for hover/burst surfaces.
//  - `prefers-reduced-motion` is handled at consumer level via
//    `useReducedMotion()` (motion/react) — variants below assume motion
//    is on; the consumer short-circuits the animate prop when it isn't.

const easeOutExpo = [0.16, 1, 0.3, 1];

/**
 * Landing hero — parent timeline that orchestrates a staggered reveal of
 * kicker, wordmark, slogan, and CTAs. Pair with `heroRevealItem` on each
 * child. The `delayChildren` gives the wordmark a beat to land before the
 * surrounding chrome catches up.
 */
export const heroRevealTimeline = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.16,
      delayChildren: 0.08,
    },
  },
};

/**
 * Landing hero child variants. Fade-up 16 px with a half-second out-expo
 * decelerator. Used by the kicker, slogan, stat strip, and CTA buttons.
 */
export const heroRevealItem = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: easeOutExpo },
  },
};

/**
 * BANTRYX wordmark — heavier reveal than `heroRevealItem`. Scales from 0.92,
 * unblurs from 8 px, and rides a longer duration so the glow has time to
 * bloom in. Lives in the same parent timeline so the kicker lands first.
 */
export const heroWordmark = {
  hidden: { opacity: 0, scale: 0.92, filter: 'blur(8px)' },
  visible: {
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.9, ease: easeOutExpo },
  },
};

/**
 * Stats grid count-up transition. Passed as the second arg to
 * `animate(motionValue, target, transition)`. Long enough to read each
 * tick, not so long that the user notices the wait.
 */
export const statsCountUp = {
  duration: 1.4,
  ease: easeOutExpo,
};

/**
 * Feature-card hover spring. Lifts the card 4 px and scales 1.02×.
 * Reserved for marketing surfaces (Landing feature grid) — game/leaderboard
 * cards stay still because the user is reading, not browsing.
 */
export const featureCardHover = {
  scale: 1.02,
  y: -4,
  transition: { type: 'spring', stiffness: 220, damping: 22 },
};

/**
 * Pick confirmation burst — single dot particle. Consumers render six
 * `<m.span>` instances with different `--angle` CSS custom properties
 * so the burst fans out. Exit at scale 1.6 to fade through transparency.
 */
export const pickConfirmBurst = {
  initial: { opacity: 0, scale: 0 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 1.6 },
  transition: { duration: 0.55, ease: 'easeOut' },
};

/**
 * Scoreboard flip — used inside `<AnimatePresence mode="popLayout">` on
 * the GameCard score digits so a new score rotates in along the X axis
 * while the old one rotates out. Keyed by the rendered score value so
 * the same number doesn't re-trigger on render.
 */
export const scoreboardFlip = {
  initial: { opacity: 0, rotateX: -90 },
  animate: { opacity: 1, rotateX: 0 },
  exit: { opacity: 0, rotateX: 90 },
  transition: { duration: 0.32, ease: easeOutExpo },
};

/**
 * Badge unlock — spring-in for the leaderboard / badge-wall row mount
 * after a new badge is earned. Stiffness chosen so the bounce reads as
 * "achievement landed" without overshooting into noisy territory.
 */
export const badgeUnlockBurst = {
  initial: { opacity: 0, scale: 0.6 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 260, damping: 18 },
  },
};

/**
 * Sidebar active-tab indicator — `<m.div layoutId="sidebar-active-indicator">`
 * picks this transition up automatically. Faster spring than the feature
 * card hover because nav feedback wants to feel instantaneous.
 */
export const sidebarTabIndicator = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
};
