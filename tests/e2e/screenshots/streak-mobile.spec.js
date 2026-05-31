'use strict';

// Mobile-viewport screenshots for the Tier 30 follow-up batch — top-bar
// reorg, NotificationBell + RefreshButton icon-only collapse, UserMenu
// streak chip moved into the dropdown, Profile Overview "Best streak"
// tile in Orbitron, and the Summary sub-tab rename.
//
// Seeds alice with an active win streak so the chip is visible. Runs as
// part of `npm run test:screenshots` alongside the existing mobile.spec.js.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('@playwright/test');
const { USERS } = require('../fixtures/data');

function getModels() {
  require('../fixtures/env');
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  return require('../../../models');
}

const OUTPUT_DIR = path.join(__dirname, 'output');

function shortDevice() {
  return test.info().project.name.replace(/^mobile-/, '');
}

async function shot(page, name, { fullPage = false } = {}) {
  const dir = path.join(OUTPUT_DIR, shortDevice());
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage });
}

async function setStreak(current, longest) {
  const { User } = getModels();
  const u = await User.findByPk(USERS.alice.id);
  u.currentWinStreak = current;
  u.longestWinStreak = longest;
  await u.save({ hooks: false });
}

async function dismissLanding(page) {
  const cta = page.getByRole('button', { name: /Get started/i }).first();
  await cta.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await cta.isVisible().catch(() => false)) await cta.click();
}

async function loginMobile(page, { username, password }) {
  await page.goto('/');
  await dismissLanding(page);
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  await page.locator('[aria-haspopup="menu"]:visible').waitFor({ timeout: 15_000 });
}

test.describe('streak + top-bar mobile screenshots', () => {
  test.afterEach(async () => {
    // Reset the seed user back to zero so we don't pollute other specs.
    await setStreak(0, 0);
  });

  test('top bar — Refresh | Search | Bell row 2', async ({ page }) => {
    await setStreak(8, 12);
    await loginMobile(page, USERS.alice);
    await page.getByRole('heading', { name: 'Games' }).first().waitFor({ timeout: 10_000 });
    // Capture only the top portion so the chrome reorg is the focus.
    await shot(page, '01-mobile-topbar', { fullPage: false });
  });

  test('UserMenu open — streak chip inline next to username', async ({ page }) => {
    await setStreak(8, 12);
    await loginMobile(page, USERS.alice);
    await page.getByRole('heading', { name: 'Games' }).first().waitFor({ timeout: 10_000 });
    await page.locator('[aria-haspopup="menu"]:visible').click();
    await page.getByRole('menuitem', { name: /Sign out/i }).waitFor({ timeout: 5_000 });
    // Brief settle so the dropdown's open-state animation finishes.
    await page.waitForTimeout(150);
    await shot(page, '02-mobile-usermenu-with-streak', { fullPage: false });
  });

  test('Profile Summary — Best streak tile in Orbitron', async ({ page }) => {
    await setStreak(8, 12);
    await loginMobile(page, USERS.alice);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('tab', { name: /^Profile$/ }).click();
    await page.waitForTimeout(200);
    // Best streak tile is the 5th in the Overview grid; "Best streak" copy
    // is stable.
    await page.getByText('Best streak').first().waitFor({ timeout: 10_000 });
    // Scroll the Best streak tile into view so the viewport-cropped shot
    // captures the full stats grid + the new tile in Orbitron.
    await page.getByText('Best streak').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await shot(page, '03-mobile-profile-best-streak', { fullPage: true });
  });

  test('Settings sub-tabs fit at 375 px', async ({ page }) => {
    await loginMobile(page, USERS.alice);
    // Open UserMenu → Settings (since Settings isn't in the sidebar).
    await page.locator('[aria-haspopup="menu"]:visible').click();
    await page.getByRole('menuitem', { name: /Settings/i }).click();
    // Wait for the SettingsView sub-tabs to render.
    await page.getByRole('tab', { name: /Account/i }).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(150);
    await shot(page, '05-mobile-settings-tabs', { fullPage: false });
  });

  test('UserMenu with high streak (mastery tier ≥15)', async ({ page }) => {
    // shadow-led + bg-warning/35 — proves the brightness ladder visually
    await setStreak(18, 22);
    await loginMobile(page, USERS.alice);
    await page.getByRole('heading', { name: 'Games' }).first().waitFor({ timeout: 10_000 });
    await page.locator('[aria-haspopup="menu"]:visible').click();
    await page.getByRole('menuitem', { name: /Sign out/i }).waitFor({ timeout: 5_000 });
    await page.waitForTimeout(150);
    await shot(page, '04-mobile-usermenu-mastery-streak', { fullPage: false });
  });
});
