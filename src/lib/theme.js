// Tier 11 Chunk 1 — Theming infrastructure.
// Tier 11 Chunk 3 — System mode removed; the toggle is now an explicit
// Light/Dark binary. Dark stays the default (matches the brand). Legacy
// 'system' values stored in localStorage normalize to 'dark' on read.
//
// Theme modes — 'light', 'dark' — persisted to localStorage.sc_theme.
// `applyTheme()` writes `data-theme="dark"` or `data-theme="light"` on
// <html>; the actual color tokens live as CSS variables in
// [src/index.css](src/index.css).
//
// To prevent a flash of wrong theme on boot, call `applyTheme(getStoredTheme())`
// SYNCHRONOUSLY in [src/main.jsx](src/main.jsx) before ReactDOM.render(). Do
// not move it inside a useEffect.

import { useState } from 'react';

const STORAGE_KEY = 'sc_theme';
const VALID_THEMES = ['light', 'dark'];
const DEFAULT_THEME = 'dark';

// What was the user's last explicit choice? Returns the default ('dark') if
// unset or invalid. Legacy 'system' values (from before the system mode was
// removed) also fall through to the default.
export function getStoredTheme() {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return VALID_THEMES.includes(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function setStoredTheme(theme) {
  if (typeof window === 'undefined') return;
  if (!VALID_THEMES.includes(theme)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // private-mode browsers can throw; ignore
  }
}

// Coerce to a valid theme. Always returns 'light' or 'dark'.
export function resolveTheme(theme) {
  return theme === 'light' ? 'light' : 'dark';
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
// `theme` is the user's stored preference ('light' | 'dark').
// `resolvedTheme` matches `theme` — kept as a separate value for API stability
// (callers that read `resolvedTheme` from the previous system-aware version
// keep working without changes).
export function useTheme() {
  const [theme, setThemeState] = useState(getStoredTheme);

  const setTheme = (next) => {
    if (!VALID_THEMES.includes(next)) return;
    setStoredTheme(next);
    setThemeState(next);
    applyTheme(next);
  };

  return { theme, setTheme, resolvedTheme: theme };
}
