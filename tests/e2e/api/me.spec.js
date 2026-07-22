'use strict';

// Per-endpoint boundary suite for routes/me.js. Covers GET /api/me, PUT /me,
// POST /me/onboarding-completed, POST /me/password, PATCH /me/email.
//
// Tier 22 — the 2FA setup/confirm/disable describe block was removed
// alongside the route handlers. A regression at the bottom asserts each of
// the three routes returns 404 so a future inadvertent re-mount fails CI.
//
// All routes require authMiddleware. State-changing routes also require
// CSRF (none of /api/me/* are on the EXEMPT_PATHS list). Password / email
// additionally require currentPassword.

const { test, expect } = require('@playwright/test');

const { USERS } = require('../fixtures/data');
const {
  apiLogin,
  setUserPassword,
  updateUserFields,
  createWcCabinetFixture,
  clearWcCabinetFixture,
  getUserId,
} = require('../helpers/api');
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
        // Phase 0 P0-4 — observability column surfaced for the ChangeEmailPanel
        // "Sent N min ago" copy. Always present on every /me response.
        'lastVerificationSentAt',
        // twoFactorEnabled stays in the response (always false post-Tier-22)
        // until 2FA is revived; expectShape just checks the listed keys.
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

  // Tier 20 Chunk 2 — profanity rejection covers displayName + bio. The
  // matcher is shared across 6 surfaces (see validation/schemas.js
  // noProfanity).
  test('profane displayName → 400 with rejection message', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.put('/api/me', { data: { displayName: 'Mr Shit' } });
      expect(res.status()).toBe(400);
      const payload = await res.json();
      expect(payload.error).toMatch(/inappropriate language/i);
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
// ---------------------------------------------------------------------------
// POST /api/me/resend-verification (Phase 0 P0-4)
// ---------------------------------------------------------------------------

test.describe('POST /api/me/resend-verification', () => {
  // Test users (bob in particular) ship as verified per the seed. Toggling
  // emailVerifiedAt around tests lets us cover both branches without
  // permanently changing seed state.

  test.afterEach(async () => {
    // Restore bob's verified state + clear lastVerificationSentAt to a
    // known baseline so order across tests in this file stays harmless.
    await updateUserFields(USERS.bob.id, {
      emailVerifiedAt: new Date(),
      lastVerificationSentAt: null,
    });
  });

  test('unverified user → 200 with sent:true and lastVerificationSentAt populated', async () => {
    // Stage: bob is unverified.
    await updateUserFields(USERS.bob.id, {
      emailVerifiedAt: null,
      lastVerificationSentAt: null,
    });
    const authed = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(authed, 'POST', '/api/me/resend-verification', {});
      expect(payload.sent).toBe(true);
      // ISO timestamp string; loose check that it's a parseable date.
      expect(payload.lastVerificationSentAt).toBeTruthy();
      expect(Number.isFinite(new Date(payload.lastVerificationSentAt).getTime())).toBe(true);

      // GET /me reflects the same value.
      const me = await assertOk(authed, 'GET', '/api/me');
      expect(me.lastVerificationSentAt).toBe(payload.lastVerificationSentAt);
    } finally {
      await authed.dispose();
    }
  });

  test('already-verified → 200 with sent:false alreadyVerified:true (idempotent)', async () => {
    // Bob's seeded as verified — no setup needed.
    await updateUserFields(USERS.bob.id, { emailVerifiedAt: new Date() });
    const authed = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(authed, 'POST', '/api/me/resend-verification', {});
      expect(payload.sent).toBe(false);
      expect(payload.alreadyVerified).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/me/resend-verification', {});
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', '/api/me/resend-verification', {});
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/me/stats — Tier 30 Phase 3 C1 personal stats dashboard endpoint.
// ---------------------------------------------------------------------------

test.describe('GET /api/me/stats', () => {
  test('happy path with default window → 200 with full stats shape', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/me/stats');
      expectShape(payload, [
        'window',
        'generatedAt',
        'summary',
        'pointsOverTime',
        'winRateTrend',
        'perLeague',
        'pickTimeHeatmap',
        'blindSpot',
        'mostDisagreedFriend',
      ]);
      expect(payload.window).toBe('30d');
      // Summary always present with 4 keys; values may be 0 if the seed
      // user has no scored picks.
      expectShape(payload.summary, ['picks', 'scored', 'wins', 'points']);
      // Heatmap is fixed 7×24 regardless of pick history.
      expect(payload.pickTimeHeatmap.length).toBe(7);
      expect(payload.pickTimeHeatmap[0].length).toBe(24);
    } finally {
      await authed.dispose();
    }
  });

  test('window=90d → window field echoes back', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/me/stats?window=90d');
      expect(payload.window).toBe('90d');
    } finally {
      await authed.dispose();
    }
  });

  test('window=season → window field echoes back', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/me/stats?window=season');
      expect(payload.window).toBe('season');
    } finally {
      await authed.dispose();
    }
  });

  test('invalid window → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.get('/api/me/stats?window=forever');
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/Invalid window/);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('GET', '/api/me/stats');
  });
});

