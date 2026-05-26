'use strict';

// Per-endpoint boundary suite for routes/admin.js. 14 endpoints — covering
// admin game CRUD + bulk, user role + delete + bulk, leagues CRUD + sync,
// cache-stats, audit-log read.
//
// Admin sync (`POST /admin/leagues/:id/sync`) calls the external football-
// data.org API — we don't assert a happy 200 here, just auth boundary
// (no auth → 401, non-admin → 403).

const { test, expect } = require('@playwright/test');

const { USERS, GAMES, LEAGUE_ID, SEASON_ID } = require('../fixtures/data');
const {
  apiLogin,
  clearGameResults,
  clearLeaguesByName,
  setUserPassword,
  deleteUserByUsername,
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
// POST /api/admin/games
// ---------------------------------------------------------------------------

test.describe('POST /api/admin/games', () => {
  const createdGames = [];

  test.afterEach(async () => {
    // Clean up admin-created games via DELETE so cascade fires.
    if (createdGames.length === 0) return;
    const admin = await apiLogin(USERS.admin);
    try {
      while (createdGames.length) {
        const id = createdGames.pop();
        await admin.delete(`/api/admin/games/${id}`);
      }
    } finally {
      await admin.dispose();
    }
  });

  test('admin happy path → 200 with game row', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const body = {
        homeTeam: 'Admin Test Lions',
        awayTeam: 'Admin Test Tigers',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        homeProbability: 0.5,
        awayProbability: 0.5,
        leagueId: LEAGUE_ID,
        seasonId: SEASON_ID,
      };
      const payload = await assertOk(admin, 'POST', '/api/admin/games', body);
      expect(payload.id).toBeTruthy();
      createdGames.push(payload.id);
    } finally {
      await admin.dispose();
    }
  });

  test('non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertForbiddenWithoutAdmin(authed, 'POST', '/api/admin/games', {
        homeTeam: 'x',
        awayTeam: 'y',
        date: new Date(Date.now() + 86400000).toISOString(),
        homeProbability: 0.5,
        awayProbability: 0.5,
      });
    } finally {
      await authed.dispose();
    }
  });

  test('bad probabilities (sum != 1) → 400', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await assertValidationError(admin, 'POST', '/api/admin/games', {
        homeTeam: 'Home',
        awayTeam: 'Away',
        date: new Date(Date.now() + 86400000).toISOString(),
        homeProbability: 0.7,
        awayProbability: 0.7,
      });
    } finally {
      await admin.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/admin/games', {
      homeTeam: 'x',
      awayTeam: 'y',
      date: new Date(Date.now() + 86400000).toISOString(),
      homeProbability: 0.5,
      awayProbability: 0.5,
    });
  });

  test('no CSRF → 403', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await assertCsrfRejected(admin, 'POST', '/api/admin/games', {
        homeTeam: 'x',
        awayTeam: 'y',
        date: new Date(Date.now() + 86400000).toISOString(),
        homeProbability: 0.5,
        awayProbability: 0.5,
      });
    } finally {
      await admin.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/games/:id + DELETE /api/admin/games/:id
// ---------------------------------------------------------------------------

test.describe('PUT + DELETE /api/admin/games/:id', () => {
  test.afterEach(async () => {
    await clearGameResults([GAMES.lions.id]);
  });

  test('PUT happy path → 200 with updated row', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'PUT', `/api/admin/games/${GAMES.lions.id}`, {
        homeTeam: 'Renamed Lions',
      });
      expect(payload.homeTeam).toBe('Renamed Lions');
      // Reset
      await admin.put(`/api/admin/games/${GAMES.lions.id}`, { data: { homeTeam: 'Test Lions' } });
    } finally {
      await admin.dispose();
    }
  });

  test('PUT non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertForbiddenWithoutAdmin(authed, 'PUT', `/api/admin/games/${GAMES.lions.id}`, {
        homeTeam: 'x',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('PUT unknown id → 404', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const res = await admin.put(`/api/admin/games/${BOGUS_ID}`, { data: { homeTeam: 'x' } });
      expect(res.status()).toBe(404);
    } finally {
      await admin.dispose();
    }
  });

  test('DELETE non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.delete(`/api/admin/games/${GAMES.lions.id}`);
      expect(res.status()).toBe(403);
    } finally {
      await authed.dispose();
    }
  });

  test('DELETE no auth → 401', async () => {
    await assertUnauthorized('DELETE', `/api/admin/games/${GAMES.lions.id}`);
  });

  test('DELETE no CSRF → 403', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await assertCsrfRejected(admin, 'DELETE', `/api/admin/games/${BOGUS_ID}`);
    } finally {
      await admin.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------

test.describe('GET /api/admin/users', () => {
  test('admin → 200 + array', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'GET', '/api/admin/users');
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await admin.dispose();
    }
  });

  test('non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertForbiddenWithoutAdmin(authed, 'GET', '/api/admin/users');
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('GET', '/api/admin/users');
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/role + DELETE /api/admin/users/:id
// ---------------------------------------------------------------------------

test.describe('POST /api/admin/users/:id/role + DELETE /api/admin/users/:id', () => {
  test.afterEach(async () => {
    // Restore bob's role + ensure he wasn't deleted by these tests.
    const admin = await apiLogin(USERS.admin);
    try {
      await admin.post(`/api/admin/users/${USERS.bob.id}/role`, { data: { role: 'user' } });
    } finally {
      await admin.dispose();
    }
  });

  test('role promote happy path → 200', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'POST', `/api/admin/users/${USERS.bob.id}/role`, {
        role: 'admin',
      });
      expect(payload.success).toBe(true);
    } finally {
      await admin.dispose();
    }
  });

  test('role bad enum → 400', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await assertValidationError(admin, 'POST', `/api/admin/users/${USERS.bob.id}/role`, {
        role: 'superadmin',
      });
    } finally {
      await admin.dispose();
    }
  });

  test('role non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertForbiddenWithoutAdmin(authed, 'POST', `/api/admin/users/${USERS.bob.id}/role`, {
        role: 'admin',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('role no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/admin/users/${USERS.bob.id}/role`, { role: 'admin' });
  });

  test('role no CSRF → 403', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await assertCsrfRejected(admin, 'POST', `/api/admin/users/${USERS.bob.id}/role`, {
        role: 'admin',
      });
    } finally {
      await admin.dispose();
    }
  });

  test('delete unknown user → 404', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const res = await admin.delete(`/api/admin/users/${BOGUS_ID}`);
      expect(res.status()).toBe(404);
    } finally {
      await admin.dispose();
    }
  });

  test('delete non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.delete(`/api/admin/users/${USERS.bob.id}`);
      expect(res.status()).toBe(403);
    } finally {
      await authed.dispose();
    }
  });

  test('delete no auth → 401', async () => {
    await assertUnauthorized('DELETE', `/api/admin/users/${USERS.bob.id}`);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/games/bulk
// ---------------------------------------------------------------------------

test.describe('POST /api/admin/games/bulk', () => {
  test.afterEach(async () => {
    await clearGameResults([GAMES.lions.id, GAMES.eagles.id]);
  });

  test('bulk setResult happy path → 200 with affected ids', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'POST', '/api/admin/games/bulk', {
        ids: [GAMES.lions.id, GAMES.eagles.id],
        action: 'setResult',
        result: 'home',
      });
      expect(payload.success).toBe(true);
      expect(payload.affected.length).toBeGreaterThan(0);
    } finally {
      await admin.dispose();
    }
  });

  test('over 500 ids → 400', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const ids = Array.from({ length: 501 }, () => '11111111-0000-4000-8000-000000000001');
      await assertValidationError(admin, 'POST', '/api/admin/games/bulk', {
        ids,
        action: 'delete',
      });
    } finally {
      await admin.dispose();
    }
  });

  test('bad action enum → 400', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await assertValidationError(admin, 'POST', '/api/admin/games/bulk', {
        ids: [GAMES.lions.id],
        action: 'detonate',
      });
    } finally {
      await admin.dispose();
    }
  });

  test('non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertForbiddenWithoutAdmin(authed, 'POST', '/api/admin/games/bulk', {
        ids: [GAMES.lions.id],
        action: 'delete',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/admin/games/bulk', {
      ids: [GAMES.lions.id],
      action: 'delete',
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/bulk
//
// Creates a throwaway user so we can demote/promote without touching seed
// users, then verifies the self-skip semantic — admin's own id in the batch
// returns in skipped[].
// ---------------------------------------------------------------------------

test.describe('POST /api/admin/users/bulk', () => {
  let tempUserId;
  let tempUsername;

  test.beforeAll(async () => {
    tempUsername = `api_bulk_user_${Date.now()}`;
    const { request: pwRequest } = require('@playwright/test');
    const anon = await pwRequest.newContext({ baseURL: require('../fixtures/env').BASE_URL });
    try {
      const res = await anon.post('/api/register', {
        data: {
          username: tempUsername,
          password: 'TempBulkPw1!',
          email: `${tempUsername}@example.test`,
          acceptedTerms: true,
          acceptedTermsVersion: 2,
          confirmedAge: true,
        },
      });
      const payload = await res.json();
      tempUserId = payload.user.id;
    } finally {
      await anon.dispose();
    }
  });

  test.afterAll(async () => {
    await deleteUserByUsername(tempUsername);
    await setUserPassword(USERS.admin.id, USERS.admin.password);
  });

  test('promote happy path → 200', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'POST', '/api/admin/users/bulk', {
        ids: [tempUserId],
        action: 'promote',
      });
      expect(payload.success).toBe(true);
      expect(payload.affected).toContain(tempUserId);
    } finally {
      await admin.dispose();
    }
  });

  test('admin self-id returns in skipped[]', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'POST', '/api/admin/users/bulk', {
        ids: [USERS.admin.id, tempUserId],
        action: 'demote',
      });
      expect(payload.skipped).toEqual([{ id: USERS.admin.id, reason: 'self' }]);
    } finally {
      await admin.dispose();
    }
  });

  test('non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertForbiddenWithoutAdmin(authed, 'POST', '/api/admin/users/bulk', {
        ids: [tempUserId],
        action: 'demote',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/admin/users/bulk', {
      ids: [USERS.bob.id],
      action: 'demote',
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/cache-stats
// ---------------------------------------------------------------------------

test.describe('GET /api/admin/cache-stats', () => {
  test('admin → 200 + stats shape', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'GET', '/api/admin/cache-stats');
      expect(payload).toBeDefined();
    } finally {
      await admin.dispose();
    }
  });

  test('non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertForbiddenWithoutAdmin(authed, 'GET', '/api/admin/cache-stats');
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('GET', '/api/admin/cache-stats');
  });
});

