'use strict';

const { test, expect } = require('@playwright/test');
const { registerViaUI, loginViaUI, logoutViaUI } = require('./helpers/auth');
const { USERS, GAMES } = require('./fixtures/data');

// 5.5.3 — Register → pick → admin set result → leaderboard updates.
test('register, pick a game, admin sets result, leaderboard reflects points', async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const newUser = {
    username: `e2e_new_${stamp}`,
    email: `e2e-new-${stamp}@example.test`,
    password: 'FreshUserPassword123!',
  };
  const game = GAMES.lions;
  // 50/50 game: home pick → 100 - round(0.5 * 100) = 50 points if correct.
  const expectedPoints = 50;

  // --- Phase 1: new user registers and picks Test Lions to win. ---
  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  await registerViaUI(userPage, newUser);

  await userPage.getByRole('button', { name: `Pick ${game.homeTeam} to win`, exact: true }).click();

  // GameCard renders "Your pick: <team>" after a successful pick.
  await expect(userPage.getByText(`Your pick: ${game.homeTeam}`)).toBeVisible();

  await logoutViaUI(userPage);
  await userContext.close();

  // --- Phase 2: admin logs in, opens Manage tab, sets Lions as the winner. ---
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await loginViaUI(adminPage, USERS.admin);

  await adminPage.getByRole('tab', { name: /Manage/ }).click();
  // AdminPanel is lazy — wait for the Games heading inside it.
  await expect(adminPage.getByRole('heading', { name: 'Games', level: 3 })).toBeVisible({
    timeout: 20_000,
  });

  // Find the row for this game by intersecting the team text + the "Home won"
  // button. This identifies a single GameRow without depending on Tailwind
  // class names that may change.
  const row = adminPage
    .locator('div')
    .filter({ hasText: `${game.homeTeam} vs ${game.awayTeam}` })
    .filter({ has: adminPage.getByRole('button', { name: 'Home won', exact: true }) })
    .last();

  await row.getByRole('button', { name: 'Home won', exact: true }).click();

  // GameRow renders "Result: <team>" after the result is committed.
  await expect(adminPage.getByText(`Result: ${game.homeTeam}`)).toBeVisible({ timeout: 10_000 });

  await logoutViaUI(adminPage);
  await adminContext.close();

  // --- Phase 3: new user logs back in, checks Rankings tab. ---
  const verifyContext = await browser.newContext();
  const verifyPage = await verifyContext.newPage();
  await loginViaUI(verifyPage, { username: newUser.username, password: newUser.password });

  await verifyPage.getByRole('tab', { name: /Rankings/ }).click();

  // LeaderboardRow renders as a button when onSelectUser is wired (which the
  // app always does). Exclude `[aria-haspopup]` so we skip the UserMenu
  // trigger in the top bar (also contains the username), then assert the
  // points cell on the actual leaderboard row.
  const leaderboardRow = verifyPage
    .locator('button:not([aria-haspopup])')
    .filter({ hasText: newUser.username });
  await expect(leaderboardRow).toBeVisible({ timeout: 15_000 });
  await expect(leaderboardRow).toContainText(String(expectedPoints));

  await verifyContext.close();
});
