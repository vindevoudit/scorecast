'use strict';

// UI smoke for the ChangeEmailPanel mounted in ProfileView next to
// ChangePasswordPanel. The PATCH /api/me/email endpoint is covered by
// tests/e2e/api/me.spec.js; this spec validates the browser flow — panel
// renders, exposes the current email + verified badge, expands, surfaces
// inline + server-side errors, and successfully persists.
//
// alice's email + emailVerifiedAt are restored in afterEach via
// updateUserFields so the rest of the suite isn't perturbed.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { updateUserFields } = require('./helpers/api');
const { USERS } = require('./fixtures/data');

const NEW_EMAIL = `alice-rotated-${Date.now()}@example.test`;

test.afterEach(async () => {
  await updateUserFields(USERS.alice.id, {
    email: USERS.alice.email,
    emailVerifiedAt: new Date(),
  });
});

// Tier 30 Phase 1 Chunk 1.1 — ChangeEmailPanel moved from Profile tab to
// Settings → Account sub-tab. Open via UserMenu → Settings; Account is
// the default sub-tab so the panel mounts immediately.
async function openSettingsAccount(page) {
  await page.locator('[aria-haspopup="menu"]:visible').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 3, name: /^Email$/ }).first()).toBeVisible({
    timeout: 10_000,
  });
}

test('ChangeEmailPanel — shows current email + verified badge', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await openSettingsAccount(page);

  await expect(page.getByText(USERS.alice.email, { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Verified').first()).toBeVisible();
});

test('ChangeEmailPanel — expand + happy path → success', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await openSettingsAccount(page);

  await page.getByRole('button', { name: 'Change email' }).click();

  const emailField = page.locator('#change-email-new');
  const passwordField = page.locator('#change-email-password');
  await expect(emailField).toBeVisible();
  await expect(passwordField).toBeVisible();

  await emailField.fill(NEW_EMAIL);
  await passwordField.fill(USERS.alice.password);
  await page.getByRole('button', { name: 'Save email' }).click();

  // Panel collapses on success; the standalone "Change email" button
  // returns. The Email row now reflects the new address and renders the
  // "Not verified" badge because emailVerifiedAt was cleared server-side.
  await expect(page.getByRole('button', { name: 'Change email' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(NEW_EMAIL, { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Not verified').first()).toBeVisible();
});

test('ChangeEmailPanel — wrong password surfaces server error', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await openSettingsAccount(page);
  await page.getByRole('button', { name: 'Change email' }).click();

  await page.locator('#change-email-new').fill(NEW_EMAIL);
  await page.locator('#change-email-password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Save email' }).click();

  await expect(page.getByText(/Current password is incorrect/i).first()).toBeVisible({
    timeout: 10_000,
  });
});

test('ChangeEmailPanel — same-as-current address surfaces inline error', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await openSettingsAccount(page);
  await page.getByRole('button', { name: 'Change email' }).click();

  await page.locator('#change-email-new').fill(USERS.alice.email);
  await page.locator('#change-email-password').fill(USERS.alice.password);
  await page.getByRole('button', { name: 'Save email' }).click();

  await expect(page.getByText(/already your email address/i).first()).toBeVisible();
});
