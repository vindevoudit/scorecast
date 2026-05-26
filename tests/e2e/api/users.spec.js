'use strict';

// Per-endpoint boundary suite for routes/users.js. Two endpoints:
// GET /api/search and GET /api/users/:username/profile (Tier 8.6 privacy
// gate). Both use optionalAuth — anon access works.

const { test, expect } = require('@playwright/test');

const { USERS } = require('../fixtures/data');
const {
  apiAnon,
  apiLogin,
  setProfileVisibility,
  updateUserFields,
  clearFriendships,
  createAcceptedFriendship,
  createPendingFriendship,
} = require('../helpers/api');
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

  // Tier 19 Chunk 2 — `friendStatus` + `friendshipId` enrichment for the
  // authed viewer. Five states: 'self' / 'friends' / 'pending-out' /
  // 'pending-in' / 'none' (anon = null). Each test resets the friendship
  // state for alice + bob between runs since the relationships are
  // bidirectional and would leak across cases otherwise.
  test.describe('friendStatus enrichment on user results', () => {
    test.beforeEach(async () => {
      await clearFriendships([USERS.alice.id, USERS.bob.id]);
    });
    test.afterAll(async () => {
      await clearFriendships([USERS.alice.id, USERS.bob.id]);
    });

    test('anon viewer → every user row has friendStatus: null', async () => {
      const anon = await apiAnon();
      try {
        const payload = await assertOk(anon, 'GET', '/api/search?q=e2e&type=users');
        expect(payload.users.length).toBeGreaterThan(0);
        for (const u of payload.users) {
          expect(u.friendStatus).toBeNull();
          expect(u.friendshipId).toBeNull();
        }
      } finally {
        await anon.dispose();
      }
    });

    test('authed viewer + self in result set → friendStatus: self', async () => {
      const alice = await apiLogin(USERS.alice);
      try {
        const payload = await assertOk(alice, 'GET', '/api/search?q=e2e_alice&type=users');
        const self = payload.users.find((u) => u.username === USERS.alice.username);
        expect(self).toBeDefined();
        expect(self.friendStatus).toBe('self');
        expect(self.friendshipId).toBeNull();
      } finally {
        await alice.dispose();
      }
    });

    test('no relation → friendStatus: none', async () => {
      const alice = await apiLogin(USERS.alice);
      try {
        const payload = await assertOk(alice, 'GET', '/api/search?q=e2e_bob&type=users');
        const bob = payload.users.find((u) => u.username === USERS.bob.username);
        expect(bob).toBeDefined();
        expect(bob.friendStatus).toBe('none');
        expect(bob.friendshipId).toBeNull();
      } finally {
        await alice.dispose();
      }
    });

    test('accepted friendship → friendStatus: friends, friendshipId null', async () => {
      await createAcceptedFriendship(USERS.alice.id, USERS.bob.id);
      const alice = await apiLogin(USERS.alice);
      try {
        const payload = await assertOk(alice, 'GET', '/api/search?q=e2e_bob&type=users');
        const bob = payload.users.find((u) => u.username === USERS.bob.username);
        expect(bob.friendStatus).toBe('friends');
        expect(bob.friendshipId).toBeNull();
      } finally {
        await alice.dispose();
      }
    });

    test('viewer sent the request → friendStatus: pending-out, friendshipId null', async () => {
      await createPendingFriendship(USERS.alice.id, USERS.bob.id);
      const alice = await apiLogin(USERS.alice);
      try {
        const payload = await assertOk(alice, 'GET', '/api/search?q=e2e_bob&type=users');
        const bob = payload.users.find((u) => u.username === USERS.bob.username);
        expect(bob.friendStatus).toBe('pending-out');
        // pending-out is render-only in the UI; no actionable id surfaced.
        expect(bob.friendshipId).toBeNull();
      } finally {
        await alice.dispose();
      }
    });

    test('viewer received a request → friendStatus: pending-in, friendshipId set', async () => {
      const id = await createPendingFriendship(USERS.bob.id, USERS.alice.id);
      const alice = await apiLogin(USERS.alice);
      try {
        const payload = await assertOk(alice, 'GET', '/api/search?q=e2e_bob&type=users');
        const bob = payload.users.find((u) => u.username === USERS.bob.username);
        expect(bob.friendStatus).toBe('pending-in');
        // pending-in is the one state that drives an Accept button; the
        // id must be present so the frontend can POST to /api/friends/:id/accept.
        expect(bob.friendshipId).toBe(id);
      } finally {
        await alice.dispose();
      }
    });
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
