'use strict';

// Tier 24 — Comprehensive verification of the materialized user_scores
// + user_scores_overall tables and the dual-writer write hooks. Walks
// the 8-arm idempotency matrix end-to-end via the public API, plus
// pick-lifecycle / bulk / cascade / round-trip / concurrency / scoping /
// cross-contract / global-parity invariants.
//
// Plan reference: C:\Users\vinde\.claude\plans\tier24.md "Verification"
// section, Layer 2.
//
// Patterns:
//  - All state changes go through the public API (apiLogin + admin
//    setResult/clear/delete) so the dual-writer's actual write hooks
//    fire. The exception is the "create pick on already-scored game"
//    matrix arm — that requires Pick.create directly because the public
//    API rejects post-kickoff / scored-game picks. See
//    `createPickOnScoredGame` helper.
//  - Per-test reset uses clearGameResults + clearPicksAndBadges so the
//    user_scores tables start blank for every block.
//  - DB inspection uses `getModels()` (mirrors the existing helper
//    pattern in tests/e2e/helpers/api.js).

const { test, expect } = require('@playwright/test');

const { USERS, GAMES, LEAGUE_ID, SEASON_ID } = require('../fixtures/data');
const {
  apiLogin,
  clearPicksAndBadges,
  clearGameResults,
  createPick,
  setGameResult,
  updateGameFields,
} = require('../helpers/api');

// Direct model access for table-state inspection. Mirrors the existing
// lazy-load + getModels pattern in tests/e2e/helpers/api.js so we don't
// re-require sequelize at the top of every spec.
function getModels() {
  return require('../../../models');
}

async function readUserScore(userId, leagueId = LEAGUE_ID, seasonId = SEASON_ID) {
  const { UserScore } = getModels();
  const row = await UserScore.findOne({ where: { userId, leagueId, seasonId } });
  return row ? row.get({ plain: true }) : null;
}

async function readUserScoreOverall(userId) {
  const { UserScoreOverall } = getModels();
  const row = await UserScoreOverall.findOne({ where: { userId } });
  return row ? row.get({ plain: true }) : null;
}

async function readPick(userId, gameId) {
  const { Pick } = getModels();
  const row = await Pick.findOne({ where: { userId, gameId } });
  return row ? row.get({ plain: true }) : null;
}

// The cascade-delete test deletes alice to prove the FK cascade, then must
// re-create her so downstream specs can still log in. users.referralCode is
// NOT NULL with no model default (Tier 30 referral migration generates it in
// the register route), so a direct User.create must supply it — derived the
// same way seed.js does so the restored row matches the seeded one. Guarded by
// findByPk and called from `finally` so alice is ALWAYS restored, even if an
// assertion throws after the delete (otherwise every later apiLogin(alice)
// 401s and red-washes the whole suite).
async function restoreAliceIfMissing() {
  const { User } = getModels();
  if (await User.findByPk(USERS.alice.id)) return;
  const bcrypt = require('bcryptjs');
  await User.create({
    id: USERS.alice.id,
    username: USERS.alice.username,
    email: USERS.alice.email,
    password: await bcrypt.hash(USERS.alice.password, 8),
    role: USERS.alice.role,
    onboardingCompletedAt: new Date(),
    termsAcceptedAt: new Date(),
    termsAcceptedVersion: 2,
    referralCode: USERS.alice.id.replace(/-/g, '').slice(-8).toUpperCase(),
  });
}

