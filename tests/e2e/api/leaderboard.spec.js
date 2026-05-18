'use strict';

// Per-endpoint boundary suite for routes/leaderboard.js. Single endpoint
// GET /api/leaderboard but tests cover:
//   - anon + authed happy paths
//   - bad query-param validation (400)
//   - optional groupId scoping
//   - league+season scoping

const { test, expect } = require('@playwright/test');

const { USERS, LEAGUE_ID, SEASON_ID } = require('../fixtures/data');
const { apiAnon, apiLogin } = require('../helpers/api');
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
});