// ---------------------------------------------------------------------------
// /api/admin/leagues — list + CRUD + sync (auth boundary only on /sync)
// ---------------------------------------------------------------------------

test.describe('/api/admin/leagues', () => {
  test.afterEach(async () => {
    await clearLeaguesByName('API Test League');
  });

  test('GET admin → 200 with {leagues, apiConfigured, apiBudget}', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'GET', '/api/admin/leagues');
      expect(payload).toHaveProperty('leagues');
      expect(payload).toHaveProperty('apiConfigured');
    } finally {
      await admin.dispose();
    }
  });

  test('POST admin → 201 with league row', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const res = await admin.post('/api/admin/leagues', {
        data: {
          name: `API Test League ${Date.now()}`,
          sourceLeagueId: `APITEST${Date.now()}`,
        },
      });
      expect(res.status()).toBe(201);
    } finally {
      await admin.dispose();
    }
  });

  test('PUT admin happy path → 200', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'PUT', `/api/admin/leagues/${LEAGUE_ID}`, {
        name: 'API Test League Renamed',
      });
      expect(payload.name).toBe('API Test League Renamed');
      // restore
      await admin.put(`/api/admin/leagues/${LEAGUE_ID}`, { data: { name: 'E2E Test League' } });
    } finally {
      await admin.dispose();
    }
  });

  test('POST bad sourceLeagueId → 400', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await assertValidationError(admin, 'POST', '/api/admin/leagues', { name: 'API Test League' });
    } finally {
      await admin.dispose();
    }
  });

  test('non-admin (POST) → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertForbiddenWithoutAdmin(authed, 'POST', '/api/admin/leagues', {
        name: 'API Test League nope',
        sourceLeagueId: 'NOPE',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('non-admin (sync) → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post(`/api/admin/leagues/${LEAGUE_ID}/sync`);
      expect(res.status()).toBe(403);
    } finally {
      await authed.dispose();
    }
  });

  test('sync no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/admin/leagues/${LEAGUE_ID}/sync`);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/audit-log
// ---------------------------------------------------------------------------

test.describe('GET /api/admin/audit-log', () => {
  test('admin → 200 + page envelope', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'GET', '/api/admin/audit-log');
      expect(payload).toBeDefined();
    } finally {
      await admin.dispose();
    }
  });

  test('non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertForbiddenWithoutAdmin(authed, 'GET', '/api/admin/audit-log');
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('GET', '/api/admin/audit-log');
  });
});
