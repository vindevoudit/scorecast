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
const {
  getUserId,
  clearFriendships,
  createAcceptedFriendship,
  updateUserFields,
} = require('./helpers/api');

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

test('Leaderboard row shows the win-streak flame for a 3+ streak', async ({ page }) => {
  // Use the Friends sub-tab (uncached server block) so the freshly-set
  // streak is deterministic; a friendship makes the card render alice's row.
  const aliceId = await getUserId(USERS.alice.username);
  const bobId = await getUserId(USERS.bob.username);
  await clearFriendships([aliceId, bobId]);
  await createAcceptedFriendship(aliceId, bobId);
  await updateUserFields(aliceId, { currentWinStreak: 7 });
  try {
    await loginViaUI(page, USERS.alice);
    await page
      .getByRole('tab', { name: /^Leaderboards$/ })
      .first()
      .click();
    await leaderboardTablist(page).getByRole('tab', { name: 'Friends', exact: true }).click();
    // Scope to the leaderboard tabpanel so we assert the ROW chip, not the
    // top-bar UserMenu flame (which shows for any streak >= 1).
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByLabel('7-game win streak').first()).toBeVisible({ timeout: 10_000 });
  } finally {
    await updateUserFields(aliceId, { currentWinStreak: 0 });
    await clearFriendships([aliceId, bobId]);
  }
});

test('Leaderboard hides the flame for a streak below 3', async ({ page }) => {
  const aliceId = await getUserId(USERS.alice.username);
  const bobId = await getUserId(USERS.bob.username);
  await clearFriendships([aliceId, bobId]);
  await createAcceptedFriendship(aliceId, bobId);
  await updateUserFields(aliceId, { currentWinStreak: 2 });
  // Both users in the Friends panel must be below the >=3 flame gate. bob is
  // asserted to be flame-free, so reset his streak too — an earlier win-streak
  // spec (e.g. games.spec.js) can leave bob at a 3+ streak in the shared
  // (workers:1) DB, which would surface a stray row flame and false-fail this.
  await updateUserFields(bobId, { currentWinStreak: 0 });
  try {
    await loginViaUI(page, USERS.alice);
    await page
      .getByRole('tab', { name: /^Leaderboards$/ })
      .first()
      .click();
    await leaderboardTablist(page).getByRole('tab', { name: 'Friends', exact: true }).click();
    // Wait for the friends rows to render (bob is the friend), then assert no
    // flame chip is present in the leaderboard panel (alice's streak of 2 is
    // below the >=3 gate; bob's is 0). Scoped to the tabpanel so the top-bar
    // UserMenu flame — which DOES show alice's 2-streak — doesn't false-fail.
    const panel = page.getByRole('tabpanel');
    await expect(
      panel.locator('button:not([aria-haspopup]):has-text("' + USERS.bob.username + '")').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator('[aria-label$="-game win streak"]')).toHaveCount(0);
  } finally {
    await updateUserFields(aliceId, { currentWinStreak: 0 });
    await clearFriendships([aliceId, bobId]);
  }
});
