'use strict';

// Tier 11 Chunk 3 — Mobile screenshot helper. Captures key views + states on
// three real device profiles (iPhone SE, iPhone 13, Pixel 5) so layout
// regressions on small viewports are easy to spot without a physical device.
//
// Runs via `npm run test:screenshots` (NOT part of `npm run test:e2e`).
// Output: `tests/e2e/screenshots/output/<device>/<view>.png` — gitignored.
//
// Coverage:
//   - Landing (anon, default visitor)
//   - Auth grid (sign in / register forms)
//   - Anon dashboard (Games view)
//   - Anon SignInModal (clicked Pick as guest)
//   - SearchBar mobile overlay
//   - Authed dashboard (Games, Groups, Rankings, Profile)
//   - Mobile sidebar drawer open
//
// All flows are read-only (no DB mutations) so this spec doesn't pollute the
// shared fixture state if it runs alongside the regression suite. Tests log
// in as the seeded `e2e_alice` user via the UI.

const fs = require('fs');
const path = require('path');
const { test } = require('@playwright/test');
const { USERS } = require('../fixtures/data');

const OUTPUT_DIR = path.join(__dirname, 'output');

function shortDevice() {
  return test.info().project.name.replace(/^mobile-/, '');
}

async function shot(page, name, { fullPage = true } = {}) {
  const dir = path.join(OUTPUT_DIR, shortDevice());
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage });
}

// Wait for the Landing CTA to be visible, then click it to flip showAuth=true.
// No-op if Landing was bypassed (returning visitors / deep links).
async function dismissLanding(page) {
  const cta = page.getByRole('button', { name: /Get started/i }).first();
  await cta.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await cta.isVisible().catch(() => false)) await cta.click();
}

// Mobile-aware login. The desktop helper's post-login sentinel is the sidebar
// "Upcoming Matches" tab, which is hidden inside the drawer on mobile. The
// UserMenu trigger (aria-haspopup="menu") is always rendered after login and
// works on every viewport.
async function loginMobile(page, { username, password }) {
  await page.goto('/');
  await dismissLanding(page);
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  // DashboardView's 3-row mobile / 1-row desktop split renders the UserMenu
  // twice (one CSS-hidden via md:hidden), so [aria-haspopup="menu"] matches
  // 2 elements. `:visible` picks the one currently visible at the viewport
  // (DOM order isn't a reliable proxy — desktop layout is rendered first).
  await page.locator('[aria-haspopup="menu"]:visible').waitFor({ timeout: 15_000 });
}

async function openSidebarTab(page, tabName) {
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('tab', { name: tabName }).click();
  // Drawer auto-closes on selection; give the layout one frame to settle.
  await page.waitForTimeout(150);
}

test.describe('mobile screenshots', () => {
  test('landing', async ({ page }) => {
    await page.goto('/');
    // BANTRYX wordmark is the most reliable Landing sentinel.
    await page.getByRole('heading', { name: 'BANTRYX' }).waitFor({ timeout: 10_000 });
    await shot(page, '01-landing');
  });

  test('landing - bottom CTA', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { name: 'BANTRYX' }).waitFor({ timeout: 10_000 });
    // eslint-disable-next-line no-undef -- window/document are browser globals inside page.evaluate
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await shot(page, '02-landing-bottom', { fullPage: false });
  });

  test('auth grid - sign in', async ({ page }) => {
    await page.goto('/');
    await dismissLanding(page);
    await page.locator('#login-username').waitFor({ timeout: 5_000 });
    await shot(page, '03-auth-grid');
  });

  test('anon dashboard - games', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: /browse as a guest/i })
      .first()
      .click();
    await page.getByRole('heading', { name: 'Games' }).first().waitFor({ timeout: 10_000 });
    await shot(page, '04-anon-games');
  });

  test('anon dashboard - signin modal on pick', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: /browse as a guest/i })
      .first()
      .click();
    await page.getByRole('heading', { name: 'Games' }).first().waitFor({ timeout: 10_000 });
    // First pick button on the first GameCard pops the SignInModal.
    await page.locator('button[aria-label^="Pick "]').first().click();
    await page.getByRole('dialog').waitFor({ timeout: 5_000 });
    await page.waitForTimeout(150);
    await shot(page, '05-anon-signin-modal', { fullPage: false });
  });

  test('search dropdown - mobile', async ({ page }) => {
    await loginMobile(page, USERS.alice);
    // Tier 11 Chunk 3 — search input is now always-visible on row 3 of the
    // mobile top bar. There's no "Search" trigger or fullscreen overlay.
    // SearchBar is rendered twice (mobile + desktop layouts, one CSS-hidden);
    // .first() targets the visible mobile instance.
    const input = page.locator('input[type="search"]').first();
    await input.fill('test');
    // Debounced search + dropdown render
    await page.waitForTimeout(500);
    await shot(page, '06-search-dropdown', { fullPage: false });
  });

  test('authed - games', async ({ page }) => {
    await loginMobile(page, USERS.alice);
    await page.getByRole('heading', { name: 'Games' }).first().waitFor({ timeout: 10_000 });
    await shot(page, '07-authed-games');
  });

  test('authed - sidebar drawer open', async ({ page }) => {
    await loginMobile(page, USERS.alice);
    await page.getByRole('heading', { name: 'Games' }).first().waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('dialog', { name: 'Dashboard navigation' }).waitFor({ timeout: 5_000 });
    await page.waitForTimeout(150);
    await shot(page, '08-authed-drawer-open', { fullPage: false });
  });

  test('authed - groups', async ({ page }) => {
    await loginMobile(page, USERS.alice);
    // Phase 1 follow-up — sidebar kicker dropped; entry is exactly "Groups".
    await openSidebarTab(page, /^Groups$/);
    // GroupsView renders a level-2 "Groups" header above the sub-tabs.
    await page.getByRole('heading', { name: 'Groups', level: 2 }).waitFor({ timeout: 10_000 });
    await shot(page, '09-authed-groups');
  });

  test('authed - leaderboard', async ({ page }) => {
    await loginMobile(page, USERS.alice);
    await openSidebarTab(page, /^Leaderboards$/);
    // LeaderboardView's Overall sub-tab is default; its LeaderboardCard
    // renders the "Overall Leaderboard" h2.
    await page.getByRole('heading', { name: 'Overall Leaderboard' }).waitFor({ timeout: 10_000 });
    await shot(page, '10-authed-leaderboard');
  });

  test('authed - profile', async ({ page }) => {
    await loginMobile(page, USERS.alice);
    await openSidebarTab(page, /^Profile$/);
    // Profile heading is the user's display name / username, not literal
    // "Profile". The "Total points" stat block (rendered by the Overview
    // sub-tab, the SubTabs default) is a stable sentinel.
    await page.getByText('Total points').first().waitFor({ timeout: 10_000 });
    await shot(page, '11-authed-profile');
  });

  test('authed - user menu open', async ({ page }) => {
    await loginMobile(page, USERS.alice);
    await page.getByRole('heading', { name: 'Games' }).first().waitFor({ timeout: 10_000 });
    await page.locator('[aria-haspopup="menu"]:visible').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).waitFor({ timeout: 5_000 });
    await page.waitForTimeout(100);
    await shot(page, '12-authed-user-menu', { fullPage: false });
  });
});
