'use strict';

// Tier 30 Phase 1 Chunk 1.2 — FriendsView surface invariants.
//
//   1. Sidebar entry "Social Friends" navigates to the new FriendsView.
//   2. All 3 sub-tabs render (All / Requests / Find people) + URL syncs
//      via `?tab=<id>`.
//   3. Anon visitors do NOT see the Friends sidebar entry.
//   4. Legacy deep-link redirect: `/?view=groups` with no groupId routes
//      to the Friends view (covers in-flight pre-Phase-1 notifications).
//   5. New deep-link: `/?view=friends&tab=requests` lands on the Requests
//      sub-tab directly (covers the post-Phase-1 friend-request producer).

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { clearFriendships, getUserId } = require('./helpers/api');
const { USERS } = require('./fixtures/data');

let aliceId;
let bobId;

test.beforeAll(async () => {
  aliceId = await getUserId(USERS.alice.username);
  bobId = await getUserId(USERS.bob.username);
});

test.beforeEach(async () => {
  if (aliceId && bobId) await clearFriendships([aliceId, bobId]);
});

test.afterAll(async () => {
  if (aliceId && bobId) await clearFriendships([aliceId, bobId]);
});

test('Sidebar → Social Friends opens FriendsView with All sub-tab default', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await page
    .getByRole('tab', { name: /Social Friends/ })
    .first()
    .click();
  // FriendsView card heading is the level-2 "Friends".
  await expect(page.getByRole('heading', { name: 'Friends', level: 2 })).toBeVisible({
    timeout: 10_000,
  });
  // All sub-tab default → the level-3 "Friends" section heading is rendered
  // (even when empty, the EmptyState card replaces the list).
  await expect(page.getByRole('tab', { name: 'All', exact: true })).toBeVisible();
});

test('Friends sub-tabs render + ?tab= URL syncs on click', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await page
    .getByRole('tab', { name: /Social Friends/ })
    .first()
    .click();

  const allTab = page.getByRole('tab', { name: 'All', exact: true });
  const requestsTab = page.getByRole('tab', { name: 'Requests', exact: true });
  const findTab = page.getByRole('tab', { name: 'Find people', exact: true });

  await expect(allTab).toBeVisible();
  await expect(requestsTab).toBeVisible();
  await expect(findTab).toBeVisible();

  // Switch sub-tabs → URL gains `?tab=<id>`.
  await requestsTab.click();
  await expect(page).toHaveURL(/\?tab=requests/);
  await findTab.click();
  await expect(page).toHaveURL(/\?tab=find/);
  // The Find people sub-tab mounts the search input.
  await expect(page.locator('#friend-search')).toBeVisible();
});

test('anon visitors do NOT see the Friends sidebar entry', async ({ page }) => {
  // Land on the marketing page → click "Or just browse as a guest" CTA to
  // enter anon dashboard mode.
  await page.goto('/');
  await page
    .getByRole('button', { name: /browse as a guest/i })
    .first()
    .click();

  // Anon sidebar should NOT include the Friends tab.
  await expect(page.getByRole('tab', { name: /Social Friends/ })).toHaveCount(0);
  // Other anon tabs remain (Games / Groups / Leaderboards). Spot-check Games.
  await expect(page.getByRole('tab', { name: /Upcoming Matches/ }).first()).toBeVisible();
});

test('legacy /?view=groups (no groupId) redirects to FriendsView', async ({ page }) => {
  // Simulates an in-flight pre-Phase-1 friend-request notification click,
  // which produced `link: '/?view=groups'`. DataContext.consumeDeepLinks
  // redirects to the new Friends view since there's no groupId target.
  await loginViaUI(page, USERS.alice);
  await page.goto('/?view=groups');

  await expect(page.getByRole('heading', { name: 'Friends', level: 2 })).toBeVisible({
    timeout: 10_000,
  });
  // The `view` param is stripped by consumeDeepLinks.
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBeNull();
});

test('post-Phase-1 friend-request link /?view=friends&tab=requests lands on Requests', async ({
  page,
}) => {
  // Matches the new producer in routes/friends.js. The Friends tab opens
  // AND the Requests sub-tab is auto-selected by SubTabs reading `?tab=`.
  await loginViaUI(page, USERS.alice);
  await page.goto('/?view=friends&tab=requests');

  await expect(page.getByRole('heading', { name: 'Friends', level: 2 })).toBeVisible({
    timeout: 10_000,
  });
  // The Requests sub-tab is data-state="active". Empty state renders when
  // there are no requests yet (cleared in beforeEach).
  const requestsTab = page.getByRole('tab', { name: 'Requests', exact: true });
  await expect(requestsTab).toHaveAttribute('data-state', 'active');
  // `view` param stripped; `tab` survives as part of the SubTabs URL writer.
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('requests');
});