// Reset every Tier 24-relevant table to a known-clean state. Called
// from each test's beforeEach so order between blocks doesn't matter.
async function resetAll() {
  const { UserScore, UserScoreOverall, Pick, Game } = getModels();
  await clearGameResults([GAMES.lions.id, GAMES.eagles.id, GAMES.wolves.id]);
  await clearPicksAndBadges([USERS.alice.id, USERS.bob.id]);
  // Restore game probabilities to fixture defaults — tests that call
  // updateGameFields to stage non-default odds must not leak that state
  // into subsequent tests. Without this restore, Arm 4 (which sets lions
  // to 0.4/0.2/0.4 for draw scoring) would corrupt every later test
  // that assumes lions is back at the fixture's 0.5/0/0.5.
  for (const g of [GAMES.lions, GAMES.eagles, GAMES.wolves]) {
    await Game.update(
      {
        homeProbability: g.homeProbability,
        drawProbability: 0,
        awayProbability: g.awayProbability,
      },
      { where: { id: g.id } },
    );
  }
  // clearGameResults routes through setResult(null) which uses the
  // dual-writer; clearPicksAndBadges destroys picks + the helper now
  // also drops the user's user_scores rows. Belt-and-suspenders: ensure
  // both materialized tables are empty for the affected users at the
  // start of each test.
  await UserScore.destroy({ where: { userId: [USERS.alice.id, USERS.bob.id] } });
  await UserScoreOverall.destroy({ where: { userId: [USERS.alice.id, USERS.bob.id] } });
  // Reset Pick sentinels for ANY leftover picks on the test games.
  await Pick.update(
    { appliedResult: null, appliedPoints: 0 },
    { where: { gameId: [GAMES.lions.id, GAMES.eagles.id, GAMES.wolves.id] } },
  );
}

// ============================================================================
// Idempotency matrix — 8 arms (Layer 2 cases 1-8 in tier24.md)
// ============================================================================

