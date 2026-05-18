'use strict';

// Per-endpoint boundary suite for routes/picks.js. Covers POST /api/picks
// (upsert semantics — second POST replaces choice, not 400), GET /api/picks,
// and DELETE /api/picks/:id (owner-only, refuses after kickoff).

const { test, expect } = require('@playwright/test');

const { USERS, GAMES } = require('../fixtures/data');
const { apiLogin, clearPicksAndBadges, clearGameResults, createPick } = require('../helpers/api');
const {
  assertOk,
  assertUnauthorized,
  assertCsrfRejected,
  assertValidationError,
  assertNotFound,
} = require('../helpers/apiAssertions');

const BOGUS_ID = '99999999-0000-4000-8000-999999999999';

// ---------------------------------------------------------------------------
// POST /api/picks
// ---------------------------------------------------------------------------

test.describe('POST /api/picks', () => {
  test.beforeEach(async () => {
    await clearGameResults([GAMES.lions.id, GAMES.eagles.id, GAMES.wolves.id]);
    await clearPicksAndBadges([USERS.alice.id, USERS.bob.id]);
  });

  test('happy path → 200 with {success: true}', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', '/api/picks', {
        gameId: GAMES.lions.id,
        choice: 'home',
      });
      expect(payload.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('repeat call upserts (200, not 400)', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertOk(authed, 'POST', '/api/picks', { gameId: GAMES.lions.id, choice: 'home' });
      const second = await assertOk(authed, 'POST', '/api/picks', {
        gameId: GAMES.lions.id,
        choice: 'away',
      });
      expect(second.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  // Pick-time probability snapshot — three DECIMAL(3,2) columns frozen on the
  // pick row at creation/upsert time. The lions fixture has home=0.5 / away=0.5
  // and the draw-scoring migration's default sets draw=0, so the snapshot trio
  // is (0.50, 0.00, 0.50). Sequelize returns DECIMAL as string — parseFloat to
  // normalize before comparing.
  test('snapshot fields populated on create', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertOk(authed, 'POST', '/api/picks', { gameId: GAMES.lions.id, choice: 'home' });
      const list = await assertOk(authed, 'GET', '/api/picks');
      const pick = list.find((p) => p.gameId === GAMES.lions.id);
      expect(pick).toBeDefined();
      expect(parseFloat(pick.pickedHomeProbability)).toBeCloseTo(0.5, 2);
      expect(parseFloat(pick.pickedDrawProbability)).toBeCloseTo(0, 2);
      expect(parseFloat(pick.pickedAwayProbability)).toBeCloseTo(0.5, 2);
    } finally {
      await authed.dispose();
    }
  });

  // Re-pick (same team or switch) intentionally refreshes the snapshot —
  // "re-pick = re-lock at current odds." A user holding an old payout
  // must NOT re-pick if they want to keep it.
  test('snapshot refreshes on re-pick', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertOk(authed, 'POST', '/api/picks', {
        gameId: GAMES.eagles.id,
        choice: 'home',
      });
      const firstList = await assertOk(authed, 'GET', '/api/picks');
      const first = firstList.find((p) => p.gameId === GAMES.eagles.id);
      expect(parseFloat(first.pickedHomeProbability)).toBeCloseTo(0.6, 2);

      // Switch teams — snapshot must reflect the same game's current odds,
      // not be stale from the prior pick.
      await assertOk(authed, 'POST', '/api/picks', {
        gameId: GAMES.eagles.id,
        choice: 'away',
      });
      const secondList = await assertOk(authed, 'GET', '/api/picks');
      const second = secondList.find((p) => p.gameId === GAMES.eagles.id);
      expect(second.choice).toBe('away');
      expect(parseFloat(second.pickedHomeProbability)).toBeCloseTo(0.6, 2);
      expect(parseFloat(second.pickedAwayProbability)).toBeCloseTo(0.4, 2);
    } finally {
      await authed.dispose();
    }
  });

  test('unknown game id → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertNotFound(authed, 'POST', '/api/picks', { gameId: BOGUS_ID, choice: 'home' });
    } finally {
      await authed.dispose();
    }
  });

  test('bad choice → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', '/api/picks', {
        gameId: GAMES.lions.id,
        choice: 'tie',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/picks', {
      gameId: GAMES.lions.id,
      choice: 'home',
    });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', '/api/picks', {
        gameId: GAMES.lions.id,
        choice: 'home',
      });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/picks
// ---------------------------------------------------------------------------

test.describe('GET /api/picks', () => {
  test.beforeAll(async () => {
    await clearGameResults([GAMES.lions.id]);
    await clearPicksAndBadges([USERS.alice.id]);
    const authed = await apiLogin(USERS.alice);
    try {
      await createPick(authed, GAMES.lions.id, 'home');
    } finally {
      await authed.dispose();
    }
  });

  test('happy path → 200 + array', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/picks');
      expect(Array.isArray(payload)).toBe(true);
      expect(payload.length).toBeGreaterThan(0);
      expect(payload[0]).toHaveProperty('gameId');
      expect(payload[0]).toHaveProperty('choice');
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('GET', '/api/picks');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/picks/:id
// ---------------------------------------------------------------------------

test.describe('DELETE /api/picks/:id', () => {
  let alicePickId;

  test.beforeEach(async () => {
    await clearGameResults([GAMES.lions.id]);
    await clearPicksAndBadges([USERS.alice.id, USERS.bob.id]);
    const authed = await apiLogin(USERS.alice);
    try {
      await createPick(authed, GAMES.lions.id, 'home');
      const list = await assertOk(authed, 'GET', '/api/picks');
      alicePickId = list[0].id;
    } finally {
      await authed.dispose();
    }
  });

  test('happy path → 200', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'DELETE', `/api/picks/${alicePickId}`);
      expect(payload.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('not the owner (bob deleting alice pick) → 403', async () => {
    const authed = await apiLogin(USERS.bob);
    try {
      const res = await authed.delete(`/api/picks/${alicePickId}`);
      expect(res.status()).toBe(403);
    } finally {
      await authed.dispose();
    }
  });

  test('unknown id → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertNotFound(authed, 'DELETE', `/api/picks/${BOGUS_ID}`);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('DELETE', `/api/picks/${BOGUS_ID}`);
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'DELETE', `/api/picks/${alicePickId}`);
    } finally {
      await authed.dispose();
    }
  });
});
