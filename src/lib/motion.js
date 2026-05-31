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

import { useEffect, useState } from 'react';
import {
  m,
  AnimatePresence,
  LazyMotion,
  domAnimation,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion as useReducedMotionRaw,
  useInView,
} from 'motion/react';

export {
  m,
  AnimatePresence,
  LazyMotion,
  domAnimation,
  useMotionValue,
  useTransform,
  animate,
  useInView,
};

// Tier 30 Phase 2 follow-up — `(min-width: 768px)` matchMedia hook.
// Tracks whether the viewport is desktop-sized (matches Tailwind's `md:`
// breakpoint). Subscribes to the change event so the value updates on
// orientation/window-resize without a full reload. SSR-safe: assumes
// desktop when `window` is undefined.
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 768px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (event) => setIsDesktop(event.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

// Tier 30 Phase 2 follow-up — wrapper around motion's `useReducedMotion`
// that ALSO returns `true` on mobile viewports. The user reported lag +
// Orbitron font-load issues on mobile and asked for Phase 2 visual
// changes to be desktop-only — composing the matchMedia check into the
// existing reduced-motion gate is the lightest-touch way to get every
// `if (reduceMotion) skipAnimation` consumer to also skip on mobile,
// without each call-site needing to know about the breakpoint. Future
// devs: this hook now means "should we skip motion?" rather than the
// strict OS-level prefers-reduced-motion — the rename would clarify but
// the consumer-side semantic is identical.
export function useReducedMotion() {
  const raw = useReducedMotionRaw();
  const isDesktop = useIsDesktop();
  return Boolean(raw) || !isDesktop;
}