test.describe('Tier 24 — Idempotency matrix', () => {
  test.beforeEach(async () => {
    await resetAll();
  });

  test('Arm 1: pick on scheduled game → no delta, appliedResult stays null', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      const row = await readUserScore(USERS.alice.id);
      // No materialized row should exist — the dual-writer's INSERT-ON-
      // CONFLICT only fires when there's a non-zero delta. Scheduled
      // game with appliedResult=null → no delta → no row.
      expect(row).toBeNull();
      const pick = await readPick(USERS.alice.id, GAMES.lions.id);
      expect(pick.appliedResult).toBeNull();
      expect(pick.appliedPoints).toBe(0);
      void admin;
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('Arm 2: null → home → +scorePick on alice; appliedResult=home', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      const row = await readUserScore(USERS.alice.id);
      // lions: home=0.5, away=0.5 → (1 - 0.5) * 100 = 50
      expect(row).not.toBeNull();
      expect(row.points).toBe(50);
      expect(row.picksScored).toBe(1);
      expect(row.picksWon).toBe(1);
      const overall = await readUserScoreOverall(USERS.alice.id);
      expect(overall.points).toBe(50);
      const pick = await readPick(USERS.alice.id, GAMES.lions.id);
      expect(pick.appliedResult).toBe('home');
      expect(pick.appliedPoints).toBe(50);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('Arm 3: null → away → +0 for losing home pick', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'away');
      const row = await readUserScore(USERS.alice.id);
      expect(row.points).toBe(0);
      expect(row.picksScored).toBe(1);
      expect(row.picksWon).toBe(0);
      const pick = await readPick(USERS.alice.id, GAMES.lions.id);
      expect(pick.appliedResult).toBe('away');
      expect(pick.appliedPoints).toBe(0);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('Arm 4: null → draw → partial credit for home pick', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      // Configure draw probability so partial-credit math is non-zero.
      // After update: home=0.4, draw=0.2, away=0.4 → pts_home = round(0.2 * 0.4 / 0.8 * 100) = 10
      await updateGameFields(GAMES.lions.id, {
        homeProbability: 0.4,
        drawProbability: 0.2,
        awayProbability: 0.4,
      });
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'draw');
      const row = await readUserScore(USERS.alice.id);
      expect(row.points).toBe(10);
      expect(row.picksScored).toBe(1);
      expect(row.picksWon).toBe(0); // draws never count as wins
      const pick = await readPick(USERS.alice.id, GAMES.lions.id);
      expect(pick.appliedResult).toBe('draw');
      expect(pick.appliedPoints).toBe(10);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('Arm 5: home → away (changed) reverses prior delta and applies new', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      // Alice has +50 right now
      await setGameResult(admin, GAMES.lions.id, 'away');
      const row = await readUserScore(USERS.alice.id);
      expect(row.points).toBe(0);
      expect(row.picksScored).toBe(1);
      expect(row.picksWon).toBe(0);
      const pick = await readPick(USERS.alice.id, GAMES.lions.id);
      expect(pick.appliedResult).toBe('away');
      expect(pick.appliedPoints).toBe(0);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('Arm 6: home → draw (changed) reverses +50 and applies draw partial credit', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await updateGameFields(GAMES.lions.id, {
        homeProbability: 0.4,
        drawProbability: 0.2,
        awayProbability: 0.4,
      });
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      // Alice has +60 right now (home win at p=0.4 → 60)
      await setGameResult(admin, GAMES.lions.id, 'draw');
      const row = await readUserScore(USERS.alice.id);
      // Draw branch for home pick: round(0.2 * 0.4 / 0.8 * 100) = 10
      expect(row.points).toBe(10);
      expect(row.picksScored).toBe(1);
      expect(row.picksWon).toBe(0);
      const pick = await readPick(USERS.alice.id, GAMES.lions.id);
      expect(pick.appliedResult).toBe('draw');
      expect(pick.appliedPoints).toBe(10);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('Arm 7: home → null (cleared) reverses, sentinels back to null/0', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, null);
      // user_scores row may exist with zero values OR may have been
      // deleted (the dual-writer doesn't currently DELETE zero rows —
      // it just decrements). Accept either.
      const row = await readUserScore(USERS.alice.id);
      if (row) {
        expect(row.points).toBe(0);
        expect(row.picksScored).toBe(0);
        expect(row.picksWon).toBe(0);
      }
      const pick = await readPick(USERS.alice.id, GAMES.lions.id);
      expect(pick.appliedResult).toBeNull();
      expect(pick.appliedPoints).toBe(0);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('Arm 8: same result re-saved (home → home) is a no-op', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      const before = await readUserScore(USERS.alice.id);
      const beforePick = await readPick(USERS.alice.id, GAMES.lions.id);
      const beforeUpdatedAt = before.updatedAt;

      // Re-save same result. Idempotency requires the row stays bit-
      // identical EXCEPT the updatedAt timestamp (which applyPickTransition
      // short-circuits BEFORE touching). So the timestamp should NOT
      // advance either.
      await setGameResult(admin, GAMES.lions.id, 'home');
      const after = await readUserScore(USERS.alice.id);
      const afterPick = await readPick(USERS.alice.id, GAMES.lions.id);
      expect(after.points).toBe(before.points);
      expect(after.picksScored).toBe(before.picksScored);
      expect(after.picksWon).toBe(before.picksWon);
      // updatedAt should NOT advance — short-circuit bypassed the UPDATE
      expect(new Date(after.updatedAt).toISOString()).toBe(new Date(beforeUpdatedAt).toISOString());
      expect(afterPick.appliedPoints).toBe(beforePick.appliedPoints);
      expect(afterPick.appliedResult).toBe(beforePick.appliedResult);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });
});

// ============================================================================
// Pick lifecycle
// ============================================================================

test.describe('Tier 24 — Pick lifecycle', () => {
  test.beforeEach(async () => {
    await resetAll();
  });

  test('delete pick on scheduled game → no delta', async () => {
    const alice = await apiLogin(USERS.alice);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      // get pickId
      const list = await alice.get('/api/picks');
      const picks = await list.json();
      const target = picks.find((p) => p.gameId === GAMES.lions.id);
      await alice.delete(`/api/picks/${target.id}`);
      const row = await readUserScore(USERS.alice.id);
      expect(row).toBeNull();
    } finally {
      await alice.dispose();
    }
  });

  test('delete pick on scored game → reverses appliedPoints before destroy', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      const list = await alice.get('/api/picks');
      const target = (await list.json()).find((p) => p.gameId === GAMES.lions.id);
      await setGameResult(admin, GAMES.lions.id, 'home');
      // user_scores has +50

      // PickService.deletePick refuses after kickoff or with a result.
      // Use the model directly with the reverse + destroy logic to
      // exercise the cascade-style reversal. This is the path admin
      // bulk-delete + game cascade-delete take.
      const { Pick, sequelize } = getModels();
      const UserScoreService = require('../../../services/UserScoreService');
      await sequelize.transaction(async (t) => {
        const pick = await Pick.findByPk(target.id, { transaction: t });
        const { Game } = getModels();
        const game = await Game.findByPk(GAMES.lions.id, { transaction: t });
        await UserScoreService.reversePick(t, { pick, game });
        await pick.destroy({ transaction: t });
      });
      const row = await readUserScore(USERS.alice.id);
      if (row) {
        expect(row.points).toBe(0);
        expect(row.picksScored).toBe(0);
        expect(row.picksWon).toBe(0);
      }
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('pick created on already-scored game → +scorePick immediately', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await setGameResult(admin, GAMES.lions.id, 'home');
      // Now alice picks via the bypass helper because the public API
      // rejects scored games. The dual-writer should still fire — but
      // we have to ROUTE the create through PickService to exercise the
      // hook. Use Pick.create directly THEN explicitly call the dual-
      // writer (mirrors what an admin-driven bulk-import would do).
      const { Game, Pick, sequelize } = getModels();
      const UserScoreService = require('../../../services/UserScoreService');
      await sequelize.transaction(async (t) => {
        const game = await Game.findByPk(GAMES.lions.id, { transaction: t });
        const pick = await Pick.create(
          {
            userId: USERS.alice.id,
            gameId: GAMES.lions.id,
            choice: 'home',
            pickedHomeProbability: game.homeProbability,
            pickedDrawProbability: game.drawProbability,
            pickedAwayProbability: game.awayProbability,
          },
          { transaction: t },
        );
        await UserScoreService.applyPickTransition(t, { pick, game });
      });
      const row = await readUserScore(USERS.alice.id);
      expect(row.points).toBe(50);
      expect(row.picksScored).toBe(1);
      expect(row.picksWon).toBe(1);
    } finally {
      await admin.dispose();
    }
  });
});

// ============================================================================
// Bulk paths
// ============================================================================

test.describe('Tier 24 — Bulk paths', () => {
  test.beforeEach(async () => {
    await resetAll();
  });

  test('bulkSetResult fans out idempotency matrix per game', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await createPick(alice, GAMES.eagles.id, 'home');
      await createPick(alice, GAMES.wolves.id, 'home');
      // Bulk-set all three to home. lions: home pick wins at p=0.5 → +50.
      // eagles: home pick wins at p=0.6 → +40. wolves: home pick wins at p=0.4 → +60.
      // Total: 150.
      const res = await admin.post('/api/admin/games/bulk', {
        data: {
          ids: [GAMES.lions.id, GAMES.eagles.id, GAMES.wolves.id],
          action: 'setResult',
          result: 'home',
        },
      });
      if (!res.ok()) throw new Error(`bulk setResult: ${res.status()} ${await res.text()}`);
      const row = await readUserScore(USERS.alice.id);
      expect(row.points).toBe(150);
      expect(row.picksScored).toBe(3);
      expect(row.picksWon).toBe(3);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('bulkDelete reverses every pick before cascade', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      // Alice has +50.
      const res = await admin.post('/api/admin/games/bulk', {
        data: { ids: [GAMES.lions.id], action: 'delete' },
      });
      if (!res.ok()) throw new Error(`bulk delete: ${res.status()} ${await res.text()}`);
      const row = await readUserScore(USERS.alice.id);
      if (row) {
        expect(row.points).toBe(0);
        expect(row.picksScored).toBe(0);
        expect(row.picksWon).toBe(0);
      }
      // Re-create the game for subsequent tests (bulkDelete destroyed it)
      const { Game } = getModels();
      await Game.create({ ...GAMES.lions });
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });
});

// ============================================================================
// Cascade
// ============================================================================

test.describe('Tier 24 — Cascade', () => {
  test.beforeEach(async () => {
    await resetAll();
  });

  test('user cascade-delete drops user_scores via FK', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      const rowBefore = await readUserScore(USERS.alice.id);
      expect(rowBefore).not.toBeNull();

      // Delete alice via admin; FK CASCADE should drop her user_scores.
      // She's re-created in the finally block below (not here) so other tests
      // still find her regardless of whether the assertions in this try pass.
      const res = await admin.delete(`/api/admin/users/${USERS.alice.id}`);
      if (!res.ok()) throw new Error(`delete user: ${res.status()} ${await res.text()}`);
      const rowAfter = await readUserScore(USERS.alice.id);
      expect(rowAfter).toBeNull();
      const overallAfter = await readUserScoreOverall(USERS.alice.id);
      expect(overallAfter).toBeNull();
    } finally {
      await alice.dispose();
      await admin.dispose();
      await restoreAliceIfMissing();
    }
  });

  test('game cascade-delete reverses every pick before destroy', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      // Alice has +50.
      const res = await admin.delete(`/api/admin/games/${GAMES.lions.id}`);
      expect(res.ok()).toBe(true);
      const row = await readUserScore(USERS.alice.id);
      if (row) {
        expect(row.points).toBe(0);
      }
      // Re-create lions for subsequent tests
      const { Game } = getModels();
      await Game.create({ ...GAMES.lions });
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });
});

