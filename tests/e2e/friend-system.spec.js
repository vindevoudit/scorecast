'use strict';

// Tier 5.5b — friend request lifecycle: send → accept / decline / cancel.
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
  // Leave the DB tidy for whatever runs after. We don't close the Sequelize
  // pool here — workers:1 means a sibling spec would inherit the closed pool.
  if (aliceId && bobId) await clearFriendships([aliceId, bobId]);
});

// FriendsList lives inside the Groups tab (DashboardView). Tabs are accessed
// via getByRole('tab', { name: /My Groups/ }) — same pattern as group-lifecycle.spec.js.
async function openGroupsTab(page) {
  await page.getByRole('tab', { name: /My Groups/ }).click();
  await expect(page.getByRole('heading', { name: 'Friends', level: 2 })).toBeVisible({
    timeout: 10_000,
  });
}

async function sendFriendRequest(page, targetUsername) {
  // Scope to FriendsList — the same page also has a "Username" label in the
  // Invite form for groups. The friends-list input has id="friend-username".
  await page.locator('#friend-username').fill(targetUsername);
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
}

test('friend request accept: alice sends → bob accepts → both see each other in Friends', async ({
  browser,
}) => {
  // --- Phase 1: Alice sends a request to Bob. ---
  const aliceCtx = await browser.newContext();
  const alicePage = await aliceCtx.newPage();
  await loginViaUI(alicePage, USERS.alice);
  await openGroupsTab(alicePage);
  await sendFriendRequest(alicePage, USERS.bob.username);

  // Outgoing section appears with bob's username.
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
  await openGroupsTab(bobPage);

  const incoming = bobPage
    .locator('div')
    .filter({ has: bobPage.getByRole('heading', { name: 'Incoming requests' }) })
    .first();
  await expect(incoming).toContainText(USERS.alice.username, { timeout: 10_000 });

  // Scope Accept to the row that mentions alice so we don't accidentally
  // accept some other unrelated request.
  const aliceRow = incoming
    .locator('> div > div')
    .filter({ hasText: USERS.alice.username })
    .first();
  await aliceRow.getByRole('button', { name: 'Accept', exact: true }).click();

  // After accept, alice appears in Bob's Friends section.
  const friends = bobPage
    .locator('div')
    .filter({ has: bobPage.getByRole('heading', { name: 'Friends', level: 3 }) })
    .first();
  await expect(friends).toContainText(USERS.alice.username, { timeout: 10_000 });
  await logoutViaUI(bobPage);
  await bobCtx.close();

  // --- Phase 3: Alice also sees bob in her Friends list. ---
  const verifyCtx = await browser.newContext();
  const verifyPage = await verifyCtx.newPage();
  await loginViaUI(verifyPage, USERS.alice);
  await openGroupsTab(verifyPage);
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
  await openGroupsTab(alicePage);
  await sendFriendRequest(alicePage, USERS.bob.username);
  await expect(alicePage.getByRole('heading', { name: 'Outgoing requests' })).toBeVisible({
    timeout: 10_000,
  });
  await logoutViaUI(alicePage);
  await aliceCtx.close();

  // --- Bob declines. ---
  const bobCtx = await browser.newContext();
  const bobPage = await bobCtx.newPage();
  await loginViaUI(bobPage, USERS.bob);
  await openGroupsTab(bobPage);
  const incoming = bobPage
    .locator('div')
    .filter({ has: bobPage.getByRole('heading', { name: 'Incoming requests' }) })
    .first();
  await expect(incoming).toContainText(USERS.alice.username, { timeout: 10_000 });
  await incoming.getByRole('button', { name: 'Decline', exact: true }).click();
  // Incoming section disappears once there are no pending rows.
  await expect(bobPage.getByRole('heading', { name: 'Incoming requests' })).toHaveCount(0, {
    timeout: 10_000,
  });
  await logoutViaUI(bobPage);
  await bobCtx.close();

  // --- Alice's outgoing should also clear after decline (Friendship row is destroyed). ---
  const verifyCtx = await browser.newContext();
  const verifyPage = await verifyCtx.newPage();
  await loginViaUI(verifyPage, USERS.alice);
  await openGroupsTab(verifyPage);
  await expect(verifyPage.getByRole('heading', { name: 'Outgoing requests' })).toHaveCount(0, {
    timeout: 10_000,
  });
  // Alice can re-send (no zombie row blocks her).
  await sendFriendRequest(verifyPage, USERS.bob.username);
  await expect(verifyPage.getByRole('heading', { name: 'Outgoing requests' })).toBeVisible({
    timeout: 10_000,
  });
  await verifyCtx.close();
});

test('friend request cancel: alice cancels before bob acts → bob has no incoming', async ({
  browser,
}) => {
  const aliceCtx = await browser.newContext();
  const alicePage = await aliceCtx.newPage();
  await loginViaUI(alicePage, USERS.alice);
  await openGroupsTab(alicePage);
  await sendFriendRequest(alicePage, USERS.bob.username);

  const outgoing = alicePage
    .locator('div')
    .filter({ has: alicePage.getByRole('heading', { name: 'Outgoing requests' }) })
    .first();
  await expect(outgoing).toContainText(USERS.bob.username, { timeout: 10_000 });

  // FriendsList wires Cancel → handleUnfriend → DELETE /api/friends/:id.
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
  await openGroupsTab(bobPage);
  await expect(bobPage.getByRole('heading', { name: 'Incoming requests' })).toHaveCount(0, {
    timeout: 10_000,
  });
  await bobCtx.close();
});
