'use strict';

// Per-endpoint boundary suite for routes/push.js + the /api/me/push-preferences
// route in routes/me.js (Chunk 4-6).
//
// In the test env VAPID is NOT configured, so:
//   - GET /api/push/vapid-public-key responds 503 (transport not configured)
//   - POST/DELETE /api/push/subscribe still work — they just write/delete DB
//     rows. PushService.sendToUser is the only thing gated on VAPID, and it
//     isn't exercised here. The spec covers the route boundaries without
//     needing VAPID seeded.

const { test, expect } = require('@playwright/test');

const { USERS } = require('../fixtures/data');
const { apiAnon, apiLogin, clearPushSubscriptions } = require('../helpers/api');
const {
  assertOk,
  assertUnauthorized,
  assertCsrfRejected,
  assertValidationError,
} = require('../helpers/apiAssertions');

// Shaped like a real PushSubscription.toJSON() — endpoint is the only field
// the routes care about identity-wise (the unique index keys on userId +
// endpoint). p256dh + auth are base64url blobs of the right approximate
// length to satisfy the zod schema (64-200 chars and 16-100 chars).
function makeSubscription(suffix = 'alpha') {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/test-subscription-${suffix}-aaaaaaaaaa`,
    keys: {
      p256dh:
        'BNQpJW7kVlsd5wm5pwa57VTKkVUZG7Q7Y76e7AT-K1SBhqGfd7VAh4XQiHACgC0PsGwOQjwEFLGqvWnzbjqgGfQ',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    },
  };
}

test.afterAll(async () => {
  await clearPushSubscriptions([USERS.alice.id, USERS.bob.id]);
});

// ---------------------------------------------------------------------------
// GET /api/push/vapid-public-key — anon, returns 503 when transport unconfigured
// ---------------------------------------------------------------------------

test.describe('GET /api/push/vapid-public-key', () => {
  test('anon reads, 503 when VAPID not configured in test env', async () => {
    const anon = await apiAnon();
    try {
      // GETs don't need CSRF, so the anon context is fine.
      const res = await anon.get('/api/push/vapid-public-key');
      // In CI / dev without VAPID env vars set, this should be 503.
      // When the operator later seeds VAPID, this flips to 200 with
      // { publicKey } — that path is exercised manually via curl after
      // the prod KV seed (see CLAUDE.md).
      expect([200, 503]).toContain(res.status());
      const payload = await res.json();
      if (res.status() === 503) {
        expect(payload.error).toMatch(/not configured/i);
      } else {
        expect(typeof payload.publicKey).toBe('string');
      }
    } finally {
      await anon.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/push/subscribe
// ---------------------------------------------------------------------------

test.describe('POST /api/push/subscribe', () => {
  test.beforeEach(async () => {
    await clearPushSubscriptions([USERS.alice.id, USERS.bob.id]);
  });

  test('happy path → 201 first time, 200 on re-subscribe', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const sub = makeSubscription('alice-1');
      const res1 = await authed.post('/api/push/subscribe', { data: sub });
      expect(res1.status()).toBe(201);
      // Re-subscribe with the same endpoint should update + return 200.
      const res2 = await authed.post('/api/push/subscribe', { data: sub });
      expect(res2.status()).toBe(200);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/push/subscribe', makeSubscription('anon'));
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', '/api/push/subscribe', makeSubscription('no-csrf'));
    } finally {
      await authed.dispose();
    }
  });

  test('missing endpoint → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', '/api/push/subscribe', {
        // endpoint omitted
        keys: makeSubscription().keys,
      });
    } finally {
      await authed.dispose();
    }
  });

  test('endpoint not a URL → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', '/api/push/subscribe', {
        ...makeSubscription(),
        endpoint: 'not-a-url',
      });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/push/subscribe
// ---------------------------------------------------------------------------

test.describe('DELETE /api/push/subscribe', () => {
  test.beforeEach(async () => {
    await clearPushSubscriptions([USERS.alice.id]);
  });

  test('happy path → 200; subsequent delete is idempotent', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const sub = makeSubscription('alice-del');
      await assertOk(authed, 'POST', '/api/push/subscribe', sub);
      const res1 = await authed.delete('/api/push/subscribe', {
        data: { endpoint: sub.endpoint },
      });
      expect(res1.status()).toBe(200);
      // Idempotent: second delete on the now-empty row still 200s.
      const res2 = await authed.delete('/api/push/subscribe', {
        data: { endpoint: sub.endpoint },
      });
      expect(res2.status()).toBe(200);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('DELETE', '/api/push/subscribe', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
    });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'DELETE', '/api/push/subscribe', {
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// PUT /api/me/push-preferences
// ---------------------------------------------------------------------------

test.describe('PUT /api/me/push-preferences', () => {
  test.beforeEach(async () => {
    await clearPushSubscriptions([USERS.alice.id]);
  });

  test('happy path: partial update merges into existing prefs', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      // First write: opt out of odds-shifted only.
      const r1 = await assertOk(authed, 'PUT', '/api/me/push-preferences', {
        prefs: { 'odds-shifted': false },
      });
      expect(r1.pushPreferences['odds-shifted']).toBe(false);
      // Second write: opt out of kickoff-reminder; odds-shifted must persist.
      const r2 = await assertOk(authed, 'PUT', '/api/me/push-preferences', {
        prefs: { 'kickoff-reminder': false },
      });
      expect(r2.pushPreferences['odds-shifted']).toBe(false);
      expect(r2.pushPreferences['kickoff-reminder']).toBe(false);
    } finally {
      await authed.dispose();
    }
  });

  test('unknown type → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'PUT', '/api/me/push-preferences', {
        prefs: { 'made-up-type': false },
      });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('PUT', '/api/me/push-preferences', {
      prefs: { 'pick-scored': false },
    });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'PUT', '/api/me/push-preferences', {
        prefs: { 'pick-scored': false },
      });
    } finally {
      await authed.dispose();
    }
  });
});
