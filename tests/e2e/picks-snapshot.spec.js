'use strict';

// Pick-time probability snapshot + odds-shifted notifications + undo modal.
//
// Locks down the eight invariants from the snapshot-tier design doc:
//   1. Snapshot freezes scoring against admin probability shifts.
//   2. Mixed-state: snapshotted vs legacy NULL picks score against their
//      respective sources in the same leaderboard build.
//   3. Material payout shift fires exactly one `odds-shifted` notification.
//   4. Sub-rounding shift is suppressed by the game-level Δ ≥ 0.01 gate.
//   5. 24h cooldown suppresses a second material shift for the same
//      (userId, gameId) pair within the window.
//   6. NULL-snapshot picks never trigger odds-shifted notifications.
//   7. UI: undo ConfirmModal appears when locked payout > current payout.
//   8. UI: undo proceeds without modal when locked payout ≤ current.

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const {
  apiLogin,
  createPick,
  setGameResult,
  getLeaderboard,
  getNotifications,
  clearPicksAndBadges,
  clearNotifications,
  clearGameResults,
  getUserId,
} = require('./helpers/api');
const { USERS, GAMES } = require('./fixtures/data');

let aliceId;
let bobId;

async function updateGameProbabilities(adminApi, gameId, { home, draw = 0, away }) {
  const res = await adminApi.put(`/api/admin/games/${gameId}`, {
    data: { homeProbability: home, drawProbability: draw, awayProbability: away },
  });
  if (!res.ok()) {
    throw new Error(`updateGameProbabilities ${gameId}: ${res.status()} ${await res.text()}`);
  }
}

async function resetGameProbabilities(adminApi) {
  for (const fixture of Object.values(GAMES)) {
    await updateGameProbabilities(adminApi, fixture.id, {
      home: fixture.homeProbability,
      draw: 0,
      away: fixture.awayProbability,
    });
  }
}

// Manually create a legacy pick row with NULL snapshot columns. Simulates a
// pick made before the snapshot migration deployed. Goes through the model
// directly because PickService.createPick now always writes snapshots — so
// the only way to get NULL is to bypass it.
async function createLegacyNullPick(userId, gameId, choice) {
  const { Pick } = require('../../models');
  return Pick.create({
    userId,
    gameId,
    choice,
    pickedHomeProbability: null,
    pickedDrawProbability: null,
    pickedAwayProbability: null,
  });
}

test.beforeAll(async () => {
  aliceId = await getUserId(USERS.alice.username);
  bobId = await getUserId(USERS.bob.username);
});

test.beforeEach(async () => {
  await clearPicksAndBadges([aliceId, bobId]);
  await clearNotifications([aliceId, bobId]);
  await clearGameResults([GAMES.lions.id, GAMES.eagles.id, GAMES.wolves.id]);
  const adminApi = await apiLogin(USERS.admin);
  try {
    await resetGameProbabilities(adminApi);
  } finally {
    await adminApi.dispose();
  }
});

test.afterAll(async () => {
  if (aliceId && bobId) {
    await clearPicksAndBadges([aliceId, bobId]);
    await clearNotifications([aliceId, bobId]);
  }
  await clearGameResults([GAMES.lions.id, GAMES.eagles.id, GAMES.wolves.id]);
  const adminApi = await apiLogin(USERS.admin);
  try {
    await resetGameProbabilities(adminApi);
  } finally {
    await adminApi.dispose();
  }
});

// ---------------------------------------------------------------------------
// 1. Snapshot freezes scoring.
// ---------------------------------------------------------------------------
test('snapshot freezes scoring across an admin probability shift', async () => {
  // Eagles: home 0.6 / away 0.4 → home pick locks in payout = round((1-0.6)*100) = 40.
  const aliceApi = await apiLogin(USERS.alice);
  const adminApi = await apiLogin(USERS.admin);
  try {
    await createPick(aliceApi, GAMES.eagles.id, 'home');

    // Drift home → 0.3 (would pay +70 if we re-picked now). Snapshot must
    // win when the result lands.
    await updateGameProbabilities(adminApi, GAMES.eagles.id, { home: 0.3, away: 0.7 });
    await setGameResult(adminApi, GAMES.eagles.id, 'home');

    const lb = await getLeaderboard(adminApi);
    const aliceRow = lb.overall.find((r) => r.username === USERS.alice.username);
    expect(aliceRow.points).toBe(40);
  } finally {
    await aliceApi.dispose();
    await adminApi.dispose();
  }
});

