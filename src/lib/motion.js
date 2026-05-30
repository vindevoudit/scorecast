// Tier 30 Phase 2 — curated re-exports of the motion/react surface we
// actually use. Imports come through this module (not directly from
// `motion/react`) so:
//
//  1. ESLint can lint a single canonical import path.
//  2. We catch accidental `<motion.div>` (full lazy bundle) vs `<m.div>`
//     (strict LazyMotion) usage at review time.
//  3. Future migrations off motion/react land in one file.
//
// LazyMotion strict mode is wired up in src/main.jsx — see that file for
// the bundle-size rationale (~12 KB gzip in its own code-split chunk).
//
// Consumer pattern:
//   import { m, AnimatePresence } from '../lib/motion';
//   import { scoreboardFlip } from '../lib/motionVariants';
//   <AnimatePresence mode="popLayout">
//     <m.span key={score} {...scoreboardFlip}>{score}</m.span>
//   </AnimatePresence>
export {
  m,
  AnimatePresence,
  LazyMotion,
  domAnimation,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion,
  useInView,
} from 'motion/react';
