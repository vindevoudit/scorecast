'use strict';

// Tier 5.5b — probability-weighted scoring + cache invalidation.
//
// scorePick formula (lib/scoring.js):
//   if pick.choice !== game.result: 0 points
//   if pick.choice === game.result: round((1 - probability_of_chosen_side) * 100)
//
// Fixture games (tests/e2e/fixtures/data.js):
//   • Lions:   home 0.5 / away 0.5  — 50/50
//   • Eagles:  home 0.6 / away 0.4  — home favored
//   • Wolves:  home 0.4 / away 0.6  — away favored
//
// Scenario verified here:
//   alice picks all favorites: Lions=home, Eagles=home, Wolves=away
//   bob picks   all underdogs: Lions=home (50/50), Eagles=away, Wolves=home
//   admin sets results:                            home,      away,        home
//
// Expected per-game points:
//   Lions  home, prob 0.5: alice +50, bob +50
//   Eagles away, prob 0.4: alice 0 (chose home favorite which lost), bob +60
//   Wolves home, prob 0.4: alice 0 (chose away favorite which lost), bob +60
//
//   alice total = 50 +  0 +  0 =  50
//   bob   total = 50 + 60 + 60 = 170
//
// This proves:
//   (1) Server-side scoring matches lib/scoring.js → bob's underdog wins are
//       worth more than alice's would-be favorite wins.
//   (2) Tier 5.2 cache invalidation: after each setResult the next
//       /api/leaderboard call reflects the updated totals immediately, not
//       after the 30 s TTL.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const {
  apiLogin,
  createPick,
  setGameResult,
  getLeaderboard,
  clearPicksAndBadges,
  clearNotifications,
  clearGameResults,
  getUserId,
} = require('./helpers/api');
const { USERS, GAMES } = require('./fixtures/data');

const EXPECTED_ALICE_POINTS = 50;
const EXPECTED_BOB_POINTS = 170;

let aliceId;
let bobId;

test.beforeAll(async () => {
  aliceId = await getUserId(USERS.alice.username);
  bobId = await getUserId(USERS.bob.username);
});

test.beforeEach(async () => {
  await clearPicksAndBadges([aliceId, bobId]);
  await clearNotifications([aliceId, bobId]);
  await clearGameResults([GAMES.lions.id, GAMES.eagles.id, GAMES.wolves.id]);
});

test.afterAll(async () => {
  // Leave the DB clean for downstream specs but keep the Sequelize pool open
  // — workers:1 shares require('models') across specs and closing it here
  // would break whoever runs next.
  if (aliceId && bobId) {
    await clearPicksAndBadges([aliceId, bobId]);
    await clearNotifications([aliceId, bobId]);
  }
  await clearGameResults([GAMES.lions.id, GAMES.eagles.id, GAMES.wolves.id]);
});

test('probability-weighted scoring: underdog wins outscore favorite wins; cache reflects each setResult immediately', async ({
  page,
}) => {
  // --- Phase 1: alice + bob place picks via API. ---
  const aliceApi = await apiLogin(USERS.alice);
  const bobApi = await apiLogin(USERS.bob);
  const adminApi = await apiLogin(USERS.admin);
  try {
    await createPick(aliceApi, GAMES.lions.id, 'home');
    await createPick(aliceApi, GAMES.eagles.id, 'home');
    await createPick(aliceApi, GAMES.wolves.id, 'away');
    await createPick(bobApi, GAMES.lions.id, 'home');
    await createPick(bobApi, GAMES.eagles.id, 'away');
    await createPick(bobApi, GAMES.wolves.id, 'home');

    // --- Phase 2: admin sets results one at a time. After each setResult the
    // leaderboard cache is invalidated; the next GET should reflect the new
    // total well within the 30 s TTL. ---
    await setGameResult(adminApi, GAMES.lions.id, 'home');
    let lb = await getLeaderboard(adminApi);
    expectPoints(lb.overall, USERS.alice.username, 50);
    expectPoints(lb.overall, USERS.bob.username, 50);

    await setGameResult(adminApi, GAMES.eagles.id, 'away');
    lb = await getLeaderboard(adminApi);
    expectPoints(lb.overall, USERS.alice.username, 50); // still 50; eagles was wrong
    expectPoints(lb.overall, USERS.bob.username, 110); // 50 + 60

    await setGameResult(adminApi, GAMES.wolves.id, 'home');
    lb = await getLeaderboard(adminApi);
    expectPoints(lb.overall, USERS.alice.username, EXPECTED_ALICE_POINTS);
    expectPoints(lb.overall, USERS.bob.username, EXPECTED_BOB_POINTS);

    // --- Phase 3: UI verifies the same totals via the Rankings tab. ---
    await loginViaUI(page, USERS.alice);
    await page.getByRole('tab', { name: /Rankings/ }).click();

    // Exclude `[aria-haspopup]` so we skip the UserMenu trigger in the top
    // bar (also contains the logged-in username), and target the actual
    // leaderboard rows.
    const aliceRow = page
      .locator('button:not([aria-haspopup])')
      .filter({ hasText: USERS.alice.username })
      .first();
    const bobRow = page
      .locator('button:not([aria-haspopup])')
      .filter({ hasText: USERS.bob.username })
      .first();
    await expect(aliceRow).toContainText(String(EXPECTED_ALICE_POINTS), { timeout: 15_000 });
    await expect(bobRow).toContainText(String(EXPECTED_BOB_POINTS), { timeout: 15_000 });
  } finally {
    await aliceApi.dispose();
    await bobApi.dispose();
    await adminApi.dispose();
  }
});

function expectPoints(rows, username, points) {
  const row = rows.find((r) => r.username === username);
  expect(row, `leaderboard row for ${username}`).toBeTruthy();
  expect(row.points).toBe(points);
}
