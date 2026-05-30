'use strict';

// Tier 30 Phase 1 Chunk 1.3 — AdminPanel restructured into SubTabs
// (Leagues / Games / Users / Audit). Default sub-tab is Games so callers
// that just want to set a result land where they were pre-refactor.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { openAdminTab, openAdminSubTab } = require('./helpers/admin');
const { USERS } = require('./fixtures/data');

test('AdminPanel mounts four sub-tabs; Games is the default', async ({ page }) => {
  await loginViaUI(page, USERS.admin);
  await openAdminTab(page);

  // Sub-tab triggers render as Radix Tabs role="tab".
  for (const label of ['Leagues', 'Games', 'Users', 'Audit']) {
    await expect(page.getByRole('tab', { name: label, exact: true })).toBeVisible();
  }

  // Default → Games sub-tab is active; GameManager's h3 is visible.
  await expect(page.getByRole('tab', { name: 'Games', exact: true })).toHaveAttribute(
    'data-state',
    'active',
  );
  await expect(page.getByRole('heading', { name: 'Games', level: 3 }).first()).toBeVisible();
});

test('clicking Users sub-tab reveals UserManager + ?tab=users URL sync', async ({ page }) => {
  await loginViaUI(page, USERS.admin);
  await openAdminTab(page);
  await openAdminSubTab(page, 'Users');

  await expect(page).toHaveURL(/\?tab=users/);
  await expect(page.getByRole('heading', { name: 'Users', level: 3 }).first()).toBeVisible({
    timeout: 10_000,
  });
});

test('clicking Audit sub-tab reveals the AuditLog surface', async ({ page }) => {
  await loginViaUI(page, USERS.admin);
  await openAdminTab(page);
  await openAdminSubTab(page, 'Audit');

  await expect(page).toHaveURL(/\?tab=audit/);
  await expect(page.getByRole('heading', { name: /Audit Log/i }).first()).toBeVisible({
    timeout: 10_000,
  });
});
