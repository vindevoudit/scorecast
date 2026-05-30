'use strict';

// Tier 5.5b — admin navigation helpers. The Admin tab in DashboardView is
// labelled "Manage" (kicker "Admin", id 'admin'). AdminPanel is lazy-loaded.
// Tier 30 Phase 1 Chunk 1.3 — AdminPanel restructured into SubTabs
// (Leagues / Games / Users / Audit). `openAdminTab` lands on Games by
// default (matches the pre-refactor behavior where Games was the second
// section and most admin work touches it). Use `openAdminSubTab` to
// navigate to a different sub-tab.

const { expect } = require('@playwright/test');

async function openAdminTab(page) {
  // Phase 1 follow-up — sidebar kickers dropped; admin entry is now
  // labelled "Admin" (was previously "Manage" with kicker "Admin").
  // The sidebar tab and the GameManager's role="tab" sub-tab don't
  // collide because the SubTab is exactly "Games" + the sidebar is
  // exactly "Admin".
  await page.getByRole('tab', { name: /^Admin$/ }).click();
  // SubTabs.defaultValue = 'games' — the Games heading is the stable
  // sentinel that the GameManager has hydrated.
  await expect(page.getByRole('heading', { name: 'Games', level: 3 })).toBeVisible({
    timeout: 20_000,
  });
}

async function openAdminSubTab(page, label) {
  // Sub-tab triggers use Radix Tabs' role="tab". Labels are the literal
  // human labels: Leagues / Games / Users / Audit.
  await page.getByRole('tab', { name: label, exact: true }).click();
}

module.exports = { openAdminTab, openAdminSubTab };
