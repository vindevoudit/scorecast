'use strict';

// Per-endpoint boundary suite for routes/leagues.js. One public endpoint:
// GET /api/leagues — returns active leagues with their seasons.

const { test, expect } = require('@playwright/test');

const { USERS } = require('../fixtures/data');
const { apiAnon, apiLogin } = require('../helpers/api');
const { assertOk } = require('../helpers/apiAssertions');

test.describe('GET /api/leagues', () => {
  test('anon → 200 + array', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/api/leagues');
      expect(Array.isArray(payload)).toBe(true);
      // Seed always has at least one active league.
      expect(payload.length).toBeGreaterThan(0);
      expect(payload[0]).toHaveProperty('id');
      expect(payload[0]).toHaveProperty('sourceLeagueId');
      expect(payload[0]).toHaveProperty('seasons');
    } finally {
      await anon.dispose();
    }
  });

  test('authed → 200 + array', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/leagues');
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await authed.dispose();
    }
  });
});