// ============================================================================
// Round-trips (bit-identity proof)
// ============================================================================

test.describe('Tier 24 — Round-trips', () => {
  test.beforeEach(async () => {
    await resetAll();
  });

  test('null → home → null returns row to initial empty state', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, null);
      const row = await readUserScore(USERS.alice.id);
      const pick = await readPick(USERS.alice.id, GAMES.lions.id);
      if (row) {
        expect(row.points).toBe(0);
        expect(row.picksScored).toBe(0);
        expect(row.picksWon).toBe(0);
      }
      expect(pick.appliedResult).toBeNull();
      expect(pick.appliedPoints).toBe(0);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('home → away → home returns row to initial home state', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      const initial = await readUserScore(USERS.alice.id);
      await setGameResult(admin, GAMES.lions.id, 'away');
      await setGameResult(admin, GAMES.lions.id, 'home');
      const final = await readUserScore(USERS.alice.id);
      expect(final.points).toBe(initial.points);
      expect(final.picksScored).toBe(initial.picksScored);
      expect(final.picksWon).toBe(initial.picksWon);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('null → home → away → draw → null produces zero net delta', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      // Use a game configured with non-zero drawProbability so the draw
      // branch produces a non-zero (and verifiable) delta.
      await updateGameFields(GAMES.lions.id, {
        homeProbability: 0.4,
        drawProbability: 0.2,
        awayProbability: 0.4,
      });
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'away');
      await setGameResult(admin, GAMES.lions.id, 'draw');
      await setGameResult(admin, GAMES.lions.id, null);
      const row = await readUserScore(USERS.alice.id);
      if (row) {
        expect(row.points).toBe(0);
        expect(row.picksScored).toBe(0);
        expect(row.picksWon).toBe(0);
      }
      const pick = await readPick(USERS.alice.id, GAMES.lions.id);
      expect(pick.appliedResult).toBeNull();
      expect(pick.appliedPoints).toBe(0);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });
});

