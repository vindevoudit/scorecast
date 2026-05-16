'use strict';

const { expect } = require('@playwright/test');

// Post-login sentinel: the Sidebar renders a `role="tab"` for "Games" with
// the accessible name "Games Upcoming Matches" (kicker + label). Always
// present on the desktop viewport Playwright runs at; also present inside
// the mobile drawer when open. Replaces the old "Logout" button sentinel
// from the horizontal top bar (now relocated into the UserMenu dropdown).
const DASHBOARD_SENTINEL = /Upcoming Matches/;

// Unauthenticated visitors land on `<Landing />` first. Both "Get started"
// and "Sign in" CTAs reveal the same login + register grid; we click
// "Get started" here because it's the visually-primary CTA and renders
// first in DOM order. The wait is bounded by the standard expect timeout
// so deep-link flows (forgot/reset/2fa) that bypass the landing don't
// stall here.
async function dismissLanding(page) {
  const cta = page.getByRole('button', { name: /Get started/i }).first();
  await cta
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => cta.click())
    .catch(() => {});
}

async function registerViaUI(page, { username, email, password }) {
  await page.goto('/');
  await dismissLanding(page);
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
  await dismissLanding(page);
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  await expect(page.getByRole('tab', { name: DASHBOARD_SENTINEL }).first()).toBeVisible({
    timeout: 15_000,
  });
}

async function logoutViaUI(page) {
  // UserMenu trigger uses aria-haspopup="menu". The Tier 11 Chunk 3 top-bar
  // split renders it twice (mobile + desktop layouts, one CSS-hidden via
  // md:hidden), so the bare selector matches 2 elements. `:visible` picks
  // the one actually visible at the current viewport.
  await page.locator('[aria-haspopup="menu"]:visible').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  // Confirm modal still uses "Log out" (two words); scope to the dialog.
  await page.getByRole('dialog').getByRole('button', { name: 'Log out', exact: true }).click();
  // Post-logout the visitor lands on the anonymous dashboard (browseAsGuest
  // flipped true by performLogout) — the top utility bar shows a [Sign in]
  // button in place of the UserMenu.
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

module.exports = { registerViaUI, loginViaUI, logoutViaUI };
