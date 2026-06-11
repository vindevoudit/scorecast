'use strict';

// Phase 0 P0-6 — deep-link dead-entity toast. When a notification link or
// other deep-link URL references a game / group that no longer exists or
// the user can't see, DataContext.consumeDeepLinks fires a toast and
// strips the param instead of silently landing the user on an empty
// calendar day / unselected group sidebar.
//
// Hard to exercise via a notification round-trip without a teardown
// helper; here we navigate directly to a synthetic URL containing a
// bogus UUID and assert the toast fires.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { USERS } = require('./fixtures/data');

const BOGUS_UUID = '99999999-0000-4000-8000-999999999999';

test('?gameId=<bogus> on /?view=games → "That game is no longer available" toast + param stripped', async ({
  page,
}) => {
  await loginViaUI(page, USERS.alice);
  // Direct nav with the bogus param. DataContext.consumeDeepLinks runs
  // once in the loadDashboard().then() chain after games land.
  await page.goto(`/?view=games&gameId=${BOGUS_UUID}`);

  // Toast text from src/contexts/DataContext.jsx consumeDeepLinks. exact:true
  // so we match ONLY the visible toast, not the aria-live status region that
  // also announces "Notification That game is no longer available" (a
  // substring match would hit both and trip Playwright strict mode).
  await expect(page.getByText('That game is no longer available', { exact: true })).toBeVisible({
    timeout: 5_000,
  });

  // Param stripped from the URL (history.replaceState in consumeDeepLinks).
  await expect.poll(() => new URL(page.url()).searchParams.get('gameId')).toBeNull();
});

test('?groupId=<bogus> on /?view=groups → "That group is no longer available" toast', async ({
  page,
}) => {
  await loginViaUI(page, USERS.alice);
  await page.goto(`/?view=groups&groupId=${BOGUS_UUID}`);

  await expect(page.getByText('That group is no longer available', { exact: true })).toBeVisible({
    timeout: 5_000,
  });

  await expect.poll(() => new URL(page.url()).searchParams.get('groupId')).toBeNull();
});

test('no false-toast on a valid view=games deep-link (no gameId param)', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await page.goto('/?view=games');
  // The toast text should NEVER appear — there's no missing entity to flag.
  // Wait a beat for boot to settle, then assert it's still absent.
  await page.waitForTimeout(800);
  await expect(page.getByText('That game is no longer available', { exact: true })).toBeHidden();
  await expect(page.getByText('That group is no longer available', { exact: true })).toBeHidden();
});
