'use strict';

// Helpers for navigating the GamesCalendar widget (Tier 18 Chunk 3).
//
// The widget defaults to TODAY's date chip. Fixture games sit at today+1
// through today+3 (see tests/e2e/fixtures/data.js `daysFromNow`), so a test
// that boots fresh and immediately searches for a game-card button finds
// nothing — today's chip renders an empty state.
//
// The widget reads `?date=YYYY-MM-DD` on mount and again on every
// `scorecast:url-changed` window event (Tier 20 follow-up: the in-app
// deep-link wakeup bridge). This helper drives the same path from a spec
// without a full page reload, so the existing auth session + dashboard
// state survive.

const { expect } = require('@playwright/test');

// en-CA produces the YYYY-MM-DD shape the widget compares against. Mirrors
// the dayKey() helper exported from src/hooks/useGames.js — kept in sync
// here so we don't need to load the bundle from a test.
function dayKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// Drive the calendar to the day a fixture game lives on. Accepts either a
// fixture object (`{ date: ISO string }`) or a raw Date / ISO string. After
// the wakeup the spec can assert against `Pick X to win` buttons safely.
async function selectGameDate(page, dateOrGame) {
  const target = dateOrGame?.date ?? dateOrGame;
  const key = dayKey(target);
  await page.evaluate((nextKey) => {
    // page.evaluate body runs in the browser; ESLint's Node env doesn't
    // know about `window` so guard with a disable.
    /* eslint-disable no-undef */
    const url = new URL(window.location.href);
    url.searchParams.set('date', nextKey);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    window.dispatchEvent(new CustomEvent('scorecast:url-changed'));
    /* eslint-enable no-undef */
  }, key);
  // Confirm the calendar honored the wakeup — the chip for the target day
  // should be aria-selected. Scope to the calendar's tablist (aria-label
  // "Pick a day") so we don't collide with the sidebar's "Dashboard
  // sections" tablist, where the Games tab is also aria-selected.
  // Bounded so a future widget rename surfaces here instead of as a
  // downstream "button not found" timeout.
  const calendar = page.getByRole('tablist', { name: 'Pick a day' });
  const chip = calendar.getByRole('tab', { selected: true });
  await expect(chip).toBeVisible({ timeout: 5_000 });
}

module.exports = { dayKey, selectGameDate };
