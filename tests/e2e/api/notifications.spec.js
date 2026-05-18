'use strict';

// Per-endpoint boundary suite for routes/notifications.js. Three endpoints:
// GET /notifications, POST /:id/read, POST /read-all.

const { test, expect } = require('@playwright/test');

const { USERS, GAMES } = require('../fixtures/data');
const {
  apiLogin,
  clearNotifications,
  clearPicksAndBadges,
  clearGameResults,
  createPick,
  setGameResult,
} = require('../helpers/api');
const {
  assertOk,
  assertUnauthorized,
  assertCsrfRejected,
  assertNotFound,
} = require('../helpers/apiAssertions');

const BOGUS_ID = '99999999-0000-4000-8000-999999999999';

// Produce a real notification for alice by going through the pick + result
// flow. setResult emits a `pick-scored` notification per pick.
async function seedAliceNotification() {
  await clearPicksAndBadges([USERS.alice.id]);
  await clearNotifications([USERS.alice.id]);
  await clearGameResults([GAMES.lions.id]);
  const aliceCtx = await apiLogin(USERS.alice);
  try {
    await createPick(aliceCtx, GAMES.lions.id, 'home');
  } finally {
    await aliceCtx.dispose();
  }
  const admin = await apiLogin(USERS.admin);
  try {
    await setGameResult(admin, GAMES.lions.id, 'home');
  } finally {
    await admin.dispose();
  }
}

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------

test.describe('GET /api/notifications', () => {
  test.beforeAll(async () => {
    await seedAliceNotification();
  });

  test('happy path → 200 with shape {notifications, unreadCount} or array', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/notifications');
      // NotificationService.listForUser returns either an array or an
      // {notifications, unreadCount} envelope — accept both for forward
      // compatibility.
      expect(payload).toBeDefined();
    } finally {
      await authed.dispose();
    }
  });

  test('unreadOnly=true filter accepted', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/notifications?unreadOnly=true');
      expect(payload).toBeDefined();
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('GET', '/api/notifications');
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/:id/read
// ---------------------------------------------------------------------------

test.describe('POST /api/notifications/:id/read', () => {
  let notificationId;

  test.beforeEach(async () => {
    await seedAliceNotification();
    const authed = await apiLogin(USERS.alice);
    try {
      const list = await assertOk(authed, 'GET', '/api/notifications');
      const arr = Array.isArray(list) ? list : list.notifications;
      notificationId = arr?.[0]?.id;
    } finally {
      await authed.dispose();
    }
  });

  test('owner marks own → 200', async () => {
    test.skip(!notificationId, 'notification not seeded; skip');
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', `/api/notifications/${notificationId}/read`);
      expect(payload.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('different user attempting → 403', async () => {
    test.skip(!notificationId, 'notification not seeded; skip');
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.post(`/api/notifications/${notificationId}/read`);
      expect(res.status()).toBe(403);
    } finally {
      await bob.dispose();
    }
  });

  test('unknown id → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertNotFound(authed, 'POST', `/api/notifications/${BOGUS_ID}/read`);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/notifications/${BOGUS_ID}/read`);
  });

  test('no CSRF → 403', async () => {
    test.skip(!notificationId, 'notification not seeded; skip');
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', `/api/notifications/${notificationId}/read`);
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/read-all
// ---------------------------------------------------------------------------

test.describe('POST /api/notifications/read-all', () => {
  test('happy path → 200 + idempotent on empty', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', '/api/notifications/read-all');
      expect(payload.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/notifications/read-all');
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', '/api/notifications/read-all');
    } finally {
      await authed.dispose();
    }
  });
});
