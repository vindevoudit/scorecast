'use strict';

// Per-endpoint boundary suite for routes/users.js. Two endpoints:
// GET /api/search and GET /api/users/:username/profile (Tier 8.6 privacy
// gate). Both use optionalAuth — anon access works.

const { test, expect } = require('@playwright/test');

const { USERS } = require('../fixtures/data');
const { apiAnon, apiLogin, setProfileVisibility, updateUserFields } = require('../helpers/api');
const { assertOk, expectShape } = require('../helpers/apiAssertions');

// ---------------------------------------------------------------------------
// GET /api/search
// ---------------------------------------------------------------------------

test.describe('GET /api/search', () => {
  test('anon happy path → 200 with {users, groups, games}', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/api/search?q=Test');
      expectShape(payload, ['users', 'groups', 'games']);
    } finally {
      await anon.dispose();
    }
  });

  test('authed → 200', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/search?q=Test');
      expectShape(payload, ['users', 'groups', 'games']);
    } finally {
      await authed.dispose();
    }
  });

  test('short query (<2 chars) → 200 with empty arrays', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/api/search?q=a');
      expect(payload.users).toHaveLength(0);
      expect(payload.groups).toHaveLength(0);
      expect(payload.games).toHaveLength(0);
    } finally {
      await anon.dispose();
    }
  });

  test('users-only filter', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/api/search?q=alice&type=users');
      expect(Array.isArray(payload.users)).toBe(true);
    } finally {
      await anon.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/users/:username/profile
// ---------------------------------------------------------------------------

test.describe('GET /api/users/:username/profile', () => {
  test.afterEach(async () => {
    // Restore alice's visibility in case a test changed it.
    await updateUserFields(USERS.alice.id, { profileVisibility: 'public' });
  });

  test('anon → public profile 200', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', `/api/users/${USERS.alice.username}/profile`);
      expectShape(payload, ['username', 'role', 'joinedAt']);
      expect(payload.username).toBe(USERS.alice.username);
    } finally {
      await anon.dispose();
    }
  });

  test('authed self → 200 + friendStatus self', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', `/api/users/${USERS.alice.username}/profile`);
      expect(payload.friendStatus).toBe('self');
    } finally {
      await authed.dispose();
    }
  });

  test('anon viewing private profile → 404 (no existence leak)', async () => {
    await setProfileVisibility(USERS.alice, 'private');
    const anon = await apiAnon();
    try {
      const res = await anon.get(`/api/users/${USERS.alice.username}/profile`);
      expect(res.status()).toBe(404);
    } finally {
      await anon.dispose();
    }
  });

  test('anon viewing friends-only profile → 404', async () => {
    await setProfileVisibility(USERS.alice, 'friends');
    const anon = await apiAnon();
    try {
      const res = await anon.get(`/api/users/${USERS.alice.username}/profile`);
      expect(res.status()).toBe(404);
    } finally {
      await anon.dispose();
    }
  });

  test('admin always sees → 200 even when private', async () => {
    await setProfileVisibility(USERS.alice, 'private');
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'GET', `/api/users/${USERS.alice.username}/profile`);
      expect(payload.username).toBe(USERS.alice.username);
    } finally {
      await admin.dispose();
    }
  });

  test('unknown username → 404', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.get('/api/users/nonexistent_user/profile');
      expect(res.status()).toBe(404);
    } finally {
      await anon.dispose();
    }
  });
});
