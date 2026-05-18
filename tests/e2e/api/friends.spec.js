'use strict';

// Per-endpoint boundary suite for routes/friends.js. Five endpoints:
// POST /friends/request, /:id/accept, /:id/decline, DELETE /:id, GET /friends.

const { test, expect } = require('@playwright/test');

const { USERS } = require('../fixtures/data');
const { apiLogin, clearFriendships } = require('../helpers/api');
const {
  assertOk,
  assertUnauthorized,
  assertCsrfRejected,
  assertValidationError,
  assertNotFound,
} = require('../helpers/apiAssertions');

const BOGUS_ID = '99999999-0000-4000-8000-999999999999';

// Helper — create a pending friendship from alice → bob; return the row id.
async function aliceRequestsBob() {
  const authed = await apiLogin(USERS.alice);
  try {
    const res = await authed.post('/api/friends/request', {
      data: { username: USERS.bob.username },
    });
    const payload = await res.json();
    return payload.friendship.id;
  } finally {
    await authed.dispose();
  }
}

test.beforeEach(async () => {
  await clearFriendships([USERS.alice.id, USERS.bob.id, USERS.admin.id]);
});

// ---------------------------------------------------------------------------
// POST /api/friends/request
// ---------------------------------------------------------------------------

test.describe('POST /api/friends/request', () => {
  test('happy path → 200 with friendship row', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', '/api/friends/request', {
        username: USERS.bob.username,
      });
      expect(payload.success).toBe(true);
      expect(payload.friendship.status).toBe('pending');
    } finally {
      await authed.dispose();
    }
  });

  test('self-request → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post('/api/friends/request', {
        data: { username: USERS.alice.username },
      });
      expect(res.status()).toBe(400);
    } finally {
      await authed.dispose();
    }
  });

  test('duplicate request → 400', async () => {
    await aliceRequestsBob();
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post('/api/friends/request', {
        data: { username: USERS.bob.username },
      });
      expect(res.status()).toBe(400);
    } finally {
      await authed.dispose();
    }
  });

  test('unknown user → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertNotFound(authed, 'POST', '/api/friends/request', {
        username: 'no_such_user',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('bad body → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', '/api/friends/request', {});
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/friends/request', { username: 'x' });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', '/api/friends/request', {
        username: USERS.bob.username,
      });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/friends/:id/accept
// ---------------------------------------------------------------------------

test.describe('POST /api/friends/:id/accept', () => {
  test('addressee accepts → 200', async () => {
    const id = await aliceRequestsBob();
    const bob = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(bob, 'POST', `/api/friends/${id}/accept`);
      expect(payload.success).toBe(true);
    } finally {
      await bob.dispose();
    }
  });

  test('requester attempts to accept own → 403', async () => {
    const id = await aliceRequestsBob();
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post(`/api/friends/${id}/accept`);
      expect(res.status()).toBe(403);
    } finally {
      await authed.dispose();
    }
  });

  test('unknown id → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertNotFound(authed, 'POST', `/api/friends/${BOGUS_ID}/accept`);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/friends/${BOGUS_ID}/accept`);
  });
});

// ---------------------------------------------------------------------------
// POST /api/friends/:id/decline
// ---------------------------------------------------------------------------

test.describe('POST /api/friends/:id/decline', () => {
  test('addressee declines → 200', async () => {
    const id = await aliceRequestsBob();
    const bob = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(bob, 'POST', `/api/friends/${id}/decline`);
      expect(payload.success).toBe(true);
    } finally {
      await bob.dispose();
    }
  });

  test('requester attempts to decline own → 403', async () => {
    const id = await aliceRequestsBob();
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post(`/api/friends/${id}/decline`);
      expect(res.status()).toBe(403);
    } finally {
      await authed.dispose();
    }
  });

  test('unknown id → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertNotFound(authed, 'POST', `/api/friends/${BOGUS_ID}/decline`);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/friends/${BOGUS_ID}/decline`);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/friends/:id
// ---------------------------------------------------------------------------

test.describe('DELETE /api/friends/:id', () => {
  test('requester cancels own pending → 200', async () => {
    const id = await aliceRequestsBob();
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'DELETE', `/api/friends/${id}`);
      expect(payload.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('addressee removes own → 200', async () => {
    const id = await aliceRequestsBob();
    const bob = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(bob, 'DELETE', `/api/friends/${id}`);
      expect(payload.success).toBe(true);
    } finally {
      await bob.dispose();
    }
  });

  test('third party attempts → 403', async () => {
    const id = await aliceRequestsBob();
    const admin = await apiLogin(USERS.admin);
    try {
      const res = await admin.delete(`/api/friends/${id}`);
      expect(res.status()).toBe(403);
    } finally {
      await admin.dispose();
    }
  });

  test('unknown id → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertNotFound(authed, 'DELETE', `/api/friends/${BOGUS_ID}`);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('DELETE', `/api/friends/${BOGUS_ID}`);
  });
});

// ---------------------------------------------------------------------------
// GET /api/friends
// ---------------------------------------------------------------------------

test.describe('GET /api/friends', () => {
  test('happy path → 200 + {friends, incoming, outgoing}', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/friends');
      expect(payload).toHaveProperty('friends');
      expect(payload).toHaveProperty('incoming');
      expect(payload).toHaveProperty('outgoing');
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('GET', '/api/friends');
  });
});
