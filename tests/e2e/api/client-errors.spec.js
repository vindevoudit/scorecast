'use strict';

// Per-endpoint boundary suite for routes/client-errors.js. One endpoint:
// POST /api/client-errors. Pre-auth + CSRF-exempt by design (see
// middleware/csrf.js EXEMPT_PATHS) — used by the browser error reporter
// before the user has a session.

const { test, expect } = require('@playwright/test');

const { apiAnon } = require('../helpers/api');
const { assertNoContent, assertValidationError } = require('../helpers/apiAssertions');

test.describe('POST /api/client-errors', () => {
  test('anon happy path → 204', async () => {
    const anon = await apiAnon();
    try {
      await assertNoContent(anon, 'POST', '/api/client-errors', {
        message: 'API test client error',
        url: 'https://example.test/',
        userAgent: 'spec',
      });
    } finally {
      await anon.dispose();
    }
  });

  test('missing message → 400', async () => {
    const anon = await apiAnon();
    try {
      await assertValidationError(anon, 'POST', '/api/client-errors', { url: 'x' });
    } finally {
      await anon.dispose();
    }
  });

  test('over-length stack → 400', async () => {
    const anon = await apiAnon();
    try {
      await assertValidationError(anon, 'POST', '/api/client-errors', {
        message: 'x',
        stack: 'x'.repeat(9000),
      });
    } finally {
      await anon.dispose();
    }
  });

  test('bad level enum → 400', async () => {
    const anon = await apiAnon();
    try {
      await assertValidationError(anon, 'POST', '/api/client-errors', {
        message: 'x',
        level: 'critical',
      });
    } finally {
      await anon.dispose();
    }
  });

  test('CSRF NOT required (route on EXEMPT_PATHS) — no header → still 204', async () => {
    const anon = await apiAnon();
    try {
      // Note: no CSRF header set; expect 204 anyway because /client-errors
      // is on the CSRF exempt list.
      const res = await anon.post('/api/client-errors', {
        data: { message: 'csrf-exempt check' },
      });
      expect(res.status()).toBe(204);
    } finally {
      await anon.dispose();
    }
  });
});
