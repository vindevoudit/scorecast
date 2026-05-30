'use strict';

// 5.5.4 — Group lifecycle: create → invite → accept → transfer → delete.
// Tier 30 Phase 1 Chunk 1.3 — Groups view now mounts a dedicated GroupsView
// with three sub-tabs (My Groups / Discover / Invites). The "Create a new
// group" form lifted out of the inline left column into a CreateGroupModal
// triggered by a "+ New group" button on the My Groups sub-tab. The invite
// listing moved from the right column into the Invites sub-tab.

const { test, expect } = require('@playwright/test');
const { loginViaUI, logoutViaUI } = require('./helpers/auth');
const { closestCard } = require('./helpers/selectors');
const { USERS } = require('./fixtures/data');

async function openGroupsTab(page) {
  // Phase 1 follow-up — sidebar kicker dropped; the Groups entry is
  // now exactly "Groups" (was kicker "Groups" + label "My Groups").
  // The GroupsView's "My Groups" sub-tab is distinct from the sidebar.
  await page
    .getByRole('tab', { name: /^Groups$/ })
    .first()
    .click();
  // The GroupsView card heading is the level-2 "Groups".
  await expect(page.getByRole('heading', { name: 'Groups', level: 2 })).toBeVisible({
    timeout: 10_000,
  });
}

async function openGroupsSubTab(page, label) {
  // SubTabs option labels carry a count suffix when non-zero (e.g.
  // "My Groups (3)"). Regex-match the prefix so the test is stable.
  await page.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
}

test('group lifecycle: alice creates and invites, bob accepts, transfer, delete', async ({
  browser,
}) => {
  const groupName = `E2E Group ${Date.now().toString(36)}`;

  const cardFor = (page, name) => closestCard(page.getByRole('heading', { name, level: 2 }));

  // --- Phase 1: Alice creates a group and invites Bob. ---
  const aliceContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  await loginViaUI(alicePage, USERS.alice);

  await openGroupsTab(alicePage);
  // My Groups is the default sub-tab; open the create modal via the pill.
  await alicePage.getByRole('button', { name: '+ New group', exact: true }).click();
  await alicePage.locator('#create-group-name').fill(groupName);
  await alicePage
    .getByRole('dialog')
    .getByRole('button', { name: 'Create group', exact: true })
    .click();

  const aliceCard = cardFor(alicePage, groupName);
  await expect(aliceCard).toBeVisible({ timeout: 10_000 });
  await expect(aliceCard.getByText('Owner', { exact: true })).toBeVisible();

  // Invite Bob via the per-card InviteRow typeahead. The "Search users
  // to invite" input is unique to GroupCard's invite UI.
  await aliceCard.getByRole('textbox', { name: 'Search users to invite' }).fill(USERS.bob.username);
  await aliceCard.getByRole('button', { name: 'Invite', exact: true }).click();

  await logoutViaUI(alicePage);
  await aliceContext.close();

  // --- Phase 2: Bob accepts the pending invite (Invites sub-tab). ---
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await loginViaUI(bobPage, USERS.bob);

  await openGroupsTab(bobPage);
  await openGroupsSubTab(bobPage, 'Invites');

  // Pending invite row carries the "Invited to join" label + the group
  // name (rendered via GroupNameDisplay → "<name> #<discriminator>").
  const inviteBlock = bobPage
    .locator('div')
    .filter({ hasText: 'Invited to join' })
    .filter({ hasText: groupName })
    .first();
  await inviteBlock.getByRole('button', { name: /Accept/i }).click();

  // After accept, Bob switches to My Groups and sees the new group as a
  // regular member.
  await openGroupsSubTab(bobPage, 'My Groups');
  const bobCard = cardFor(bobPage, groupName);
  await expect(bobCard).toBeVisible({ timeout: 10_000 });
  await expect(bobCard.getByText('Owner', { exact: true })).toHaveCount(0);

  await logoutViaUI(bobPage);
  await bobContext.close();

  // --- Phase 3: Alice transfers ownership to Bob. ---
  const aliceContext2 = await browser.newContext();
  const alicePage2 = await aliceContext2.newPage();
  await loginViaUI(alicePage2, USERS.alice);
  await openGroupsTab(alicePage2);

  const aliceCard2 = cardFor(alicePage2, groupName);
  await aliceCard2.getByRole('button', { name: 'Transfer ownership', exact: true }).click();
  await aliceCard2.getByLabel(/Transfer to/).selectOption({ label: USERS.bob.username });
  await aliceCard2.getByRole('button', { name: 'Transfer', exact: true }).click();

  await expect(aliceCard2.getByText('Owner', { exact: true })).toHaveCount(0, { timeout: 10_000 });

  await logoutViaUI(alicePage2);
  await aliceContext2.close();

  // --- Phase 4: Bob (now owner) deletes the group. ---
  const bobContext2 = await browser.newContext();
  const bobPage2 = await bobContext2.newPage();
  await loginViaUI(bobPage2, USERS.bob);
  await openGroupsTab(bobPage2);

  const bobCard2 = cardFor(bobPage2, groupName);
  await expect(bobCard2.getByText('Owner', { exact: true })).toBeVisible({ timeout: 10_000 });

  await bobCard2.getByRole('button', { name: 'Delete group', exact: true }).click();
  await bobPage2.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(bobPage2.getByRole('heading', { name: groupName, level: 2 })).toHaveCount(0, {
    timeout: 10_000,
  });

  await bobContext2.close();
});