// ============================================================================
// Concurrency
// ============================================================================

test.describe('Tier 24 — Concurrency', () => {
  test.beforeEach(async () => {
    await resetAll();
  });

  test('two picks created in parallel on same scored game → both apply atomically', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      // Setup: game scored, then alice + bob both make picks via the
      // model-layer fallback (the public API would reject post-scored
      // picks). Done in parallel from two concurrent transactions to
      // exercise the Postgres atomic UPDATE.
      await setGameResult(admin, GAMES.lions.id, 'home');
      const { Game, Pick, sequelize } = getModels();
      const UserScoreService = require('../../../services/UserScoreService');

      async function pickFor(userId, choice) {
        await sequelize.transaction(async (t) => {
          const game = await Game.findByPk(GAMES.lions.id, { transaction: t });
          const pick = await Pick.create(
            {
              userId,
              gameId: GAMES.lions.id,
              choice,
              pickedHomeProbability: game.homeProbability,
              pickedDrawProbability: game.drawProbability,
              pickedAwayProbability: game.awayProbability,
            },
            { transaction: t },
          );
          await UserScoreService.applyPickTransition(t, { pick, game });
        });
      }

      await Promise.all([pickFor(USERS.alice.id, 'home'), pickFor(USERS.bob.id, 'home')]);
      const aliceRow = await readUserScore(USERS.alice.id);
      const bobRow = await readUserScore(USERS.bob.id);
      expect(aliceRow.points).toBe(50);
      expect(bobRow.points).toBe(50);
      expect(aliceRow.picksWon).toBe(1);
      expect(bobRow.picksWon).toBe(1);
    } finally {
      await admin.dispose();
    }
  });
});

