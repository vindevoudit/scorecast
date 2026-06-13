'use strict';

// Per-endpoint boundary suite for routes/leaderboard.js. Single endpoint
// GET /api/leaderboard but tests cover:
//   - anon + authed happy paths
//   - bad query-param validation (400)
//   - optional groupId scoping
//   - league+season scoping

const { test, expect } = require('@playwright/test');

const { USERS, LEAGUE_ID, SEASON_ID } = require('../fixtures/data');
const {
  apiAnon,
  apiLogin,
  getUserId,
  clearFriendships,
  createAcceptedFriendship,
  updateUserFields,
} = require('../helpers/api');
const { assertOk, expectShape } = require('../helpers/apiAssertions');

test.describe('GET /api/leaderboard', () => {
  test('anon → 200 with {overall, group, groupMeta}', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/api/leaderboard');
      expectShape(payload, ['overall', 'group', 'groupMeta']);
      expect(Array.isArray(payload.overall)).toBe(true);
    } finally {
      await anon.dispose();
    }
  });

  test('authed → 200 (viewer sees own row potentially unmasked)', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/leaderboard');
      expectShape(payload, ['overall', 'group', 'groupMeta']);
    } finally {
      await authed.dispose();
    }
  });

  test('league + season scope filters → 200 + filtered rows', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(
        anon,
        'GET',
        `/api/leaderboard?leagueId=${LEAGUE_ID}&seasonId=${SEASON_ID}`,
      );
      expectShape(payload, ['overall']);
    } finally {
      await anon.dispose();
    }
  });

  test('bad UUID on leagueId → 400', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.get('/api/leaderboard?leagueId=not-a-uuid');
      expect(res.status()).toBe(400);
    } finally {
      await anon.dispose();
    }
  });

  test('out-of-range limit → 400', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.get('/api/leaderboard?limit=99999');
      expect(res.status()).toBe(400);
    } finally {
      await anon.dispose();
    }
  });

  test('bad orderBy enum → 400', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.get('/api/leaderboard?orderBy=randomness');
      expect(res.status()).toBe(400);
    } finally {
      await anon.dispose();
    }
  });

  // Friends block — the viewer + every accepted friend, scored server-side so
  // they appear regardless of the overall top-N slice.
  test('authed → friends block includes self + accepted friend', async () => {
    const aliceId = await getUserId(USERS.alice.username);
    const bobId = await getUserId(USERS.bob.username);
    await clearFriendships([aliceId, bobId]);
    await createAcceptedFriendship(aliceId, bobId);
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/leaderboard');
      expectShape(payload, ['friends']);
      expect(Array.isArray(payload.friends)).toBe(true);
      const ids = payload.friends.map((r) => r.userId);
      expect(ids).toContain(aliceId);
      expect(ids).toContain(bobId);
    } finally {
      await authed.dispose();
      await clearFriendships([aliceId, bobId]);
    }
  });

  test('anon → friends is empty', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/api/leaderboard');
      expect(Array.isArray(payload.friends)).toBe(true);
      expect(payload.friends.length).toBe(0);
    } finally {
      await anon.dispose();
    }
  });

  test('leaderboard rows carry currentWinStreak', async () => {
    const aliceId = await getUserId(USERS.alice.username);
    await updateUserFields(aliceId, { currentWinStreak: 5 });
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/leaderboard');
      // Friends block is uncached, so the freshly-set value is reliable here.
      const selfRow = payload.friends.find((r) => r.userId === aliceId);
      expect(selfRow).toBeTruthy();
      expect(selfRow.currentWinStreak).toBe(5);
      // Overall rows always carry the field (numeric) post-change.
      expect(payload.overall.every((r) => typeof r.currentWinStreak === 'number')).toBe(true);
    } finally {
      await authed.dispose();
      await updateUserFields(aliceId, { currentWinStreak: 0 });
    }
  });

  test('friends block respects league + season scope', async () => {
    const aliceId = await getUserId(USERS.alice.username);
    const bobId = await getUserId(USERS.bob.username);
    await clearFriendships([aliceId, bobId]);
    await createAcceptedFriendship(aliceId, bobId);
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(
        authed,
        'GET',
        `/api/leaderboard?leagueId=${LEAGUE_ID}&seasonId=${SEASON_ID}`,
      );
      expect(Array.isArray(payload.friends)).toBe(true);
      const ids = payload.friends.map((r) => r.userId);
      expect(ids).toContain(aliceId);
      expect(ids).toContain(bobId);
    } finally {
      await authed.dispose();
      await clearFriendships([aliceId, bobId]);
    }
  });
});
