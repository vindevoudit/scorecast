'use strict';

// Tier 5.5b — notification bell + badge unlock invariants:
//  (1) Setting a game result triggers `notify('pick-scored', …)` for every
//      user who picked that game, AND BadgeService.evaluateBadges() may
//      award `first-pick` / `first-win` etc. — each badge fires its own
//      notification (Tier 5.4 / Tier 13.4 invariant).
//  (2) The bell shows the unread count; clicking a row hits
//      POST /api/notifications/:id/read and the count drops by 1.
//      "Mark all read" hits /api/notifications/read-all and clears it.
//
// Each test resets alice's notification + badge + pick state and the Lions
// game result so the badge unlocks are deterministic. The Lions game is
// 50/50 — pick home + result home = 50 points and earns first-pick + first-win.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const {
  apiLogin,
  setGameResult,
  clearPicksAndBadges,
  clearNotifications,
  clearGameResults,
  getUserId,
} = require('./helpers/api');
const { USERS, GAMES } = require('./fixtures/data');

let aliceId;

test.beforeAll(async () => {
  aliceId = await getUserId(USERS.alice.username);
  if (!aliceId) throw new Error('notifications-badges: missing alice fixture');
});

test.beforeEach(async () => {
  // Order matters: clear picks first (a pick rowblocks game-result cleanup
  // in production; here we just delete both). Then notifications, then result.
  await clearPicksAndBadges([aliceId]);
  await clearNotifications([aliceId]);
  await clearGameResults([GAMES.lions.id]);
});

test.afterAll(async () => {
  // Reset whatever this file touched so later specs see fresh state. We
  // intentionally don't close the Sequelize pool — workers:1 keeps the
  // require('models') cache live across specs.
  if (aliceId) {
    await clearPicksAndBadges([aliceId]);
    await clearNotifications([aliceId]);
  }
  await clearGameResults([GAMES.lions.id]);
});

async function pickLionsAndScore(page) {
  await loginViaUI(page, USERS.alice);
  const pickButton = page.getByRole('button', {
    name: `Pick ${GAMES.lions.homeTeam} to win`,
    exact: true,
  });
  await expect(pickButton).toBeVisible({ timeout: 15_000 });
  await pickButton.click();
  await expect(page.getByText(`Your pick: ${GAMES.lions.homeTeam}`)).toBeVisible({
    timeout: 10_000,
  });

  // Admin sets the result via API. Bell polls every 30 s, so we don't want to
  // wait that long — instead reload the page after the result is set so the
  // bell's first fetch reflects the new state.
  const adminApi = await apiLogin(USERS.admin);
  try {
    await setGameResult(adminApi, GAMES.lions.id, 'home');
  } finally {
    await adminApi.dispose();
  }
  await page.reload();
}

test('badge unlock + pick-scored notification: bell shows fresh unread items', async ({ page }) => {
  await pickLionsAndScore(page);

  // Bell button's aria-label embeds the unread count. After a fresh pick+score:
  //   • 1 "Your pick on … +50 pts" notification
  //   • 1 first-pick badge notification
  //   • 1 first-win badge notification
  // → 3 unread.
  const bell = page.getByRole('button', { name: /^Notifications,\s+\d+ unread$/ });
  await expect(bell).toBeVisible({ timeout: 15_000 });
  const label = await bell.getAttribute('aria-label');
  const match = label?.match(/(\d+)\s+unread/);
  expect(match, `bell aria-label "${label}"`).not.toBeNull();
  expect(parseInt(match[1], 10)).toBeGreaterThanOrEqual(3);

  // Open the dropdown and confirm both notification types rendered.
  await bell.click();
  const tray = page.getByRole('button', { name: /Notifications/ }).locator('..');
  await expect(
    tray.getByText(`Your pick on ${GAMES.lions.homeTeam} vs ${GAMES.lions.awayTeam}:`, {
      exact: false,
    }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(tray.getByText(/Badge earned: First Pick/i)).toBeVisible();
  await expect(tray.getByText(/Badge earned: First Win/i)).toBeVisible();
});

test('mark-as-read: clicking a notification decrements the unread count; mark-all clears it', async ({
  page,
}) => {
  await pickLionsAndScore(page);

  // Wait for the bell to reach a non-zero unread state.
  const bell = page.getByRole('button', { name: /^Notifications,\s+\d+ unread$/ });
  await expect(bell).toBeVisible({ timeout: 15_000 });
  const initialLabel = await bell.getAttribute('aria-label');
  const initialCount = parseInt(initialLabel.match(/(\d+)\s+unread/)[1], 10);
  expect(initialCount).toBeGreaterThanOrEqual(3);

  await bell.click();

  // Click the "First Pick" badge notification by its visible text. Each
  // notification row is a button; matching on the unique badge text avoids
  // depending on tray DOM structure.
  const firstPickRow = page.getByRole('button').filter({ hasText: /Badge earned: First Pick/i });
  await firstPickRow.click();

  // Bell label now shows initialCount - 1.
  await expect
    .poll(
      async () => {
        const lbl = await bell.getAttribute('aria-label');
        const m = lbl?.match(/(\d+)\s+unread/);
        return m ? parseInt(m[1], 10) : null;
      },
      { timeout: 10_000 },
    )
    .toBe(initialCount - 1);

  // Click "Mark all read".
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click();

  // Bell aria-label collapses to "Notifications" (no count) when 0 unread.
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible({
    timeout: 10_000,
  });
});
