'use strict';

const { test, expect } = require('@playwright/test');
const { loginViaUI, logoutViaUI } = require('./helpers/auth');
const { closestCard } = require('./helpers/selectors');
const { USERS } = require('./fixtures/data');

// 5.5.4 — Group lifecycle: create → invite → accept → transfer → delete.
test('group lifecycle: alice creates and invites, bob accepts, transfer, delete', async ({
  browser,
}) => {
  const groupName = `E2E Group ${Date.now().toString(36)}`;

  const cardFor = (page, name) => closestCard(page.getByRole('heading', { name, level: 2 }));

  // --- Phase 1: Alice creates a group and invites Bob. ---
  const aliceContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  await loginViaUI(alicePage, USERS.alice);

  await alicePage.getByRole('tab', { name: /My Groups/ }).click();
  await alicePage.locator('#group-name').fill(groupName);
  await alicePage.getByRole('button', { name: 'Create group', exact: true }).click();

  const aliceCard = cardFor(alicePage, groupName);
  await expect(aliceCard).toBeVisible({ timeout: 10_000 });
  await expect(aliceCard.getByText('Owner', { exact: true })).toBeVisible();

  // Invite Bob via the per-card InviteRow typeahead. Tier 19's invite
  // refactor turned the bare username input into a search box that
  // surfaces a dropdown of matches; the actual Invite button now sits
  // next to a matched user's row. Scope everything to the card so we
  // don't grab the FriendsList "Search users" input on the same page.
  await aliceCard.getByRole('textbox', { name: 'Search users to invite' }).fill(USERS.bob.username);
  // Bob's row appears in the typeahead dropdown; the "Invite" button
  // sits inside it. The dropdown is portal-free (renders inside the
  // card), so aliceCard.scope still reaches it.
  await aliceCard.getByRole('button', { name: 'Invite', exact: true }).click();

  await logoutViaUI(alicePage);
  await aliceContext.close();

  // --- Phase 2: Bob accepts the pending invite. ---
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await loginViaUI(bobPage, USERS.bob);

  await bobPage.getByRole('tab', { name: /My Groups/ }).click();

  // Pending invite block uses the group name as its heading-like label.
  const inviteBlock = bobPage
    .locator('div')
    .filter({ hasText: 'Invited to join' })
    .filter({ hasText: groupName })
    .first();
  await inviteBlock.getByRole('button', { name: /Accept/i }).click();

  // After accept, the group appears as a member in Bob's list.
  const bobCard = cardFor(bobPage, groupName);
  await expect(bobCard).toBeVisible({ timeout: 10_000 });
  // Bob is a regular member at this point; "Owner" badge should belong to alice.
  await expect(bobCard.getByText('Owner', { exact: true })).toHaveCount(0);

  await logoutViaUI(bobPage);
  await bobContext.close();

  // --- Phase 3: Alice transfers ownership to Bob. ---
  const aliceContext2 = await browser.newContext();
  const alicePage2 = await aliceContext2.newPage();
  await loginViaUI(alicePage2, USERS.alice);
  await alicePage2.getByRole('tab', { name: /My Groups/ }).click();

  const aliceCard2 = cardFor(alicePage2, groupName);
  await aliceCard2.getByRole('button', { name: 'Transfer ownership', exact: true }).click();
  // The select reveals after the toggle; selectOption by visible label.
  await aliceCard2.getByLabel(/Transfer to/).selectOption({ label: USERS.bob.username });
  await aliceCard2.getByRole('button', { name: 'Transfer', exact: true }).click();

  // After transfer alice no longer carries the Owner badge in this card.
  await expect(aliceCard2.getByText('Owner', { exact: true })).toHaveCount(0, { timeout: 10_000 });

  await logoutViaUI(alicePage2);
  await aliceContext2.close();

  // --- Phase 4: Bob (now owner) deletes the group. ---
  const bobContext2 = await browser.newContext();
  const bobPage2 = await bobContext2.newPage();
  await loginViaUI(bobPage2, USERS.bob);
  await bobPage2.getByRole('tab', { name: /My Groups/ }).click();

  const bobCard2 = cardFor(bobPage2, groupName);
  // Confirm we received ownership during the transfer.
  await expect(bobCard2.getByText('Owner', { exact: true })).toBeVisible({ timeout: 10_000 });

  await bobCard2.getByRole('button', { name: 'Delete group', exact: true }).click();
  await bobPage2.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

  // Group disappears from the list.
  await expect(bobPage2.getByRole('heading', { name: groupName, level: 2 })).toHaveCount(0, {
    timeout: 10_000,
  });

  await bobContext2.close();
});
