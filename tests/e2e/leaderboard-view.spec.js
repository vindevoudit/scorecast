'use strict';

// Tier 30 Phase 1 Chunk 1.3 — LeaderboardView sub-tabs (Overall /
// Groups / Friends). The previous side-by-side two-card layout collapses
// into a SubTabs primitive with the Friends sub-tab filtering Overall
// rows to the viewer + accepted-friend set, re-ranked locally.
// Phase 1 follow-up — sidebar entry is now "Leaderboards" (kicker dropped);
// sub-tab labels "Groups" + "Friends" collide with sidebar entries, so
// every sub-tab query is scoped to the `[aria-label="Leaderboard sections"]`
// tablist that SubTabs renders.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { USERS } = require('./fixtures/data');

function leaderboardTablist(page) {
  return page.locator('[role="tablist"][aria-label="Leaderboard sections"]');
}

test('Leaderboards sub-tabs render + URL syncs on click', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await page
    .getByRole('tab', { name: /^Leaderboards$/ })
    .first()
    .click();

  const overallTab = leaderboardTablist(page).getByRole('tab', { name: 'Overall', exact: true });
  const groupsTab = leaderboardTablist(page).getByRole('tab', { name: 'Groups', exact: true });
  const friendsTab = leaderboardTablist(page).getByRole('tab', { name: 'Friends', exact: true });

  await expect(overallTab).toBeVisible({ timeout: 10_000 });
  await expect(groupsTab).toBeVisible();
  await expect(friendsTab).toBeVisible();
  // Overall is the SubTabs default.
  await expect(overallTab).toHaveAttribute('data-state', 'active');

  // Click Groups → URL flips to ?tab=groups.
  await groupsTab.click();
  await expect(page).toHaveURL(/\?tab=groups/);
  await expect(groupsTab).toHaveAttribute('data-state', 'active');

  // Click Friends → URL flips to ?tab=friends.
  await friendsTab.click();
  await expect(page).toHaveURL(/\?tab=friends/);
  await expect(friendsTab).toHaveAttribute('data-state', 'active');
});

test('deep-link /?view=leaderboard&tab=friends lands on Friends sub-tab', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await page.goto('/?view=leaderboard&tab=friends');

  await expect(
    leaderboardTablist(page).getByRole('tab', { name: 'Friends', exact: true }),
  ).toHaveAttribute('data-state', 'active', { timeout: 10_000 });
  // `view` is stripped; `tab` survives.
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('friends');
});

test('Friends sub-tab empty state for users with no accepted friends', async ({ page }) => {
  await loginViaUI(page, USERS.bob);
  await page
    .getByRole('tab', { name: /^Leaderboards$/ })
    .first()
    .click();
  await leaderboardTablist(page).getByRole('tab', { name: 'Friends', exact: true }).click();

  // Either the empty state title shows (bob has no entry in the leaderboard
  // either) OR bob's own row appears (bob has points but no friends), per
  // the FriendsLeaderboardSection's two branches.
  const emptyOrSelf = page.locator(
    '[role="heading"][aria-level="3"]:has-text("No friends on the leaderboard yet"), button:not([aria-haspopup]):has-text("' +
      USERS.bob.username +
      '")',
  );
  await expect(emptyOrSelf.first()).toBeVisible({ timeout: 10_000 });
});
