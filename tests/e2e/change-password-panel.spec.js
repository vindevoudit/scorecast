'use strict';

// UI smoke for the ChangePasswordPanel mounted in ProfileView. The endpoint
// itself is covered by tests/e2e/api/me.spec.js; this spec validates the
// browser flow — panel mounts, expands, shows/hides password, surfaces
// inline mismatch + wrong-password errors, and successfully persists.
//
// Per CLAUDE.md: front-end work needs an actual browser pass before ship.
// alice's password is restored in afterAll via setUserPassword so the rest
// of the suite isn't perturbed.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { setUserPassword } = require('./helpers/api');
const { USERS } = require('./fixtures/data');

const NEW_PASSWORD = 'BrowserSmokePw1!';

test.afterEach(async () => {
  await setUserPassword(USERS.alice.id, USERS.alice.password);
});

// Tier 30 Phase 1 Chunk 1.1 — ChangePasswordPanel moved from Profile tab
// to Settings → Account sub-tab. Open via UserMenu → Settings; Account
// is the default sub-tab so the panel mounts immediately.
async function openSettingsAccount(page) {
  await page.locator('[aria-haspopup="menu"]:visible').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 3, name: /^Password$/ }).first()).toBeVisible({
    timeout: 10_000,
  });
}

test('ChangePasswordPanel — expand + show/hide + happy path', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await openSettingsAccount(page);

  // Collapsed state shows the "Change password" button.
  const expandBtn = page.getByRole('button', { name: 'Change password' });
  await expect(expandBtn).toBeVisible();
  await expandBtn.click();

  const currentField = page.locator('#change-password-current');
  const newField = page.locator('#change-password-new');
  const confirmField = page.locator('#change-password-confirm');
  await expect(currentField).toBeVisible();
  await expect(newField).toBeVisible();
  await expect(confirmField).toBeVisible();

  // Show/hide toggle flips type=password ↔ type=text on the matching input.
  await expect(currentField).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).first().click();
  await expect(currentField).toHaveAttribute('type', 'text');

  // Happy path
  await currentField.fill(USERS.alice.password);
  await newField.fill(NEW_PASSWORD);
  await confirmField.fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save password' }).click();

  // Panel collapses on success — the standalone "Change password" button
  // returns to the page.
  await expect(expandBtn).toBeVisible({ timeout: 10_000 });
});

test('ChangePasswordPanel — confirm-mismatch surfaces inline error', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await openSettingsAccount(page);
  await page.getByRole('button', { name: 'Change password' }).click();

  await page.locator('#change-password-current').fill(USERS.alice.password);
  await page.locator('#change-password-new').fill(NEW_PASSWORD);
  await page.locator('#change-password-confirm').fill('something-else');

  // Inline error appears under the confirm field as soon as the value
  // diverges — no submit needed.
  await expect(page.getByText('Passwords do not match').first()).toBeVisible();
});

test('ChangePasswordPanel — wrong current password surfaces server error', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await openSettingsAccount(page);
  await page.getByRole('button', { name: 'Change password' }).click();

  await page.locator('#change-password-current').fill('definitely-wrong');
  await page.locator('#change-password-new').fill(NEW_PASSWORD);
  await page.locator('#change-password-confirm').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save password' }).click();

  await expect(page.getByText(/Current password is incorrect/i).first()).toBeVisible({
    timeout: 10_000,
  });
});
