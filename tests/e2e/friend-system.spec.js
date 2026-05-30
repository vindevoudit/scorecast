'use strict';

// Tier 5.5b — friend request lifecycle: send → accept / decline / cancel.
// Tier 30 Phase 1 — Friends became a top-level sidebar surface (was inside
// the Groups tab). Each test now navigates to the new "Social Friends" tab
// then drives the three sub-tabs (All / Requests / Find people) as needed.
// Each test resets friendships between alice + bob via the DB helper so
// ordering across this file doesn't matter, and so a previous run leaving
// stale rows can't cause "Friend request already pending" on send.

const { test, expect } = require('@playwright/test');
const { loginViaUI, logoutViaUI } = require('./helpers/auth');
const { clearFriendships, getUserId } = require('./helpers/api');
const { USERS } = require('./fixtures/data');

let aliceId;
let bobId;

test.beforeAll(async () => {
  aliceId = await getUserId(USERS.alice.username);
  bobId = await getUserId(USERS.bob.username);
  if (!aliceId || !bobId) {
    throw new Error('friend-system: missing seeded alice/bob — global-setup may have skipped');
  }
});

test.beforeEach(async () => {
  await clearFriendships([aliceId, bobId]);
});

test.afterAll(async () => {
  if (aliceId && bobId) await clearFriendships([aliceId, bobId]);
});

async function openFriendsTab(page) {
  // Phase 1 follow-up — sidebar kicker dropped; the Friends entry is now
  // a single-label "Friends" (was the "Social Friends" kicker+label).
  // `.first()` picks the sidebar entry; sub-tab "Friends" labels in
  // PicksHistory + LeaderboardView don't collide here because we're on
  // a different view (the Friends view doesn't render those).
  await page
    .getByRole('tab', { name: /^Friends$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Friends', level: 2 })).toBeVisible({
    timeout: 10_000,
  });
}

async function openFriendsSubTab(page, label) {
  await page.getByRole('tab', { name: label, exact: true }).click();
}

async function sendFriendRequest(page, targetUsername) {
  // Find people sub-tab hosts the search input.
  await openFriendsSubTab(page, 'Find people');
  await page.locator('#friend-search').fill(targetUsername);
  const row = page
    .locator('li')
    .filter({ hasText: targetUsername })
    .filter({ has: page.getByRole('button', { name: 'Add friend', exact: true }) })
    .first();
  await row.getByRole('button', { name: 'Add friend', exact: true }).click();
}

test('friend request accept: alice sends → bob accepts → both see each other in Friends', async ({
  browser,
}) => {
  // --- Phase 1: Alice sends a request to Bob. ---
  const aliceCtx = await browser.newContext();
  const alicePage = await aliceCtx.newPage();
  await loginViaUI(alicePage, USERS.alice);
  await openFriendsTab(alicePage);
  await sendFriendRequest(alicePage, USERS.bob.username);

  // Outgoing section lives in the Requests sub-tab.
  await openFriendsSubTab(alicePage, 'Requests');
  const outgoing = alicePage
    .locator('div')
    .filter({ has: alicePage.getByRole('heading', { name: 'Outgoing requests' }) })
    .first();
  await expect(outgoing).toContainText(USERS.bob.username, { timeout: 10_000 });
  await logoutViaUI(alicePage);
  await aliceCtx.close();

  // --- Phase 2: Bob accepts. ---
  const bobCtx = await browser.newContext();
  const bobPage = await bobCtx.newPage();
  await loginViaUI(bobPage, USERS.bob);
  await openFriendsTab(bobPage);
  await openFriendsSubTab(bobPage, 'Requests');

  const incoming = bobPage
    .locator('div')
    .filter({ has: bobPage.getByRole('heading', { name: 'Incoming requests' }) })
    .first();
  await expect(incoming).toContainText(USERS.alice.username, { timeout: 10_000 });

  const aliceRow = incoming
    .locator('> div > div')
    .filter({ hasText: USERS.alice.username })
    .first();
  await aliceRow.getByRole('button', { name: 'Accept', exact: true }).click();

  // After accept, alice appears in Bob's All sub-tab (Friends section).
  await openFriendsSubTab(bobPage, 'All');
  const friends = bobPage
    .locator('div')
    .filter({ has: bobPage.getByRole('heading', { name: 'Friends', level: 3 }) })
    .first();
  await expect(friends).toContainText(USERS.alice.username, { timeout: 10_000 });
  await logoutViaUI(bobPage);
  await bobCtx.close();

  // --- Phase 3: Alice also sees bob in her All sub-tab. ---
  const verifyCtx = await browser.newContext();
  const verifyPage = await verifyCtx.newPage();
  await loginViaUI(verifyPage, USERS.alice);
  await openFriendsTab(verifyPage);
  await openFriendsSubTab(verifyPage, 'All');
  const aliceFriends = verifyPage
    .locator('div')
    .filter({ has: verifyPage.getByRole('heading', { name: 'Friends', level: 3 }) })
    .first();
  await expect(aliceFriends).toContainText(USERS.bob.username, { timeout: 10_000 });
  await verifyCtx.close();
});

