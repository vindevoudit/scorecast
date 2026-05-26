'use strict';

// Tier 5.5b — admin panel invariants:
//  (1) GameManager CRUD: create a game → it appears in the list → delete →
//      it disappears.
//  (2) UserManager bulk role flip: select two non-admin users → "Promote" →
//      both show role chip "admin". The admin's own checkbox is disabled
//      (UserManager.jsx) so the self-skip backstop in UserService.bulkAction
//      never has to fire from a button click.
//  (3) UserManager cascade delete (Tier 5.3 transactional cascade): when a
//      user is deleted, every group they own goes with them.
//
// Temp users are inserted via direct DB INSERT (bypassing /api/register) so
// they have no email_verification_token row. In test env the schema is built
// by sequelize.sync() before migrations apply, which leaves the
// email_verification_tokens FK without ON DELETE CASCADE — so a user that
// went through the public register flow can't actually be deleted in tests
// without first wiping their token rows. The shipped migration sets the
// cascade correctly, so prod is unaffected; this workaround is purely a test
// hygiene measure. See README/CLAUDE.md if/when global-setup is changed to
// drop+migrate instead of sync+migrate.

const { test, expect } = require('@playwright/test');
const bcrypt = require('bcryptjs');
const { loginViaUI } = require('./helpers/auth');
const { openAdminTab } = require('./helpers/admin');
const { apiLogin } = require('./helpers/api');
const { USERS } = require('./fixtures/data');

let _models = null;
function getModels() {
  if (_models) return _models;
  require('./fixtures/env');
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  _models = require('../../models');
  return _models;
}

async function createBareUser({ username, password, email, role = 'user' }) {
  const { User } = getModels();
  return User.create({
    username,
    email,
    password: await bcrypt.hash(password, 10),
    emailVerifiedAt: new Date(),
    role,
    loginAttempts: 0,
  });
}

async function deleteUserByUsername(username) {
  const { User, EmailVerificationToken, PasswordResetToken, RefreshToken } = getModels();
  const user = await User.findOne({ where: { username } });
  if (!user) return;
  // The shipped cascadeDelete doesn't touch token rows (the prod migrations
  // declare ON DELETE CASCADE at the FK level — but our test DB is built by
  // sequelize.sync, which doesn't include the cascade). Wipe the token rows
  // first so cascadeDelete can run without an FK violation in tests.
  await EmailVerificationToken.destroy({ where: { userId: user.id } });
  await PasswordResetToken.destroy({ where: { userId: user.id } });
  await RefreshToken.destroy({ where: { userId: user.id } });
  const UserService = require('../../services/UserService');
  await UserService.cascadeDelete(user);
}

// No global teardown — workers:1 shares the require('models') Sequelize pool
// across specs, and closing it here would break anyone running afterwards.
// Per-test cleanup happens inside each test's `finally` block.

test('game CRUD: admin creates, then deletes a game via GameManager', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const home = `E2E Home ${stamp}`;
  const away = `E2E Away ${stamp}`;
  const matchText = `${home} vs ${away}`;

  await loginViaUI(page, USERS.admin);
  await openAdminTab(page);

  // --- Create ---
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  const createForm = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Create game', exact: true }) });
  await createForm.getByLabel(/^Home team/).fill(home);
  await createForm.getByLabel(/^Away team/).fill(away);
  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 2);
  future.setUTCHours(12, 0, 0, 0);
  await createForm.getByLabel(/^Date \/ time/).fill(future.toISOString().slice(0, 16));
  await createForm.getByRole('button', { name: 'Create game', exact: true }).click();

  // Row should appear once /api/admin/games returns + GameManager refreshes.
  // Pin to the row by intersecting the unique match text with the row's
  // Delete button (same pattern as pick-and-result.spec.js).
  const row = page
    .locator('div')
    .filter({ hasText: matchText })
    .filter({ has: page.getByRole('button', { name: 'Delete', exact: true }) })
    .last();
  await expect(row).toBeVisible({ timeout: 15_000 });

  // --- Delete ---
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(matchText)).toHaveCount(0, { timeout: 10_000 });
});

