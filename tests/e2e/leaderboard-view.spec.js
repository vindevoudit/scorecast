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
const { getUserId, clearFriendships, createAcceptedFriendship } = require('./helpers/api');

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

  // The Friends block always includes the viewer, so the empty state is now
  // gated on the *friend* set: a user with no accepted friends sees the
  // "add friends" nudge rather than a lone self-row.
  await expect(page.getByText('No friends on the leaderboard yet').first()).toBeVisible({
    timeout: 10_000,
  });
});

test('Friends sub-tab lists the viewer + an accepted friend', async ({ page }) => {
  // The Friends tab now reads the server-side friends block (the viewer + all
  // accepted friends), so a friend appears regardless of the overall top-N
  // slice — the regression this fix targets.
  const aliceId = await getUserId(USERS.alice.username);
  const bobId = await getUserId(USERS.bob.username);
  await clearFriendships([aliceId, bobId]);
  await createAcceptedFriendship(aliceId, bobId);
  try {
    await loginViaUI(page, USERS.alice);
    await page
      .getByRole('tab', { name: /^Leaderboards$/ })
      .first()
      .click();
    await leaderboardTablist(page).getByRole('tab', { name: 'Friends', exact: true }).click();

    // bob (the friend) appears as a clickable leaderboard row.
    await expect(
      page.locator('button:not([aria-haspopup]):has-text("' + USERS.bob.username + '")').first(),
    ).toBeVisible({ timeout: 10_000 });
    // alice's own row is marked "you".
    await expect(page.getByText('you', { exact: true }).first()).toBeVisible();
  } finally {
    await clearFriendships([aliceId, bobId]);
  }
});
