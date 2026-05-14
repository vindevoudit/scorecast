'use strict';

const { expect } = require('@playwright/test');

async function registerViaUI(page, { username, email, password }) {
  await page.goto('/');
  await page.locator('#register-username').fill(username);
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill(password);
  await page.getByRole('button', { name: /^Register$/ }).click();
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

async function loginViaUI(page, { username, password }) {
  await page.goto('/');
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

async function logoutViaUI(page) {
  // Top-bar trigger is labelled "Logout" (one word).
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  // Confirm modal uses "Log out" (two words); scope to the dialog.
  await page.getByRole('dialog').getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.locator('#login-username')).toBeVisible({ timeout: 15_000 });
}

module.exports = { registerViaUI, loginViaUI, logoutViaUI };