test('bulk role flip: admin promotes two users → role chip flips; self-checkbox disabled', async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const user1 = await createBareUser({
    username: `e2e_promo_a_${stamp}`,
    password: 'TempPassword123!',
    email: `e2e-promo-a-${stamp}@example.test`,
  });
  const user2 = await createBareUser({
    username: `e2e_promo_b_${stamp}`,
    password: 'TempPassword123!',
    email: `e2e-promo-b-${stamp}@example.test`,
  });

  try {
    await loginViaUI(page, USERS.admin);
    await openAdminTab(page);

    const userManager = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Users', level: 3 }) })
      .first();

    // The admin self-row disables its checkbox (UserManager.jsx `disabled={isSelf}`).
    const selfCheckbox = userManager.getByLabel(`Select ${USERS.admin.username}`);
    await expect(selfCheckbox).toBeDisabled({ timeout: 10_000 });

    await userManager.getByLabel(`Select ${user1.username}`).check();
    await userManager.getByLabel(`Select ${user2.username}`).check();

    // The bulk-action Promote button is rendered FIRST in DOM order; per-row
    // Promote buttons follow in user-row order. The bulk button is also the
    // only one that's enabled when both users are still non-admin
    // (UserManager.jsx disables a row's Promote when busy/isSelf, but the
    // first-in-DOM rule is the load-bearing distinction here).
    await userManager.getByRole('button', { name: 'Promote', exact: true }).first().click();

    // After the bulk action the rows re-render with role="admin" chip.
    const user1Row = userManager.locator('div').filter({ hasText: user1.username }).first();
    const user2Row = userManager.locator('div').filter({ hasText: user2.username }).first();
    await expect(user1Row.getByText('admin', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(user2Row.getByText('admin', { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await deleteUserByUsername(user1.username);
    await deleteUserByUsername(user2.username);
  }
});

test('cascade delete: deleting a user removes the groups they own (Tier 5.3 transactional cascade)', async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const temp = await createBareUser({
    username: `e2e_cascade_${stamp}`,
    password: 'TempPassword123!',
    email: `e2e-cascade-${stamp}@example.test`,
  });
  const groupName = `Cascade-Group-${stamp}`;

  // Temp user creates a group via API.
  const tempApi = await apiLogin({ username: temp.username, password: 'TempPassword123!' });
  try {
    const createRes = await tempApi.post('/api/groups', {
      data: { name: groupName, visibility: 'secret' },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    expect(created.name).toBe(groupName);

    // Clear the temp user's refresh-token row before the UI delete fires.
    // sequelize.sync builds the FK without ON DELETE CASCADE in test env, so
    // a stale refresh row would block User.destroy(). See deleteUserByUsername
    // above for the same workaround. This is purely test-env hygiene.
    const { RefreshToken } = getModels();
    await RefreshToken.destroy({ where: { userId: temp.id } });

    // --- Admin deletes the temp user via the UserManager UI. ---
    await loginViaUI(page, USERS.admin);
    await openAdminTab(page);

    const userManager = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Users', level: 3 }) })
      .first();

    // Pin the row by intersecting the unique username with the per-row Delete
    // button, then take .last() so we land on the innermost wrapper rather than
    // the UserManager card as a whole.
    const tempRow = userManager
      .locator('div')
      .filter({ hasText: temp.username })
      .filter({ has: page.getByRole('button', { name: 'Delete', exact: true }) })
      .last();
    await tempRow.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    // Row should disappear once the delete API call returns.
    await expect(userManager.getByText(temp.username)).toHaveCount(0, { timeout: 10_000 });

    // Direct DB check: the group must be gone, and no orphan GroupMember
    // rows pointing at the deleted user.
    const { Group, GroupMember } = getModels();
    const groupAfter = await Group.findOne({ where: { name: groupName } });
    expect(groupAfter, `group ${groupName} should be deleted`).toBeNull();
    const orphanMembers = await GroupMember.count({ where: { userId: temp.id } });
    expect(orphanMembers).toBe(0);
  } finally {
    await tempApi.dispose();
    await deleteUserByUsername(temp.username);
  }
});
