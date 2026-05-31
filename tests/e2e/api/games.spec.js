'use strict';

// Per-endpoint boundary suite for routes/games.js. Covers GET /api/games
// (public read), POST /api/games/:gameId/result (admin-only), GET
// /api/games/:gameId/comments (public read), POST .../comments (authed).

const { test, expect } = require('@playwright/test');

const { USERS, GAMES } = require('../fixtures/data');
const {
  apiAnon,
  apiLogin,
  clearGameResults,
  clearComments,
  createPick,
  clearPicksAndBadges,
  setGameResult,
} = require('../helpers/api');
const {
  assertOk,
  assertUnauthorized,
  assertForbiddenWithoutAdmin,
  assertCsrfRejected,
  assertValidationError,
} = require('../helpers/apiAssertions');

const BOGUS_ID = '99999999-0000-4000-8000-999999999999';

// ---------------------------------------------------------------------------
// GET /api/games
// ---------------------------------------------------------------------------

test.describe('GET /api/games', () => {
  test('anon → 200 + array', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/api/games');
      expect(Array.isArray(payload)).toBe(true);
      expect(payload.length).toBeGreaterThan(0);
    } finally {
      await anon.dispose();
    }
  });

  test('authed → 200 + array', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/games');
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('garbage leagueId silently treated as unfiltered (200 not 400)', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/api/games?leagueId=not-a-uuid');
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await anon.dispose();
    }
  });

  // Tier 30 Phase 3 A3 — voice-of-the-crowd indicator.
  test.describe('crowd indicator gating', () => {
    test.afterEach(async () => {
      await clearPicksAndBadges([USERS.alice.id, USERS.bob.id]);
      await clearGameResults([GAMES.lions.id]);
    });

    test('upcoming game + viewer has not picked → no crowd field', async () => {
      const authed = await apiLogin(USERS.alice);
      try {
        const games = await assertOk(authed, 'GET', '/api/games');
        const lions = games.find((g) => g.id === GAMES.lions.id);
        expect(lions).toBeTruthy();
        expect(lions.crowd).toBeUndefined();
      } finally {
        await authed.dispose();
      }
    });

    test('upcoming game + viewer has picked → crowd present + counts include picker', async () => {
      const authed = await apiLogin(USERS.alice);
      try {
        await createPick(authed, GAMES.lions.id, 'home');
        const games = await assertOk(authed, 'GET', '/api/games');
        const lions = games.find((g) => g.id === GAMES.lions.id);
        expect(lions.crowd).toEqual({ home: 1, away: 0, total: 1 });
      } finally {
        await authed.dispose();
      }
    });

    test('crowd aggregates across users', async () => {
      const alice = await apiLogin(USERS.alice);
      const bob = await apiLogin(USERS.bob);
      try {
        await createPick(alice, GAMES.lions.id, 'home');
        await createPick(bob, GAMES.lions.id, 'away');
        const games = await assertOk(alice, 'GET', '/api/games');
        const lions = games.find((g) => g.id === GAMES.lions.id);
        expect(lions.crowd).toEqual({ home: 1, away: 1, total: 2 });
      } finally {
        await alice.dispose();
        await bob.dispose();
      }
    });

    test('anon viewer on upcoming game → no crowd field (anti-bias)', async () => {
      // Seed a pick from an authed user so the crowd has data; the anon
      // request should still NOT see the crowd field for the still-
      // upcoming game.
      const authed = await apiLogin(USERS.alice);
      try {
        await createPick(authed, GAMES.lions.id, 'home');
      } finally {
        await authed.dispose();
      }
      const anon = await apiAnon();
      try {
        const games = await assertOk(anon, 'GET', '/api/games');
        const lions = games.find((g) => g.id === GAMES.lions.id);
        expect(lions.crowd).toBeUndefined();
      } finally {
        await anon.dispose();
      }
    });

    test('game past lock (finished) → crowd present for anon viewer', async () => {
      const authed = await apiLogin(USERS.alice);
      try {
        await createPick(authed, GAMES.lions.id, 'home');
      } finally {
        await authed.dispose();
      }
      const admin = await apiLogin(USERS.admin);
      try {
        await setGameResult(admin, GAMES.lions.id, 'home');
      } finally {
        await admin.dispose();
      }
      const anon = await apiAnon();
      try {
        const games = await assertOk(anon, 'GET', '/api/games');
        const lions = games.find((g) => g.id === GAMES.lions.id);
        expect(lions.crowd).toEqual({ home: 1, away: 0, total: 1 });
      } finally {
        await anon.dispose();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/games/:gameId/result
// ---------------------------------------------------------------------------

test.describe('POST /api/games/:gameId/result', () => {
  test.afterEach(async () => {
    await clearGameResults([GAMES.lions.id]);
  });

  test('admin happy path → 200 with updated game', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'POST', `/api/games/${GAMES.lions.id}/result`, {
        result: 'home',
      });
      expect(payload.success).toBe(true);
      expect(payload.game.result).toBe('home');
    } finally {
      await admin.dispose();
    }
  });

  test('non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertForbiddenWithoutAdmin(authed, 'POST', `/api/games/${GAMES.lions.id}/result`, {
        result: 'home',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('unknown game → 404', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const res = await admin.post(`/api/games/${BOGUS_ID}/result`, { data: { result: 'home' } });
      expect(res.status()).toBe(404);
    } finally {
      await admin.dispose();
    }
  });

  test('bad result enum → 400', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await assertValidationError(admin, 'POST', `/api/games/${GAMES.lions.id}/result`, {
        result: 'tie',
      });
    } finally {
      await admin.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/games/${GAMES.lions.id}/result`, { result: 'home' });
  });

  test('no CSRF → 403', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await assertCsrfRejected(admin, 'POST', `/api/games/${GAMES.lions.id}/result`, {
        result: 'home',
      });
    } finally {
      await admin.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/games/:gameId/comments
// ---------------------------------------------------------------------------

test.describe('GET /api/games/:gameId/comments', () => {
  test('anon → 200 + array', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', `/api/games/${GAMES.lions.id}/comments`);
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await anon.dispose();
    }
  });

  test('authed → 200 + array', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', `/api/games/${GAMES.lions.id}/comments`);
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/games/:gameId/comments
// ---------------------------------------------------------------------------

test.describe('POST /api/games/:gameId/comments', () => {
  test.afterEach(async () => {
    await clearComments(GAMES.lions.id);
  });

  test('happy path → 200 with comment row', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', `/api/games/${GAMES.lions.id}/comments`, {
        body: 'Hello from the API test suite.',
      });
      expect(payload).toHaveProperty('id');
      expect(payload).toHaveProperty('body');
      expect(payload.body).toBe('Hello from the API test suite.');
    } finally {
      await authed.dispose();
    }
  });

  test('empty body → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', `/api/games/${GAMES.lions.id}/comments`, {
        body: '',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('over-length body → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', `/api/games/${GAMES.lions.id}/comments`, {
        body: 'x'.repeat(501),
      });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/games/${GAMES.lions.id}/comments`, { body: 'x' });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', `/api/games/${GAMES.lions.id}/comments`, {
        body: 'x',
      });
    } finally {
      await authed.dispose();
    }
  });
});
