'use strict';

// Tier 5.5b — auth security invariants:
//  (1) Tier 6.6 lockout — 5 failed logins lock the account for 15 minutes;
//      the locked response is indistinguishable from "wrong password" so
//      attackers can't enumerate.
//  (2) Tier 6.4/6.8 password reset — visiting /?resetToken=<raw> opens the
//      reset form, submitting it clears lockout state and lets the user
//      sign back in with the new password.
//  (3) Tier 6.7 CSRF — state-changing /api/* calls without X-CSRF-Token are
//      rejected with 403 before any business logic runs.
//
// Each test resets the state it touches via tests/e2e/helpers/api.js so
// ordering across the file doesn't matter.

const { test, expect, request: pwRequest } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { resetUserLockout, insertPasswordResetToken } = require('./helpers/api');
const { USERS } = require('./fixtures/data');
const { BASE_URL } = require('./fixtures/env');

// NOTE: We don't call closeDb() per-spec. Playwright runs workers: 1 with the
// node process shared across specs, and require('models') caches the
// Sequelize instance — closing it in one afterAll breaks the next spec's
// queries. Let the process exit close the pool.

test('lockout: 5 bad logins lock the account; correct password then still fails with identical response', async () => {
  // Reset alice's counters — earlier specs may have left non-zero attempts.
  await resetUserLockout(USERS.alice.username);

  // Pure-API drives the lockout deterministically. The UI surfaces both
  // "Invalid credentials" and a transient unhandled-rejection toast which
  // race, so the contract being verified (Tier 6.6) is checked against the
  // wire response itself.
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
  try {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await ctx.post('/api/login', {
        data: { username: USERS.alice.username, password: 'not-the-right-password' },
      });
      expect(res.status(), `attempt ${attempt}`).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Invalid credentials');
    }

    // 6th attempt — using the CORRECT password. Server is now locked, so the
    // response must still be "Invalid credentials" verbatim (no enumeration).
    const locked = await ctx.post('/api/login', {
      data: { username: USERS.alice.username, password: USERS.alice.password },
    });
    expect(locked.status()).toBe(401);
    const lockedBody = await locked.json();
    expect(lockedBody.error).toBe('Invalid credentials');
    expect(lockedBody.error).not.toMatch(/locked|attempts|wait/i);

    // Same response shape for a completely unknown user (no enumeration of
    // existing usernames either).
    const unknown = await ctx.post('/api/login', {
      data: { username: 'e2e_does_not_exist', password: 'whatever1234' },
    });
    expect(unknown.status()).toBe(401);
    expect((await unknown.json()).error).toBe('Invalid credentials');
  } finally {
    await ctx.dispose();
    // Cleanup so subsequent specs can log in as alice.
    await resetUserLockout(USERS.alice.username);
  }
});

test('password reset: resetToken URL → new password flow logs the user in and clears lockout', async ({
  page,
  browser,
}) => {
  // Start clean.
  await resetUserLockout(USERS.alice.username);

  // Mint a fresh reset token directly (the real flow emails it; in tests we
  // mirror the server's hash-and-store pattern from routes/auth.js).
  const rawToken = await insertPasswordResetToken(USERS.alice.username);

  // Drive lockout via direct API calls so the loginAttempts column is non-zero
  // when we submit the reset — that lets us assert the reset clears it.
  const apiCtx = await pwRequest.newContext({ baseURL: BASE_URL });
  for (let i = 0; i < 5; i += 1) {
    const res = await apiCtx.post('/api/login', {
      data: { username: USERS.alice.username, password: 'still-wrong' },
    });
    expect(res.status()).toBe(401);
  }
  await apiCtx.dispose();

  // Open the reset form via the URL param the AuthContext consumes on mount.
  const newPassword = 'NewAlicePassword456!';
  await page.goto(`/?resetToken=${rawToken}`);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('#reset-password').fill(newPassword);
  await page.getByRole('button', { name: 'Set new password', exact: true }).click();

  // Successful reset takes us back to the auth screen.
  await expect(page.locator('#login-username')).toBeVisible({ timeout: 10_000 });

  // Alice can sign in with the new password — proves both (a) reset succeeded,
  // and (b) loginAttempts/lockedUntil were cleared even though alice was at 5
  // failed attempts a moment ago (Tier 6.4 + 6.8 cascade invariant).
  const verifyContext = await browser.newContext();
  const verifyPage = await verifyContext.newPage();
  await loginViaUI(verifyPage, { username: USERS.alice.username, password: newPassword });
  await verifyContext.close();

  // Restore the seeded password so later specs that hard-code USERS.alice
  // still work. Reuses the same reset flow, this time with a clean session.
  const restoreToken = await insertPasswordResetToken(USERS.alice.username);
  const restoreContext = await browser.newContext();
  const restorePage = await restoreContext.newPage();
  await restorePage.goto(`/?resetToken=${restoreToken}`);
  await restorePage.locator('#reset-password').fill(USERS.alice.password);
  await restorePage.getByRole('button', { name: 'Set new password', exact: true }).click();
  await expect(restorePage.locator('#login-username')).toBeVisible({ timeout: 10_000 });
  await restoreContext.close();
});

test('csrf: POST /api/picks without X-CSRF-Token is rejected with 403', async () => {
  // CSRF check happens before authMiddleware on protected routes, so even an
  // unauth'd POST with no token gets the same 403 — exercising the middleware
  // without any login dance.
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
  try {
    // Hit any endpoint first so the sc_csrf cookie lands in the jar (csrfMiddleware
    // sets it on every request). We then deliberately omit the header on the POST.
    await ctx.get('/healthz');
    const res = await ctx.post('/api/picks', {
      data: { gameId: '11111111-0000-4000-8000-000000000001', choice: 'home' },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/CSRF/i);
  } finally {
    await ctx.dispose();
  }
});