// ---------------------------------------------------------------------------
// GET /api/me/wrapped — World Cup Wrapped self-only retrospective. Reachable
// only scoped to req.user.id; there is no per-username surface.
// ---------------------------------------------------------------------------

test.describe('GET /api/me/wrapped', () => {
  test('no auth → 401', async () => {
    await assertUnauthorized('GET', '/api/me/wrapped');
  });

  test('authed with no WC picks → 200 hasData:false shape', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/me/wrapped');
      expectShape(payload, [
        'userId',
        'username',
        'displayName',
        'tournament',
        'hasData',
        'summary',
        'overall',
        'boldestCall',
        'teamOfTournament',
        'upsetsCalled',
        'bestStage',
        'medals',
        'groups',
        'archetype',
        'generatedAt',
      ]);
      // Alice has no scored World Cup picks in the seed → nothing to celebrate.
      expect(payload.hasData).toBe(false);
      expectShape(payload.summary, ['picks', 'scored', 'wins', 'points', 'winRate']);
      // Archetype is always present (Newcomer fallback).
      expectShape(payload.archetype, ['key', 'title', 'emoji', 'blurb']);
    } finally {
      await authed.dispose();
    }
  });

  test('authed with a scored WC win → hasData:true with populated stats', async () => {
    const bobId = await getUserId(USERS.bob.username);
    const { leagueId } = await createWcCabinetFixture({
      picks: [{ userId: bobId, choice: 'home' }],
    });
    const authed = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(authed, 'GET', '/api/me/wrapped');
      expect(payload.hasData).toBe(true);
      // The staged game is result='home' at 0.5 → a correct pick scores 50.
      expect(payload.summary.wins).toBeGreaterThanOrEqual(1);
      expect(payload.summary.points).toBeGreaterThanOrEqual(50);
      // Bob is a participant → an overall placement + a best stage exist.
      expect(payload.overall).not.toBeNull();
      expect(payload.overall.rank).toBeGreaterThanOrEqual(1);
      expect(payload.bestStage).not.toBeNull();
      expect(payload.boldestCall).not.toBeNull();
      expect(payload.teamOfTournament).not.toBeNull();
    } finally {
      await authed.dispose();
      await clearWcCabinetFixture(leagueId);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 22 — 2FA routes removed. Regression test to catch inadvertent
// re-mount; all three should land on the /api 404 sentinel.
// ---------------------------------------------------------------------------

test.describe('Tier 22 — 2FA routes removed', () => {
  test('POST /api/me/2fa/setup → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post('/api/me/2fa/setup', {
        data: { currentPassword: USERS.alice.password },
      });
      expect(res.status()).toBe(404);
    } finally {
      await authed.dispose();
    }
  });

  test('POST /api/me/2fa/confirm → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post('/api/me/2fa/confirm', { data: { code: '000000' } });
      expect(res.status()).toBe(404);
    } finally {
      await authed.dispose();
    }
  });

  test('POST /api/me/2fa/disable → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post('/api/me/2fa/disable', { data: { code: '000000' } });
      expect(res.status()).toBe(404);
    } finally {
      await authed.dispose();
    }
  });
});
