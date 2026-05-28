'use strict';

// Per-endpoint boundary suite for routes/auth.js (Phase 2 of the API suite).
// Covers POST /api/register, /api/login, /api/auth/{verify-email,
// forgot-password, reset-password, refresh, logout}.
//
// Tier 22 — the 2FA verify describe block was removed alongside the route.
// A regression test at the bottom of the file asserts /api/auth/2fa/verify
// returns 404 so a future inadvertent re-mount surfaces in CI.
//
// All endpoints in this file are pre-auth (no authMiddleware), so the
// authoritative gates are CSRF (where not exempt), zod validation, and
// per-endpoint domain checks. See middleware/csrf.js EXEMPT_PATHS for the
// CSRF-exempt subset.

const { test, expect, request: pwRequest } = require('@playwright/test');

const { USERS } = require('../fixtures/data');
const { BASE_URL } = require('../fixtures/env');
const {
  apiAnon,
  apiLogin,
  resetUserLockout,
  insertPasswordResetToken,
  deleteUserByUsername,
} = require('../helpers/api');
const {
  assertOk,
  assertNoContent,
  assertValidationError,
  expectShape,
} = require('../helpers/apiAssertions');

// ---------------------------------------------------------------------------
// POST /api/register
// ---------------------------------------------------------------------------

