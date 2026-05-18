'use strict';

// Wiring proof for the per-endpoint API suite (Phase 1).
// /healthz is mounted at the root (not /api/) — confirms anon access works
// and the response shape matches { ok: true, uptime: <number> }.

const { test, expect } = require('@playwright/test');
const { apiAnon } = require('../helpers/api');
const { assertOk, expectShape } = require('../helpers/apiAssertions');

test.describe('GET /healthz', () => {
  test('happy path → 200 with ok + uptime', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/healthz');
      expectShape(payload, ['ok', 'uptime']);
      expect(payload.ok).toBe(true);
      expect(typeof payload.uptime).toBe('number');
    } finally {
      await anon.dispose();
    }
  });
});
