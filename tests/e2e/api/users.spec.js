'use strict';

// Per-endpoint boundary suite for routes/users.js. Two endpoints:
// GET /api/search and GET /api/users/:username/profile (Tier 8.6 privacy
// gate). Both use optionalAuth — anon access works.

const { test, expect } = require('@playwright/test');

const { USERS, GAMES } = require('../fixtures/data');
const {
  apiAnon,
  apiLogin,
  setProfileVisibility,
  updateUserFields,
  clearFriendships,
  createAcceptedFriendship,
  createPendingFriendship,
  createPick,
  clearGameResults,
  clearPicksAndBadges,
  updateGameFields,
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

  // Phase 0 P0-3 — profile query optimization. The service now reads
  // totalPoints / picksWon / picksScored from UserScoreOverall (Tier 24
  // materialized) instead of recomputing from the full picks × games
  // table on every request. These tests lock the response shape so any
  // refactor that drops a field is caught by CI.
  test('profile shape includes the totals + recentPicks (P0-3 contract)', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', `/api/users/${USERS.alice.username}/profile`);
      expectShape(payload, [
        'username',
        'totalPoints',
        'picksMade',
        'picksWon',
        'picksScored',
        'winRate',
        'recentPicks',
        'badges',
        'catalog',
      ]);
      expect(typeof payload.totalPoints).toBe('number');
      expect(typeof payload.picksMade).toBe('number');
      expect(typeof payload.picksWon).toBe('number');
      expect(typeof payload.picksScored).toBe('number');
      expect(typeof payload.winRate).toBe('number');
      expect(Array.isArray(payload.recentPicks)).toBe(true);
      // Cap is 10 — anyone who has more picks than that shouldn't blow
      // the response payload up.
      expect(payload.recentPicks.length).toBeLessThanOrEqual(10);
    } finally {
      await anon.dispose();
    }
  });

  // Anti-bias gate (2026-06): recentPicks must hide the target's UPCOMING
  // picks from every other viewer (telegraphing a pick before kickoff would
  // bias them), but a user always sees their OWN upcoming picks.
  test('recentPicks hides upcoming picks from other viewers, shows them to self', async () => {
    await clearPicksAndBadges([USERS.alice.id]);
    await clearGameResults([GAMES.lions.id]); // lions → scheduled + future, unscored
    const alice = await apiLogin(USERS.alice);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      // Self-view: alice sees her own upcoming pick.
      const selfProfile = await assertOk(
        alice,
        'GET',
        `/api/users/${USERS.alice.username}/profile`,
      );
      expect(selfProfile.recentPicks.some((p) => p.gameId === GAMES.lions.id)).toBe(true);
    } finally {
      await alice.dispose();
    }
    // Other viewer (anon): the upcoming pick is hidden.
    const anon = await apiAnon();
    try {
      const otherProfile = await assertOk(
        anon,
        'GET',
        `/api/users/${USERS.alice.username}/profile`,
      );
      expect(otherProfile.recentPicks.some((p) => p.gameId === GAMES.lions.id)).toBe(false);
    } finally {
      await anon.dispose();
    }
    // Once it kicks off, it's visible to everyone.
    await updateGameFields(GAMES.lions.id, { status: 'in-progress' });
    const anon2 = await apiAnon();
    try {
      const afterKickoff = await assertOk(
        anon2,
        'GET',
        `/api/users/${USERS.alice.username}/profile`,
      );
      expect(afterKickoff.recentPicks.some((p) => p.gameId === GAMES.lions.id)).toBe(true);
    } finally {
      await anon2.dispose();
    }
    // Teardown: reset the game + clear the pick we created.
    await updateGameFields(GAMES.lions.id, { status: 'scheduled' });
    await clearPicksAndBadges([USERS.alice.id]);
  });

  test('winRate stays in [0, 1] for users with picks', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', `/api/users/${USERS.alice.username}/profile`);
      expect(payload.winRate).toBeGreaterThanOrEqual(0);
      expect(payload.winRate).toBeLessThanOrEqual(1);
    } finally {
      await anon.dispose();
    }
  });

  test('headToHead present only for friend viewers', async () => {
    // Default state: alice and bob are NOT friends (test reset before).
    await clearFriendships(USERS.alice.id, USERS.bob.id);
    const bob = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(bob, 'GET', `/api/users/${USERS.alice.username}/profile`);
      // Non-friend → no H2H block.
      expect(payload.headToHead).toBeNull();
    } finally {
      await bob.dispose();
    }
    // Now make them friends and re-verify H2H surfaces.
    await createAcceptedFriendship(USERS.alice.id, USERS.bob.id);
    const bob2 = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(bob2, 'GET', `/api/users/${USERS.alice.username}/profile`);
      expect(payload.headToHead).not.toBeNull();
      expect(typeof payload.headToHead.viewerWins).toBe('number');
      expect(typeof payload.headToHead.targetWins).toBe('number');
      expect(typeof payload.headToHead.ties).toBe('number');
    } finally {
      await bob2.dispose();
      await clearFriendships(USERS.alice.id, USERS.bob.id);
    }
  });
});
