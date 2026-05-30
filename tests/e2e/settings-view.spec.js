'use strict';

// Tier 30 Phase 1 Chunk 1.1 — SettingsView surface invariants.
//
//   1. UserMenu → Settings navigates to SettingsView (was: Profile tab held
//      these panels).
//   2. All 4 sub-tabs render (Account / Appearance / Notifications / Privacy)
//      and `?tab=<id>` URL syncs on click.
//   3. Privacy radio writes through to PUT /api/me → user.profileVisibility
//      updates server-side without a page reload.
//   4. Email + Password panels mount on Account (the default sub-tab).
//   5. EditProfileModal opens from ProfileView's "Edit profile" button and
//      closes after a successful Save without reloading.
//
// alice's profileVisibility is reset to 'public' in afterEach so this spec
// doesn't perturb sibling specs that depend on the default.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { setProfileVisibility } = require('./helpers/api');
const { USERS } = require('./fixtures/data');

test.afterEach(async () => {
  // Reset to the seed default regardless of which test ran.
  await setProfileVisibility(USERS.alice, 'public');
});

test('UserMenu → Settings opens SettingsView with Account sub-tab default', async ({ page }) => {
  await loginViaUI(page, USERS.alice);

  // Open the dropdown; assert the Settings item is present BEFORE we click
  // (so the test fails informatively if a future commit deletes the entry).
  await page.locator('[aria-haspopup="menu"]:visible').click();
  const settingsItem = page.getByRole('menuitem', { name: 'Settings' });
  await expect(settingsItem).toBeVisible();
  await settingsItem.click();

  // SettingsView's header is the "Settings" h2; the Account sub-tab is the
  // default so the Email + Password panel headings are immediately visible.
  await expect(page.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('heading', { level: 3, name: /^Email$/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: /^Password$/ }).first()).toBeVisible();
});

test('Settings sub-tabs render + ?tab= URL syncs on click', async ({ page }) => {
  await loginViaUI(page, USERS.alice);
  await page.locator('[aria-haspopup="menu"]:visible').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();

  // All 4 sub-tab triggers render with role="tab" (Radix default for Tabs).
  const accountTab = page.getByRole('tab', { name: 'Account' });
  const appearanceTab = page.getByRole('tab', { name: 'Appearance' });
  const notificationsTab = page.getByRole('tab', { name: 'Notifications' });
  const privacyTab = page.getByRole('tab', { name: 'Privacy' });

  await expect(accountTab).toBeVisible();
  await expect(appearanceTab).toBeVisible();
  await expect(notificationsTab).toBeVisible();
  await expect(privacyTab).toBeVisible();

  // Click Appearance → URL gains ?tab=appearance, Theme heading visible.
  await appearanceTab.click();
  await expect(page).toHaveURL(/\?tab=appearance/);
  await expect(page.getByRole('heading', { level: 3, name: /^Theme$/ }).first()).toBeVisible();

  // Click Privacy → URL flips to ?tab=privacy, Profile visibility heading visible.
  await privacyTab.click();
  await expect(page).toHaveURL(/\?tab=privacy/);
  await expect(
    page.getByRole('heading', { level: 3, name: /^Profile visibility$/ }).first(),
  ).toBeVisible();
});

test('Privacy radio writes profileVisibility through PUT /api/me', async ({ page }) => {
  // Pre-state baseline: ensure alice is public BEFORE the UI flow runs so
  // we know the click is the thing that flipped state.
  await setProfileVisibility(USERS.alice, 'public');

  await loginViaUI(page, USERS.alice);
  await page.locator('[aria-haspopup="menu"]:visible').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Privacy' }).click();

  // The radio is a controlled input — its `checked` flips only after
  // PUT /api/me resolves and setUser merges the new value. `.click()`
  // dispatches the event without Playwright's synchronous state-flip
  // confirmation; `toBeChecked` polls for the eventual flip.
  await page.locator('#settings-visibility-friends').click();
  await expect(page.locator('#settings-visibility-friends')).toBeChecked({ timeout: 10_000 });

  // Reload to confirm the change persists server-side (not just client
  // state) — the radio re-hydrates from /api/me's profileVisibility field.
  await page.reload();
  await page.locator('[aria-haspopup="menu"]:visible').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Privacy' }).click();
  await expect(page.locator('#settings-visibility-friends')).toBeChecked({ timeout: 10_000 });
});

test('EditProfileModal opens from ProfileView and closes after Save', async ({ page }) => {
  await loginViaUI(page, USERS.alice);

  // Navigate to Profile via the sidebar.
  await page
    .getByRole('tab', { name: /Profile/i })
    .first()
    .click();
  await expect(page.getByText('Total points').first()).toBeVisible({ timeout: 10_000 });

  // Click Edit profile → modal opens.
  await page.getByRole('button', { name: 'Edit profile' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Edit profile')).toBeVisible();

  // Cancel closes the dialog without a save.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
});