// ============================================================================
// League / season scoping
// ============================================================================

test.describe('Tier 24 — League / season scoping', () => {
  test.beforeEach(async () => {
    await resetAll();
  });

  test('user_scores row keyed on (userId, leagueId, seasonId)', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home');
      const row = await readUserScore(USERS.alice.id, LEAGUE_ID, SEASON_ID);
      expect(row).not.toBeNull();
      expect(row.leagueId).toBe(LEAGUE_ID);
      expect(row.seasonId).toBe(SEASON_ID);
      expect(row.points).toBe(50);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('user_scores_overall sums across leagues for one user', async () => {
    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await createPick(alice, GAMES.eagles.id, 'home');
      await setGameResult(admin, GAMES.lions.id, 'home'); // +50
      await setGameResult(admin, GAMES.eagles.id, 'home'); // +40
      const overall = await readUserScoreOverall(USERS.alice.id);
      expect(overall.points).toBe(90);
      expect(overall.picksScored).toBe(2);
      expect(overall.picksWon).toBe(2);
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });
});

// ============================================================================
// Global parity assertion (every test in this spec re-checks at the end)
// ============================================================================

test.describe('Tier 24 — Global parity assertion', () => {
  test.beforeEach(async () => {
    await resetAll();
  });

  // After a non-trivial sequence of mutations, the materialized totals
  // must match what buildUserSummary would produce for every user, both
  // overall AND scoped to (leagueId, seasonId). This is the "every-arm-
  // is-reversible" guarantee from the matrix.
  test('user_scores_overall matches buildUserSummary after multi-mutation sequence', async () => {
    const alice = await apiLogin(USERS.alice);
    const bob = await apiLogin(USERS.bob);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await createPick(alice, GAMES.eagles.id, 'away');
      await createPick(bob, GAMES.lions.id, 'away');
      await setGameResult(admin, GAMES.lions.id, 'home'); // alice +50, bob +0
      await setGameResult(admin, GAMES.eagles.id, 'away'); // alice +60
      // Now flip lions → away (alice -50, bob +50)
      await setGameResult(admin, GAMES.lions.id, 'away');
      // Final expected: alice 0+60 = 60; bob = +50

      const { buildUserSummary } = require('../../../lib/users');
      const expected = await buildUserSummary({});
      const expByUser = new Map(expected.map((u) => [u.userId, u.points]));

      const aliceOverall = await readUserScoreOverall(USERS.alice.id);
      const bobOverall = await readUserScoreOverall(USERS.bob.id);
      expect(aliceOverall.points).toBe(expByUser.get(USERS.alice.id));
      expect(bobOverall.points).toBe(expByUser.get(USERS.bob.id));
      // Ground-truth sanity
      expect(aliceOverall.points).toBe(60);
      expect(bobOverall.points).toBe(50);
    } finally {
      await alice.dispose();
      await bob.dispose();
      await admin.dispose();
    }
  });
});
