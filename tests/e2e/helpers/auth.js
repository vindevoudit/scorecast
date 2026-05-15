'use strict';

const { expect } = require('@playwright/test');

// Post-login sentinel: the Sidebar renders a `role="tab"` for "Games" with
// the accessible name "Games Upcoming Matches" (kicker + label). Always
// present on the desktop viewport Playwright runs at; also present inside
// the mobile drawer when open. Replaces the old "Logout" button sentinel
// from the horizontal top bar (now relocated into the UserMenu dropdown).
const DASHBOARD_SENTINEL = /Upcoming Matches/;

async function registerViaUI(page, { username, email, password }) {
  await page.goto('/');
  await page.locator('#register-username').fill(username);
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill(password);
  await page.getByRole('button', { name: /^Register$/ }).click();
  await expect(page.getByRole('tab', { name: DASHBOARD_SENTINEL }).first()).toBeVisible({
    timeout: 15_000,
  });
}

async function loginViaUI(page, { username, password }) {
  await page.goto('/');
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  await expect(page.getByRole('tab', { name: DASHBOARD_SENTINEL }).first()).toBeVisible({
    timeout: 15_000,
  });
}

async function logoutViaUI(page) {
  // UserMenu trigger uses aria-haspopup="menu"; only one such element exists.
  await page.locator('[aria-haspopup="menu"]').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  // Confirm modal still uses "Log out" (two words); scope to the dialog.
  await page.getByRole('dialog').getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.locator('#login-username')).toBeVisible({ timeout: 15_000 });
}

module.exports = { registerViaUI, loginViaUI, logoutViaUI };
