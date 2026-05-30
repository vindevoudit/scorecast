'use strict';

// Tier 30 Phase 1 Chunk 1.3 — GroupsView surface invariants.
// Phase 1 follow-up — sidebar kicker dropped; sidebar entry "Groups"
// (was "My Groups" with kicker "Groups"). The GroupsView's "My Groups"
// sub-tab is now distinct from the sidebar label.
//
//   1. Sidebar "Groups" entry opens GroupsView with three sub-tabs
//      (My Groups / Discover / Invites).
//   2. `+ New group` button opens CreateGroupModal; submission creates the
//      group and the new card appears in My Groups.
//   3. Anon visitors default to Discover (only populated sub-tab) and see
//      InlineGatePanel on My Groups + Invites.
//   4. URL `?tab=` syncs on click.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { apiLogin } = require('./helpers/api');
const { USERS } = require('./fixtures/data');

const createdGroupIds = [];

test.afterEach(async () => {
  if (createdGroupIds.length === 0) return;
  const admin = await apiLogin(USERS.admin);
  try {
    for (const id of createdGroupIds) {
      await admin.delete(`/api/groups/${id}`).catch(() => {});
    }
  } finally {
    await admin.dispose();
    createdGroupIds.length = 0;
  }
});

async function openGroupsSidebar(page) {
  await page
    .getByRole('tab', { name: /^Groups$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Groups', level: 2 })).toBeVisible({
    timeout: 10_000,
  });
}

test('GroupsView opens with My Groups default; sub-tabs render', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await openGroupsSidebar(page);

  // Sub-tabs render. Triple of My Groups / Discover / Invites — sub-tab
  // names are unique within the page so no scoping needed.
  await expect(page.getByRole('tab', { name: /^My Groups/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Discover$/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Invites/ })).toBeVisible();
});

test('+ New group opens CreateGroupModal; submission creates a group', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await openGroupsSidebar(page);

  // Click the pill → modal opens with the create form.
  await page.getByRole('button', { name: '+ New group', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Create a new group')).toBeVisible();

  const groupName = `E2E SubTabs ${Date.now().toString(36)}`;
  await page.locator('#create-group-name').fill(groupName);
  await dialog.getByRole('button', { name: 'Create group', exact: true }).click();

  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: groupName, level: 2 })).toBeVisible({
    timeout: 10_000,
  });

  // Capture the id so afterEach can clean up.
  const authed = await apiLogin(USERS.alice);
  try {
    const res = await authed.get('/api/groups');
    const groups = await res.json();
    const created = groups.find((g) => g.name === groupName);
    if (created) createdGroupIds.push(created.id);
  } finally {
    await authed.dispose();
  }
});

test('Sub-tabs URL syncs via ?tab=', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await openGroupsSidebar(page);

  // Click Discover → URL flips to ?tab=discover; click Invites → ?tab=invites.
  await page
    .getByRole('tab', { name: /^Discover$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\?tab=discover/);
  await page.getByRole('tab', { name: /^Invites/ }).click();
  await expect(page).toHaveURL(/\?tab=invites/);
});

test('anon visitor: defaults to Discover; My Groups + Invites gate via InlineGatePanel', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: /browse as a guest/i })
    .first()
    .click();
  // Anon sidebar shows 3 entries (Matches / Groups / Leaderboards). Click Groups.
  await page
    .getByRole('tab', { name: /^Groups$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Groups', level: 2 })).toBeVisible({
    timeout: 10_000,
  });

  // Discover is the default for anon — confirm the heading copy.
  await expect(page.getByText(/Public groups that anyone can join/i).first()).toBeVisible();

  // Switch to My Groups → InlineGatePanel "create or join a group" surfaces.
  await page
    .getByRole('tab', { name: /^My Groups/ })
    .first()
    .click();
  await expect(page.getByText(/Sign in to create or join a group/i).first()).toBeVisible({
    timeout: 5_000,
  });

  // Switch to Invites → InlineGatePanel "see your invites" surfaces.
  await page.getByRole('tab', { name: /^Invites/ }).click();
  await expect(page.getByText(/Sign in to see your invites/i).first()).toBeVisible();
});