// ---------------------------------------------------------------------------
// 2. Mixed-state: snapshotted pick + legacy NULL pick scored together.
// ---------------------------------------------------------------------------
test('snapshotted and legacy NULL picks score against their respective sources', async () => {
  const aliceApi = await apiLogin(USERS.alice);
  const adminApi = await apiLogin(USERS.admin);
  try {
    // Wolves: home 0.4 / away 0.6 → away snapshot locks at 0.60 → 40 pts.
    await createPick(aliceApi, GAMES.wolves.id, 'away');
    // Bob's pick predates the snapshot column → NULL → falls through to game.*.
    await createLegacyNullPick(bobId, GAMES.wolves.id, 'away');

    // Admin shifts to home 0.7 / away 0.3.
    await updateGameProbabilities(adminApi, GAMES.wolves.id, { home: 0.7, away: 0.3 });
    await setGameResult(adminApi, GAMES.wolves.id, 'away');

    const lb = await getLeaderboard(adminApi);
    const aliceRow = lb.overall.find((r) => r.username === USERS.alice.username);
    const bobRow = lb.overall.find((r) => r.username === USERS.bob.username);
    // Alice: snapshot away = 0.60 → 40 pts.
    expect(aliceRow.points).toBe(40);
    // Bob: NULL snapshot → falls through to game.awayProbability = 0.30 → 70 pts.
    expect(bobRow.points).toBe(70);
  } finally {
    await aliceApi.dispose();
    await adminApi.dispose();
  }
});

// ---------------------------------------------------------------------------
// 3. Material payout shift fires odds-shifted notification.
// ---------------------------------------------------------------------------
test('odds-shifted notification fires when rounded payout changes', async () => {
  const aliceApi = await apiLogin(USERS.alice);
  const adminApi = await apiLogin(USERS.admin);
  try {
    await createPick(aliceApi, GAMES.lions.id, 'home');
    // 0.50 home (locked +50) → 0.40 home (current +60). Material shift.
    await updateGameProbabilities(adminApi, GAMES.lions.id, { home: 0.4, away: 0.6 });

    const { items } = await getNotifications(aliceApi);
    const oddsShifted = items.filter((n) => n.type === 'odds-shifted');
    expect(oddsShifted.length).toBe(1);
    expect(oddsShifted[0].title).toContain(GAMES.lions.homeTeam);
    expect(oddsShifted[0].body).toContain('+50');
    expect(oddsShifted[0].body).toContain('+60');
  } finally {
    await aliceApi.dispose();
    await adminApi.dispose();
  }
});

// ---------------------------------------------------------------------------
// 4. Sub-rounding shift suppressed by the game-level Δ ≥ 0.01 gate.
// ---------------------------------------------------------------------------
test('odds-shifted suppressed on sub-rounding probability shift', async () => {
  const aliceApi = await apiLogin(USERS.alice);
  const adminApi = await apiLogin(USERS.admin);
  try {
    await createPick(aliceApi, GAMES.lions.id, 'home');
    // 0.503 / 0.497 round to 0.50 / 0.50 in DECIMAL(3,2) storage. The
    // in-memory delta against the prior 0.50 is 0.003 < 0.01 → game-level
    // gate blocks before we even reach the pick query.
    await updateGameProbabilities(adminApi, GAMES.lions.id, { home: 0.503, away: 0.497 });

    const { items } = await getNotifications(aliceApi);
    const oddsShifted = items.filter((n) => n.type === 'odds-shifted');
    expect(oddsShifted.length).toBe(0);
  } finally {
    await aliceApi.dispose();
    await adminApi.dispose();
  }
});

