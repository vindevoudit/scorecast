'use strict';

// Per-endpoint boundary suite for routes/me.js. Covers GET /api/me, PUT /me,
// POST /me/onboarding-completed, POST /me/password, PATCH /me/email, and
// the three 2FA endpoints (setup / confirm / disable).
//
// All routes require authMiddleware. State-changing routes also require
// CSRF (none of /api/me/* are on the EXEMPT_PATHS list). Password / email /
// 2fa/setup additionally require currentPassword.

const { test, expect } = require('@playwright/test');
const speakeasy = require('speakeasy');

const { USERS } = require('../fixtures/data');
const { apiLogin, setUserPassword, updateUserFields, clear2faForUser } = require('../helpers/api');
const {
  assertOk,
  assertUnauthorized,
  assertCsrfRejected,
  assertValidationError,
  expectShape,
} = require('../helpers/apiAssertions');

// ---------------------------------------------------------------------------
// GET /api/me
// ---------------------------------------------------------------------------

test.describe('GET /api/me', () => {
  test('happy path → 200 with profile shape', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/me');
      expectShape(payload, [
        'id',
        'username',
        'role',
        'displayName',
        'email',
        'emailVerifiedAt',
        'twoFactorEnabled',
        'onboardingCompletedAt',
        'profileVisibility',
        'joinedGroups',
        'pendingInvites',
      ]);
      expect(payload.username).toBe(USERS.alice.username);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('GET', '/api/me');
  });
});

// ---------------------------------------------------------------------------
// PUT /api/me
// ---------------------------------------------------------------------------

test.describe('PUT /api/me', () => {
  test.afterEach(async () => {
    await updateUserFields(USERS.alice.id, { displayName: null, bio: null });
  });

  test('happy path → 200 + persists displayName + bio', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'PUT', '/api/me', {
        displayName: 'Alice Test',
        bio: 'I write API tests.',
      });
      expect(payload.displayName).toBe('Alice Test');
      expect(payload.bio).toBe('I write API tests.');
    } finally {
      await authed.dispose();
    }
  });

  test('bad body (over-length bio) → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'PUT', '/api/me', { bio: 'x'.repeat(500) });
    } finally {
      await authed.dispose();
    }
  });

  test('bidi-control displayName → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'PUT', '/api/me', {
        displayName: 'Mall‮ry',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('PUT', '/api/me', { displayName: 'x' });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'PUT', '/api/me', { displayName: 'x' });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/me/onboarding-completed
// ---------------------------------------------------------------------------

test.describe('POST /api/me/onboarding-completed', () => {
  test('idempotent → 200 with onboardingCompletedAt', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', '/api/me/onboarding-completed');
      expectShape(payload, ['onboardingCompletedAt']);
      expect(payload.onboardingCompletedAt).toBeTruthy();
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/me/onboarding-completed');
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', '/api/me/onboarding-completed');
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/me/password
//
// Mutates alice's password. afterEach restores it via DB so subsequent specs
// can still apiLogin as alice.
// ---------------------------------------------------------------------------

test.describe('POST /api/me/password', () => {
  test.afterEach(async () => {
    await setUserPassword(USERS.alice.id, USERS.alice.password);
  });

  test('happy path → 200 + new password works for login', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const newPw = 'PostChangePw123!';
      const payload = await assertOk(authed, 'POST', '/api/me/password', {
        currentPassword: USERS.alice.password,
        newPassword: newPw,
      });
      expect(payload.ok).toBe(true);
      // New password works
      const reauth = await apiLogin({ username: USERS.alice.username, password: newPw });
      await reauth.dispose();
    } finally {
      await authed.dispose();
    }
  });

  test('wrong currentPassword → 401', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post('/api/me/password', {
        data: { currentPassword: 'wrong', newPassword: 'WhateverNew1!' },
      });
      expect(res.status()).toBe(401);
    } finally {
      await authed.dispose();
    }
  });

  test('newPassword equals current → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post('/api/me/password', {
        data: { currentPassword: USERS.alice.password, newPassword: USERS.alice.password },
      });
      expect(res.status()).toBe(400);
    } finally {
      await authed.dispose();
    }
  });

  test('short newPassword → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', '/api/me/password', {
        currentPassword: USERS.alice.password,
        newPassword: 'short',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/me/password', {
      currentPassword: 'x',
      newPassword: 'whatever123',
    });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', '/api/me/password', {
        currentPassword: USERS.alice.password,
        newPassword: 'WhateverNew1!',
      });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/me/email
//
// Mutates alice's email + clears emailVerifiedAt. afterEach restores both.
// ---------------------------------------------------------------------------