test('friend request decline: alice sends → bob declines → both lists clear', async ({
  browser,
}) => {
  // --- Alice sends. ---
  const aliceCtx = await browser.newContext();
  const alicePage = await aliceCtx.newPage();
  await loginViaUI(alicePage, USERS.alice);
  await openFriendsTab(alicePage);
  await sendFriendRequest(alicePage, USERS.bob.username);
  await openFriendsSubTab(alicePage, 'Requests');
  await expect(alicePage.getByRole('heading', { name: 'Outgoing requests' })).toBeVisible({
    timeout: 10_000,
  });
  await logoutViaUI(alicePage);
  await aliceCtx.close();

  // --- Bob declines. ---
  const bobCtx = await browser.newContext();
  const bobPage = await bobCtx.newPage();
  await loginViaUI(bobPage, USERS.bob);
  await openFriendsTab(bobPage);
  await openFriendsSubTab(bobPage, 'Requests');
  const incoming = bobPage
    .locator('div')
    .filter({ has: bobPage.getByRole('heading', { name: 'Incoming requests' }) })
    .first();
  await expect(incoming).toContainText(USERS.alice.username, { timeout: 10_000 });
  await incoming.getByRole('button', { name: 'Decline', exact: true }).click();
  // Incoming section disappears once there are no pending rows — the
  // Requests sub-tab falls back to the empty-state EmptyState card.
  await expect(bobPage.getByRole('heading', { name: 'Incoming requests' })).toHaveCount(0, {
    timeout: 10_000,
  });
  await logoutViaUI(bobPage);
  await bobCtx.close();

  // --- Alice's outgoing should also clear after decline. ---
  const verifyCtx = await browser.newContext();
  const verifyPage = await verifyCtx.newPage();
  await loginViaUI(verifyPage, USERS.alice);
  await openFriendsTab(verifyPage);
  await openFriendsSubTab(verifyPage, 'Requests');
  await expect(verifyPage.getByRole('heading', { name: 'Outgoing requests' })).toHaveCount(0, {
    timeout: 10_000,
  });
  // Alice can re-send (no zombie row blocks her).
  await sendFriendRequest(verifyPage, USERS.bob.username);
  await openFriendsSubTab(verifyPage, 'Requests');
  await expect(verifyPage.getByRole('heading', { name: 'Outgoing requests' })).toBeVisible({
    timeout: 10_000,
  });
  await verifyCtx.close();
});

test('autocomplete dropdown: per-row CTA flips Add → Request sent after sending; self shows You', async ({
  page,
}) => {
  // Tier 19 Chunk 2 — exercises the friendStatus-driven CTA states without
  // leaning on the full send→accept→friends flow above. Three states:
  // 'self' (You, disabled), 'none' (Add friend), 'pending-out' (Request
  // sent, disabled).
  await loginViaUI(page, USERS.alice);
  await openFriendsTab(page);
  await openFriendsSubTab(page, 'Find people');

  // 1. Search for self → the You button renders disabled.
  await page.locator('#friend-search').fill(USERS.alice.username);
  const selfRow = page
    .locator('li')
    .filter({ hasText: USERS.alice.username })
    .filter({ has: page.getByRole('button', { name: 'You', exact: true }) })
    .first();
  await expect(selfRow.getByRole('button', { name: 'You', exact: true })).toBeDisabled({
    timeout: 5_000,
  });

  // 2. Clear + search for bob → "Add friend" is enabled.
  await page.locator('#friend-search').fill('');
  await page.locator('#friend-search').fill(USERS.bob.username);
  const bobRow = page
    .locator('li')
    .filter({ hasText: USERS.bob.username })
    .filter({ has: page.getByRole('button', { name: 'Add friend', exact: true }) })
    .first();
  const addBtn = bobRow.getByRole('button', { name: 'Add friend', exact: true });
  await expect(addBtn).toBeEnabled({ timeout: 5_000 });
  await addBtn.click();

  // 3. After Add → switching to Requests reveals the Outgoing section.
  await openFriendsSubTab(page, 'Requests');
  await expect(page.getByRole('heading', { name: 'Outgoing requests' })).toBeVisible({
    timeout: 10_000,
  });

  // 4. Re-search bob → CTA is now disabled "Request sent" (pending-out).
  await openFriendsSubTab(page, 'Find people');
  await page.locator('#friend-search').fill(USERS.bob.username);
  const bobRowAfter = page
    .locator('li')
    .filter({ hasText: USERS.bob.username })
    .filter({ has: page.getByRole('button', { name: 'Request sent', exact: true }) })
    .first();
  await expect(bobRowAfter.getByRole('button', { name: 'Request sent', exact: true })).toBeDisabled(
    { timeout: 5_000 },
  );
});

test('friend request cancel: alice cancels before bob acts → bob has no incoming', async ({
  browser,
}) => {
  const aliceCtx = await browser.newContext();
  const alicePage = await aliceCtx.newPage();
  await loginViaUI(alicePage, USERS.alice);
  await openFriendsTab(alicePage);
  await sendFriendRequest(alicePage, USERS.bob.username);
  await openFriendsSubTab(alicePage, 'Requests');

  const outgoing = alicePage
    .locator('div')
    .filter({ has: alicePage.getByRole('heading', { name: 'Outgoing requests' }) })
    .first();
  await expect(outgoing).toContainText(USERS.bob.username, { timeout: 10_000 });

  // Cancel → handleUnfriend → DELETE /api/friends/:id. Outgoing section
  // collapses to the empty-state EmptyState card.
  await outgoing.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(alicePage.getByRole('heading', { name: 'Outgoing requests' })).toHaveCount(0, {
    timeout: 10_000,
  });
  await logoutViaUI(alicePage);
  await aliceCtx.close();

  // Bob shouldn't see anything incoming.
  const bobCtx = await browser.newContext();
  const bobPage = await bobCtx.newPage();
  await loginViaUI(bobPage, USERS.bob);
  await openFriendsTab(bobPage);
  await openFriendsSubTab(bobPage, 'Requests');
  await expect(bobPage.getByRole('heading', { name: 'Incoming requests' })).toHaveCount(0, {
    timeout: 10_000,
  });
  await bobCtx.close();
});
