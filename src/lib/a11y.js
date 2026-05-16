// Tier 11 Chunk 4 — Accessibility hooks.
//
// Three small hooks consumed by the layout shell + motion-sensitive UI.
// Centralised here so future a11y work has a single home.

import { useEffect, useState } from 'react';

// Returns `true` when the user has requested reduced motion via OS settings
// (`prefers-reduced-motion: reduce`). Components with non-trivial motion
// (tour slide-in, modal animations) can skip the animation entirely on top
// of the global `* { animation-duration: 0.01ms !important }` rule in
// index.css.
//
// SSR-safe: returns `false` on the server (no document/window).
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

// Moves focus to the element matching `selector` whenever `key` changes.
// Used by the layout shell to announce view changes to screen-reader users
// (focus jumps to the new <main>'s heading so the page context refreshes).
//
// - selector: CSS selector resolved at focus time (e.g. 'main h1, main h2')
// - key: any primitive; focus moves on transition
//
// Does NOT focus on initial mount (the page load already has its own focus
// behavior). Only acts on subsequent changes.
export function useFocusOnRouteChange(selector, key) {
  const initial = useStablePrev(key);
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (typeof document === 'undefined') return;
    // Defer one frame so the new view has had a chance to render its heading.
    const id = requestAnimationFrame(() => {
      const el = document.querySelector(selector);
      if (el && typeof el.focus === 'function') {
        // Make the target focusable if it isn't already. -1 keeps it out of
        // the tab order; the focus() call still works.
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: false });
      }
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// Internal: tracks "is this the first render?" without recomputing.
function useStablePrev(_key) {
  const ref = useStableRef(true);
  return ref;
}

function useStableRef(initial) {
  const [ref] = useState(() => ({ current: initial }));
  return ref;
}
