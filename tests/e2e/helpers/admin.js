'use strict';

// Tier 5.5b — admin navigation helpers. The Admin tab in DashboardView is
// labelled "Manage" (kicker "Admin", id 'admin'). AdminPanel is lazy-loaded,
// so callers must wait for the Games heading (or another stable anchor)
// before interacting with the panel.
const { expect } = require('@playwright/test');

async function openAdminTab(page) {
  await page.getByRole('tab', { name: /Manage/ }).click();
  await expect(page.getByRole('heading', { name: 'Games', level: 3 })).toBeVisible({
    timeout: 20_000,
  });
}

module.exports = { openAdminTab };