test.describe('POST /api/register', () => {
  const newUsername = () => `api_reg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const created = [];

  test.afterEach(async () => {
    while (created.length) await deleteUserByUsername(created.pop());
  });

  test('happy path → 200 with {user}', async () => {
    const username = newUsername();
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'POST', '/api/register', {
        username,
        password: 'TempPassword123!',
        email: `${username}@example.test`,
        acceptedTerms: true,
        acceptedTermsVersion: 2,
        confirmedAge: true,
      });
      expectShape(payload, ['user']);
      expect(payload.user.username).toBe(username);
      created.push(username);
    } finally {
      await anon.dispose();
    }
  });

  test('duplicate username → 400', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.post('/api/register', {
        data: {
          username: USERS.alice.username,
          password: 'Whatever1234!',
          email: 'someone-new@example.test',
          acceptedTerms: true,
          acceptedTermsVersion: 2,
          confirmedAge: true,
        },
      });
      expect(res.status()).toBe(400);
    } finally {
      await anon.dispose();
    }
  });

  test('duplicate email → 400', async () => {
    const username = newUsername();
    const anon = await apiAnon();
    try {
      const res = await anon.post('/api/register', {
        data: {
          username,
          password: 'Whatever1234!',
          email: USERS.alice.email,
          acceptedTerms: true,
          acceptedTermsVersion: 2,
          confirmedAge: true,
        },
      });
      expect(res.status()).toBe(400);
    } finally {
      await anon.dispose();
    }
  });

  test('bad body → 400', async () => {
    const anon = await apiAnon();
    try {
      await assertValidationError(anon, 'POST', '/api/register', { username: 'x' });
    } finally {
      await anon.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/login
// ---------------------------------------------------------------------------

test.describe('POST /api/login', () => {
  test.afterEach(async () => {
    await resetUserLockout(USERS.alice.username);
  });

  test('happy path → 200 with {user}', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'POST', '/api/login', {
        username: USERS.alice.username,
        password: USERS.alice.password,
      });
      expectShape(payload, ['user']);
      expect(payload.user.username).toBe(USERS.alice.username);
    } finally {
      await anon.dispose();
    }
  });

  test('wrong password → 401', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.post('/api/login', {
        data: { username: USERS.alice.username, password: 'definitely-wrong' },
      });
      expect(res.status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  test('unknown user → 401 (same shape — anti-enumeration)', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.post('/api/login', {
        data: { username: 'no_such_user_aa', password: 'definitely-wrong' },
      });
      expect(res.status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  test('bad body → 400', async () => {
    const anon = await apiAnon();
    try {
      await assertValidationError(anon, 'POST', '/api/login', { username: 'x' });
    } finally {
      await anon.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify-email
// ---------------------------------------------------------------------------

test.describe('POST /api/auth/verify-email', () => {
  test('garbage token shape → 400', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.post('/api/auth/verify-email', { data: { token: 'short' } });
      expect(res.status()).toBe(400);
    } finally {
      await anon.dispose();
    }
  });

  test('well-shaped but unknown token → 400', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.post('/api/auth/verify-email', {
        data: { token: 'a'.repeat(64) },
      });
      expect(res.status()).toBe(400);
    } finally {
      await anon.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password
// ---------------------------------------------------------------------------

test.describe('POST /api/auth/forgot-password', () => {
  test('known verified email → 204', async () => {
    const anon = await apiAnon();
    try {
      await assertNoContent(anon, 'POST', '/api/auth/forgot-password', {
        email: USERS.alice.email,
      });
    } finally {
      await anon.dispose();
    }
  });

  test('nonexistent email → 204 (anti-enumeration)', async () => {
    const anon = await apiAnon();
    try {
      await assertNoContent(anon, 'POST', '/api/auth/forgot-password', {
        email: 'nobody-here@example.test',
      });
    } finally {
      await anon.dispose();
    }
  });

  test('bad body → 400', async () => {
    const anon = await apiAnon();
    try {
      await assertValidationError(anon, 'POST', '/api/auth/forgot-password', {
        email: 'not-an-email',
      });
    } finally {
      await anon.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password
//
// Uses a throwaway registered user so alice's seed password stays stable for
// the rest of the suite.
// ---------------------------------------------------------------------------

test.describe('POST /api/auth/reset-password', () => {
  let tempUsername;
  const tempPassword = 'ResetSpecTempPw1!';

  test.beforeAll(async () => {
    tempUsername = `api_reset_${Date.now()}`;
    const anon = await apiAnon();
    try {
      const res = await anon.post('/api/register', {
        data: {
          username: tempUsername,
          password: tempPassword,
          email: `${tempUsername}@example.test`,
          acceptedTerms: true,
          acceptedTermsVersion: 2,
          confirmedAge: true,
        },
      });
      expect(res.ok()).toBe(true);
    } finally {
      await anon.dispose();
    }
    // Reset-password requires emailVerifiedAt to be set; the seed users have
    // it but register doesn't auto-verify. Mark via DB so the forgot-password
    // happy path's token would even be issued.
    const { User } = require('../../../models');
    const user = await User.findOne({ where: { username: tempUsername } });
    user.emailVerifiedAt = new Date();
    await user.save({ hooks: false });
  });

  test.afterAll(async () => {
    await deleteUserByUsername(tempUsername);
  });

  test('happy path → 200 + can login with new password', async () => {
    const raw = await insertPasswordResetToken(tempUsername);
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'POST', '/api/auth/reset-password', {
        token: raw,
        password: 'BrandNewPassword1!',
      });
      expect(payload.ok).toBe(true);
    } finally {
      await anon.dispose();
    }
    // Confirm cascade: the new password works
    const newAuthed = await apiLogin({ username: tempUsername, password: 'BrandNewPassword1!' });
    await newAuthed.dispose();
  });

  test('unknown token → 400', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.post('/api/auth/reset-password', {
        data: { token: 'b'.repeat(64), password: 'Whatever1234!' },
      });
      expect(res.status()).toBe(400);
    } finally {
      await anon.dispose();
    }
  });

  test('short password → 400', async () => {
    const raw = await insertPasswordResetToken(tempUsername);
    const anon = await apiAnon();
    try {
      await assertValidationError(anon, 'POST', '/api/auth/reset-password', {
        token: raw,
        password: 'short',
      });
    } finally {
      await anon.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------

test.describe('POST /api/auth/refresh', () => {
  test('happy path → 204 + rotates the refresh token', async () => {
    // Bootstrap fresh login to get a known refresh cookie.
    const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
    try {
      const loginRes = await ctx.post('/api/login', {
        data: { username: USERS.alice.username, password: USERS.alice.password },
      });
      expect(loginRes.ok()).toBe(true);
      const stateBefore = await ctx.storageState();
      const oldRefresh = stateBefore.cookies.find((c) => c.name === 'sc_refresh')?.value;
      expect(oldRefresh).toBeTruthy();

      const refreshRes = await ctx.post('/api/auth/refresh');
      expect(refreshRes.status()).toBe(204);

      const stateAfter = await ctx.storageState();
      const newRefresh = stateAfter.cookies.find((c) => c.name === 'sc_refresh')?.value;
      expect(newRefresh).toBeTruthy();
      expect(newRefresh).not.toBe(oldRefresh);
    } finally {
      await ctx.dispose();
    }
  });

  test('no refresh cookie → 401', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.post('/api/auth/refresh');
      expect(res.status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  test('revoked refresh token → 401 on reuse', async () => {
    const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
    try {
      await ctx.post('/api/login', {
        data: { username: USERS.alice.username, password: USERS.alice.password },
      });
      const state = await ctx.storageState();
      const oldRefresh = state.cookies.find((c) => c.name === 'sc_refresh').value;

      // First refresh — rotates + revokes oldRefresh
      const first = await ctx.post('/api/auth/refresh');
      expect(first.status()).toBe(204);

      // Construct a second context that still presents the OLD refresh value
      const replay = await pwRequest.newContext({
        baseURL: BASE_URL,
        storageState: {
          cookies: [{ ...state.cookies.find((c) => c.name === 'sc_refresh') }],
          origins: [],
        },
      });
      try {
        const second = await replay.post('/api/auth/refresh');
        expect(second.status()).toBe(401);
        // Suppress unused var warning
        expect(oldRefresh).toBeTruthy();
      } finally {
        await replay.dispose();
      }
    } finally {
      await ctx.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

test.describe('POST /api/auth/logout', () => {
  test('authed → 204 + clears cookies', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post('/api/auth/logout');
      expect(res.status()).toBe(204);
    } finally {
      await authed.dispose();
    }
  });

  test('anon (no CSRF header) → 403', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.post('/api/auth/logout');
      // CSRF middleware fires before the route handler — without an
      // X-CSRF-Token header on a POST, the request is rejected.
      expect(res.status()).toBe(403);
    } finally {
      await anon.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 22 regression — 2FA routes are gone. If any future change accidentally
// re-mounts them, these tests should fail with a non-404 status. /api/auth/*
// is also guaranteed to land on the JSON-404 sentinel rather than the SPA
// shell (see server.js `/api` 404 sentinel above the SPA fallback).
// ---------------------------------------------------------------------------

test.describe('Tier 22 — 2FA routes removed', () => {
  test('POST /api/auth/2fa/verify → 404', async () => {
    const anon = await apiAnon();
    try {
      // Seed the CSRF cookie so we get past the CSRF middleware and onto
      // the route table.
      const csrfRes = await anon.get('/healthz');
      expect(csrfRes.ok()).toBe(true);
      const csrfCookie = (await anon.storageState()).cookies.find((c) => c.name === 'sc_csrf');
      const headered = await pwRequest.newContext({
        baseURL: BASE_URL,
        storageState: { cookies: [csrfCookie], origins: [] },
        extraHTTPHeaders: { 'X-CSRF-Token': csrfCookie.value },
      });
      try {
        const res = await headered.post('/api/auth/2fa/verify', { data: { code: '123456' } });
        expect(res.status()).toBe(404);
      } finally {
        await headered.dispose();
      }
    } finally {
      await anon.dispose();
    }
  });
});