test.describe('PATCH /api/me/email', () => {
  test.afterEach(async () => {
    await updateUserFields(USERS.alice.id, {
      email: USERS.alice.email,
      emailVerifiedAt: new Date(),
    });
  });

  test('happy path → 200 + emailVerifiedAt reset to null', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const newEmail = `alice-rotated-${Date.now()}@example.test`;
      const payload = await assertOk(authed, 'PATCH', '/api/me/email', {
        email: newEmail,
        currentPassword: USERS.alice.password,
      });
      expect(payload.email).toBe(newEmail);
      expect(payload.emailVerifiedAt).toBeNull();
    } finally {
      await authed.dispose();
    }
  });

  test('wrong currentPassword → 401', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.patch('/api/me/email', {
        data: { email: 'x@example.test', currentPassword: 'wrong' },
      });
      expect(res.status()).toBe(401);
    } finally {
      await authed.dispose();
    }
  });

  test('email already in use (by bob) → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.patch('/api/me/email', {
        data: { email: USERS.bob.email, currentPassword: USERS.alice.password },
      });
      expect(res.status()).toBe(400);
    } finally {
      await authed.dispose();
    }
  });

  test('bad email shape → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'PATCH', '/api/me/email', {
        email: 'not-an-email',
        currentPassword: USERS.alice.password,
      });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('PATCH', '/api/me/email', {
      email: 'x@example.test',
      currentPassword: 'x',
    });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'PATCH', '/api/me/email', {
        email: 'x@example.test',
        currentPassword: USERS.alice.password,
      });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/me/2fa/setup → /me/2fa/confirm → /me/2fa/disable
//
// Lifecycle suite. afterAll clears alice's TOTP fields so the rest of the
// e2e suite is unaffected.
// ---------------------------------------------------------------------------

test.describe('POST /api/me/2fa/{setup,confirm,disable}', () => {
  test.afterEach(async () => {
    await clear2faForUser(USERS.alice.id);
  });

  test('setup happy path → 200 with secret + recovery codes', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', '/api/me/2fa/setup', {
        currentPassword: USERS.alice.password,
      });
      expectShape(payload, ['qrCodeDataUrl', 'secret', 'recoveryCodes']);
      expect(payload.recoveryCodes).toHaveLength(10);
    } finally {
      await authed.dispose();
    }
  });

  test('setup with wrong currentPassword → 401', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post('/api/me/2fa/setup', { data: { currentPassword: 'wrong' } });
      expect(res.status()).toBe(401);
    } finally {
      await authed.dispose();
    }
  });

  test('setup missing currentPassword → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', '/api/me/2fa/setup', {});
    } finally {
      await authed.dispose();
    }
  });

  test('confirm with valid code → 200 + sets totpEnabledAt', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const setup = await assertOk(authed, 'POST', '/api/me/2fa/setup', {
        currentPassword: USERS.alice.password,
      });
      const code = speakeasy.totp({ secret: setup.secret, encoding: 'base32' });
      const confirm = await assertOk(authed, 'POST', '/api/me/2fa/confirm', { code });
      expect(confirm.ok).toBe(true);
      expect(confirm.totpEnabledAt).toBeTruthy();
    } finally {
      await authed.dispose();
    }
  });

  test('confirm with garbage code → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertOk(authed, 'POST', '/api/me/2fa/setup', {
        currentPassword: USERS.alice.password,
      });
      const res = await authed.post('/api/me/2fa/confirm', { data: { code: '000000' } });
      expect(res.status()).toBe(400);
    } finally {
      await authed.dispose();
    }
  });

  test('disable after enable → 200', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const setup = await assertOk(authed, 'POST', '/api/me/2fa/setup', {
        currentPassword: USERS.alice.password,
      });
      const enableCode = speakeasy.totp({ secret: setup.secret, encoding: 'base32' });
      await assertOk(authed, 'POST', '/api/me/2fa/confirm', { code: enableCode });
      const disableCode = speakeasy.totp({ secret: setup.secret, encoding: 'base32' });
      const payload = await assertOk(authed, 'POST', '/api/me/2fa/disable', { code: disableCode });
      expect(payload.ok).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('disable when not enabled → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post('/api/me/2fa/disable', { data: { code: '123456' } });
      expect(res.status()).toBe(400);
    } finally {
      await authed.dispose();
    }
  });

  test('setup no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/me/2fa/setup', { currentPassword: 'x' });
  });

  test('setup no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', '/api/me/2fa/setup', {
        currentPassword: USERS.alice.password,
      });
    } finally {
      await authed.dispose();
    }
  });

  test('confirm no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/me/2fa/confirm', { code: '000000' });
  });

  test('disable no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/me/2fa/disable', { code: '000000' });
  });
});
