'use strict';

// Wiring proof for the per-endpoint API suite (Phase 1).
// /healthz is mounted at the root (not /api/) — confirms anon access works
// and the response shape matches { ok: true } exactly.
//
// Tier 22 M1 — `uptime` field was removed (information disclosure: tells an
// attacker when the container last restarted). The test asserts the
// uptime key is ABSENT so a future inadvertent re-add fails CI.

const { test, expect } = require('@playwright/test');
const { apiAnon } = require('../helpers/api');
const { assertOk } = require('../helpers/apiAssertions');

test.describe('GET /healthz', () => {
  test('happy path → 200 with { ok: true } exactly (no uptime leak)', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/healthz');
      expect(payload).toEqual({ ok: true });
      expect(payload.uptime).toBeUndefined();
    } finally {
      await anon.dispose();
    }
  });
});
