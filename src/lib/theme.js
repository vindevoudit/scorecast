// Tier 11 Chunk 1 — Theming infrastructure.
//
// Three theme modes — 'system' (default, follows OS), 'light', 'dark' —
// persisted to localStorage.sc_theme. `applyTheme()` writes
// `data-theme="dark"` or `data-theme="light"` on <html>; the actual color
// tokens live as CSS variables in [src/index.css](src/index.css).
//
// To prevent a flash of wrong theme on boot, call `applyTheme(getStoredTheme())`
// SYNCHRONOUSLY in [src/main.jsx](src/main.jsx) before ReactDOM.render(). Do
// not move it inside a useEffect.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'sc_theme';
const VALID_THEMES = ['system', 'light', 'dark'];

// What was the user's last explicit choice? Returns 'system' if unset or invalid.
export function getStoredTheme() {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return VALID_THEMES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function setStoredTheme(theme) {
  if (typeof window === 'undefined') return;
  if (!VALID_THEMES.includes(theme)) return;
  try {
    if (theme === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // private-mode browsers can throw; ignore
  }
}

// Resolve 'system' to the OS preference. Always returns 'light' or 'dark'.
export function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// Apply the resolved theme to <html>. Briefly suppresses transitions to
// avoid a half-themed flash on toggle.
export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(theme);
  const html = document.documentElement;

  html.classList.add('theme-switching');
  html.setAttribute('data-theme', resolved);

  // Force a reflow so the transition: none from .theme-switching applies
  // before we strip the class. Without this the class lifetime is a no-op.
  void html.offsetHeight;

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      html.classList.remove('theme-switching');
    });
  });
}

// React hook. Returns { theme, setTheme, resolvedTheme }.
// `theme` is the user's stored preference ('system' | 'light' | 'dark').
// `resolvedTheme` is the OS-aware effective theme ('light' | 'dark').
export function useTheme() {
  const [theme, setThemeState] = useState(getStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(getStoredTheme()));

  // Listen for OS theme changes when we're in 'system' mode.
  useEffect(() => {
    if (theme !== 'system') return undefined;
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const next = resolveTheme('system');
      setResolvedTheme(next);
      applyTheme('system');
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = (next) => {
    if (!VALID_THEMES.includes(next)) return;
    setStoredTheme(next);
    setThemeState(next);
    setResolvedTheme(resolveTheme(next));
    applyTheme(next);
  };

  return { theme, setTheme, resolvedTheme };
}