// ---------------------------------------------------------------------------
// 5. 24h cooldown — second material shift within window is suppressed.
// ---------------------------------------------------------------------------
test('odds-shifted suppressed on second material shift within 24h cooldown', async () => {
  const aliceApi = await apiLogin(USERS.alice);
  const adminApi = await apiLogin(USERS.admin);
  try {
    await createPick(aliceApi, GAMES.lions.id, 'home');
    // First shift: 0.50 → 0.40 (locked +50, current +60). Fires.
    await updateGameProbabilities(adminApi, GAMES.lions.id, { home: 0.4, away: 0.6 });
    // Second shift: 0.40 → 0.30 (current +70 now). Would fire on its own,
    // but the prior notification's (userId, gameId, type) is within 24h.
    await updateGameProbabilities(adminApi, GAMES.lions.id, { home: 0.3, away: 0.7 });

    const { items } = await getNotifications(aliceApi);
    const oddsShifted = items.filter((n) => n.type === 'odds-shifted');
    expect(oddsShifted.length).toBe(1);
  } finally {
    await aliceApi.dispose();
    await adminApi.dispose();
  }
});

// ---------------------------------------------------------------------------
// 6. NULL-snapshot picks are silently skipped — no notification.
// ---------------------------------------------------------------------------
test('NULL-snapshot legacy picks never trigger odds-shifted notifications', async () => {
  const adminApi = await apiLogin(USERS.admin);
  const bobApi = await apiLogin(USERS.bob);
  try {
    await createLegacyNullPick(bobId, GAMES.lions.id, 'home');

    // Material shift.
    await updateGameProbabilities(adminApi, GAMES.lions.id, { home: 0.3, away: 0.7 });

    const { items } = await getNotifications(bobApi);
    const oddsShifted = items.filter((n) => n.type === 'odds-shifted');
    expect(oddsShifted.length).toBe(0);
  } finally {
    await adminApi.dispose();
    await bobApi.dispose();
  }
});

// ---------------------------------------------------------------------------
// 7. UI: undo confirm modal appears when locked > current.
// ---------------------------------------------------------------------------
test('undo confirm modal appears when locked payout exceeds current', async ({ page }) => {
  // Setup: alice picks lions home at 0.5 (locked +50). Admin shifts to 0.7
  // home (current +30). lockedPayout > currentPayout → modal opens.
  const aliceApi = await apiLogin(USERS.alice);
  const adminApi = await apiLogin(USERS.admin);
  try {
    await createPick(aliceApi, GAMES.lions.id, 'home');
    await updateGameProbabilities(adminApi, GAMES.lions.id, { home: 0.7, away: 0.3 });
  } finally {
    await aliceApi.dispose();
    await adminApi.dispose();
  }

  await loginViaUI(page, USERS.alice);

  // Only one pick → exactly one "Undo pick" button on the page.
  await page.getByRole('button', { name: 'Undo pick' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(dialog).toContainText('+50');
  await expect(dialog).toContainText('+30');

  // Cancel keeps the pick.
  await dialog.getByRole('button', { name: 'Keep my pick' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  // Pick still present.
  await expect(page.getByText(`Your pick: ${GAMES.lions.homeTeam}`).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// 8. UI: undo proceeds without modal when locked ≤ current.
// ---------------------------------------------------------------------------
test('undo skips modal when locked payout does not exceed current', async ({ page }) => {
  // Setup: alice picks lions home at 0.5 (locked +50). Admin shifts to 0.4
  // home (current +60). lockedPayout < currentPayout → no modal.
  const aliceApi = await apiLogin(USERS.alice);
  const adminApi = await apiLogin(USERS.admin);
  try {
    await createPick(aliceApi, GAMES.lions.id, 'home');
    await updateGameProbabilities(adminApi, GAMES.lions.id, { home: 0.4, away: 0.6 });
  } finally {
    await aliceApi.dispose();
    await adminApi.dispose();
  }

  await loginViaUI(page, USERS.alice);

  await page.getByRole('button', { name: 'Undo pick' }).click();

  // Pick is removed; the "Your pick:" line for lions disappears within the
  // standard refresh window. The dialog never opens.
  await expect(page.getByText(`Your pick: ${GAMES.lions.homeTeam}`)).not.toBeVisible({
    timeout: 10_000,
  });
});
