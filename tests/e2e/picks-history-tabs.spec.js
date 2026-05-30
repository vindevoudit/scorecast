'use strict';

// Tier 30 Phase 1 Chunk 1.3 — PicksHistory's Mine/Friends segmented toggle
// was promoted to the shared SubTabs primitive. The mode survives a URL
// share, and the filter rail (Status + League/Season) lifted above the
// SubTabs since both filters apply to both modes. The Friend dropdown
// stays inside the Friends sub-tab content.
// Phase 1 follow-up — sidebar entry is now "Picks" (was "Your History"
// with kicker "My Picks"); the Friends sub-tab dropped its apostrophe.
// Sub-tab "Friends" collides with the sidebar "Friends" entry so we
// scope every sub-tab query to the SubTabs tablist `aria-label`.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { USERS } = require('./fixtures/data');

function picksTablist(page) {
  return page.locator('[role="tablist"][aria-label="Pick source"]');
}

test('PicksHistory mounts Mine / Friends sub-tabs; URL syncs', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await page
    .getByRole('tab', { name: /^Picks$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Picks', level: 2 })).toBeVisible({
    timeout: 10_000,
  });

  const mineTab = picksTablist(page).getByRole('tab', { name: 'Mine', exact: true });
  const friendsTab = picksTablist(page).getByRole('tab', { name: 'Friends', exact: true });
  await expect(mineTab).toBeVisible();
  await expect(friendsTab).toBeVisible();
  // Mine is the default — SubTabs.defaultValue.
  await expect(mineTab).toHaveAttribute('data-state', 'active');

  // Click Friends → URL gains ?tab=friends; the Friend dropdown is visible.
  await friendsTab.click();
  await expect(page).toHaveURL(/\?tab=friends/);
  await expect(friendsTab).toHaveAttribute('data-state', 'active');
  await expect(page.getByText(/^Friend$/, { exact: false }).first()).toBeVisible();

  // Back to Mine → URL flips to ?tab=mine.
  await mineTab.click();
  await expect(page).toHaveURL(/\?tab=mine/);
});

test('Status filter applies to both Mine and Friends', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await page
    .getByRole('tab', { name: /^Picks$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Picks', level: 2 })).toBeVisible({
    timeout: 10_000,
  });

  // The shared filter rail sits above the SubTabs. Default is "All".
  // Clicking the Wins pill should propagate into both sub-tabs.
  const winsPill = page.getByRole('tab', { name: 'Wins' });
  await winsPill.click();
  await expect(winsPill).toHaveAttribute('aria-selected', 'true');
  // Switch sub-tabs and confirm Wins is still active.
  await picksTablist(page).getByRole('tab', { name: 'Friends', exact: true }).click();
  await expect(winsPill).toHaveAttribute('aria-selected', 'true');
});

test('Deep-link /?view=mypicks&tab=friends lands on Friends sub-tab', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await page.goto('/?view=mypicks&tab=friends');

  await expect(page.getByRole('heading', { name: 'Picks', level: 2 })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    picksTablist(page).getByRole('tab', { name: 'Friends', exact: true }),
  ).toHaveAttribute('data-state', 'active');
  // `view` is stripped by consumeDeepLinks; `tab` survives as SubTabs' URL
  // writer key.
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('friends');
});
