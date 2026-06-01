'use strict';

// Per-endpoint boundary suite for routes/games.js. Covers GET /api/games
// (public read), POST /api/games/:gameId/result (admin-only), GET
// /api/games/:gameId/comments (public read), POST .../comments (authed).

const { test, expect } = require('@playwright/test');

const { USERS, GAMES } = require('../fixtures/data');
const {
  apiAnon,
  apiLogin,
  clearGameResults,
  clearComments,
  createPick,
  clearPicksAndBadges,
  setGameResult,
  updateGameFields,
  updateUserFields,
} = require('../helpers/api');
const {
  assertOk,
  assertUnauthorized,
  assertForbiddenWithoutAdmin,
  assertCsrfRejected,
  assertValidationError,
} = require('../helpers/apiAssertions');

const BOGUS_ID = '99999999-0000-4000-8000-999999999999';

// ---------------------------------------------------------------------------
// GET /api/games
// ---------------------------------------------------------------------------

test.describe('GET /api/games', () => {
  test('anon → 200 + array', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/api/games');
      expect(Array.isArray(payload)).toBe(true);
      expect(payload.length).toBeGreaterThan(0);
    } finally {
      await anon.dispose();
    }
  });

  test('authed → 200 + array', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/games');
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('garbage leagueId silently treated as unfiltered (200 not 400)', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/api/games?leagueId=not-a-uuid');
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await anon.dispose();
    }
  });

  // Tier 30 Phase 3 A3 — voice-of-the-crowd indicator. Crowd is hidden
  // until the match has kicked off (status flipped OR wall-clock kickoff
  // passed) — picking the game no longer reveals it pre-kickoff.
  test.describe('crowd indicator gating', () => {
    test.afterEach(async () => {
      await clearPicksAndBadges([USERS.alice.id, USERS.bob.id]);
      await clearGameResults([GAMES.lions.id]);
      // Restore lions to an upcoming/scheduled state in case a test staged
      // it past kickoff via updateGameFields.
      await updateGameFields(GAMES.lions.id, { date: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    });

    test('upcoming game + viewer has not picked → no crowd field', async () => {
      const authed = await apiLogin(USERS.alice);
      try {
        const games = await assertOk(authed, 'GET', '/api/games');
        const lions = games.find((g) => g.id === GAMES.lions.id);
        expect(lions).toBeTruthy();
        expect(lions.crowd).toBeUndefined();
      } finally {
        await authed.dispose();
      }
    });

    test('upcoming game + viewer has picked → STILL no crowd field (hidden until kickoff)', async () => {
      const authed = await apiLogin(USERS.alice);
      try {
        await createPick(authed, GAMES.lions.id, 'home');
        const games = await assertOk(authed, 'GET', '/api/games');
        const lions = games.find((g) => g.id === GAMES.lions.id);
        expect(lions.crowd).toBeUndefined();
      } finally {
        await authed.dispose();
      }
    });

    test('kicked-off (wall-clock past) scheduled game → crowd present + aggregates across users', async () => {
      const alice = await apiLogin(USERS.alice);
      const bob = await apiLogin(USERS.bob);
      try {
        await createPick(alice, GAMES.lions.id, 'home');
        await createPick(bob, GAMES.lions.id, 'away');
        // Stage the game past its kickoff while still 'scheduled' — exercises
        // the wall-clock branch of the gate (covers the cron-lag window).
        await updateGameFields(GAMES.lions.id, { date: new Date(Date.now() - 60 * 60 * 1000) });
        const games = await assertOk(alice, 'GET', '/api/games');
        const lions = games.find((g) => g.id === GAMES.lions.id);
        expect(lions.crowd).toEqual({ home: 1, away: 1, total: 2 });
      } finally {
        await alice.dispose();
        await bob.dispose();
      }
    });

    test('anon viewer on upcoming game → no crowd field (anti-bias)', async () => {
      // Seed a pick from an authed user so the crowd has data; the anon
      // request should still NOT see the crowd field for the still-
      // upcoming game.
      const authed = await apiLogin(USERS.alice);
      try {
        await createPick(authed, GAMES.lions.id, 'home');
      } finally {
        await authed.dispose();
      }
      const anon = await apiAnon();
      try {
        const games = await assertOk(anon, 'GET', '/api/games');
        const lions = games.find((g) => g.id === GAMES.lions.id);
        expect(lions.crowd).toBeUndefined();
      } finally {
        await anon.dispose();
      }
    });

    test('game past lock (finished) → crowd present for anon viewer', async () => {
      const authed = await apiLogin(USERS.alice);
      try {
        await createPick(authed, GAMES.lions.id, 'home');
      } finally {
        await authed.dispose();
      }
      const admin = await apiLogin(USERS.admin);
      try {
        await setGameResult(admin, GAMES.lions.id, 'home');
      } finally {
        await admin.dispose();
      }
      const anon = await apiAnon();
      try {
        const games = await assertOk(anon, 'GET', '/api/games');
        const lions = games.find((g) => g.id === GAMES.lions.id);
        expect(lions.crowd).toEqual({ home: 1, away: 0, total: 1 });
      } finally {
        await anon.dispose();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/games/:gameId/result
// ---------------------------------------------------------------------------

test.describe('POST /api/games/:gameId/result', () => {
  test.afterEach(async () => {
    await clearGameResults([GAMES.lions.id]);
  });

  test('admin happy path → 200 with updated game', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'POST', `/api/games/${GAMES.lions.id}/result`, {
        result: 'home',
      });
      expect(payload.success).toBe(true);
      expect(payload.game.result).toBe('home');
    } finally {
      await admin.dispose();
    }
  });

  test('non-admin → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertForbiddenWithoutAdmin(authed, 'POST', `/api/games/${GAMES.lions.id}/result`, {
        result: 'home',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('unknown game → 404', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const res = await admin.post(`/api/games/${BOGUS_ID}/result`, { data: { result: 'home' } });
      expect(res.status()).toBe(404);
    } finally {
      await admin.dispose();
    }
  });

  test('bad result enum → 400', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await assertValidationError(admin, 'POST', `/api/games/${GAMES.lions.id}/result`, {
        result: 'tie',
      });
    } finally {
      await admin.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/games/${GAMES.lions.id}/result`, { result: 'home' });
  });

  test('no CSRF → 403', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      await assertCsrfRejected(admin, 'POST', `/api/games/${GAMES.lions.id}/result`, {
        result: 'home',
      });
    } finally {
      await admin.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/games/:gameId/comments
// ---------------------------------------------------------------------------

test.describe('GET /api/games/:gameId/comments', () => {
  test('anon → 200 + array', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', `/api/games/${GAMES.lions.id}/comments`);
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await anon.dispose();
    }
  });

  test('authed → 200 + array', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', `/api/games/${GAMES.lions.id}/comments`);
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/games/:gameId/comments
// ---------------------------------------------------------------------------

test.describe('POST /api/games/:gameId/comments', () => {
  test.afterEach(async () => {
    await clearComments(GAMES.lions.id);
  });

  test('happy path → 200 with comment row', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', `/api/games/${GAMES.lions.id}/comments`, {
        body: 'Hello from the API test suite.',
      });
      expect(payload).toHaveProperty('id');
      expect(payload).toHaveProperty('body');
      expect(payload.body).toBe('Hello from the API test suite.');
    } finally {
      await authed.dispose();
    }
  });

  test('empty body → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', `/api/games/${GAMES.lions.id}/comments`, {
        body: '',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('over-length body → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', `/api/games/${GAMES.lions.id}/comments`, {
        body: 'x'.repeat(501),
      });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/games/${GAMES.lions.id}/comments`, { body: 'x' });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', `/api/games/${GAMES.lions.id}/comments`, {
        body: 'x',
      });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 30 Phase 3 A1 Revision — Win-streak via result scoring
// ---------------------------------------------------------------------------

// Poll /api/me up to ~2s until streak.current/longest match the expected
// values. The streak fan-out from GameService is fire-and-forget; this
// helper gives the async work time to land without making the test slow
// in the happy case.
async function waitForStreak(authed, { current, longest }, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const me = await assertOk(authed, 'GET', '/api/me');
    last = me.streak;
    if (last.current === current && last.longest === longest) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(last).toEqual({ current, longest });
  return last;
}

test.describe('Win-streak (Tier 30 Phase 3 A1 Revision)', () => {
  const allGameIds = [GAMES.lions.id, GAMES.eagles.id, GAMES.wolves.id];

  test.afterEach(async () => {
    // Reset all picks + scored game results so the next test starts
    // from a clean baseline. clearGameResults routes through
    // GameService.setResult(null) which fires fanOutStreakUpdates →
    // the streak naturally returns to 0; we also explicitly stamp the
    // columns in case order-of-operations leaves a stale value.
    await clearGameResults(allGameIds);
    await clearPicksAndBadges([USERS.alice.id, USERS.bob.id]);
    await updateUserFields(USERS.alice.id, {
      currentWinStreak: 0,
      longestWinStreak: 0,
      lastMilestoneFired: 0,
    });
    await updateUserFields(USERS.bob.id, {
      currentWinStreak: 0,
      longestWinStreak: 0,
      lastMilestoneFired: 0,
    });
  });

  test('same-kickoff W/W/L: current 0, longest captures peak at 2', async () => {
    // Stamp all three games at one kickoff timestamp so they form a
    // same-batch trio. The exact timestamp doesn't matter — only that
    // it's shared and in the future (so createPick's pre-kickoff
    // guard accepts the picks).
    const sameKickoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await updateGameFields(GAMES.lions.id, { date: sameKickoff });
    await updateGameFields(GAMES.eagles.id, { date: sameKickoff });
    await updateGameFields(GAMES.wolves.id, { date: sameKickoff });

    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      // Alice picks home on all three.
      await createPick(alice, GAMES.lions.id, 'home');
      await createPick(alice, GAMES.eagles.id, 'home');
      await createPick(alice, GAMES.wolves.id, 'home');

      // Admin scores W (home), W (home), L (away). Within the batch
      // the recompute applies wins first: current 0 → 1 → 2 (longest
      // captures 2) → 0 on the loss. Final {current: 0, longest: 2}.
      await setGameResult(admin, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.eagles.id, 'home');
      await setGameResult(admin, GAMES.wolves.id, 'away');

      await waitForStreak(alice, { current: 0, longest: 2 });
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('monotonic longest survives result clear that trims history', async () => {
    const sameKickoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await updateGameFields(GAMES.lions.id, { date: sameKickoff });
    await updateGameFields(GAMES.eagles.id, { date: sameKickoff });
    await updateGameFields(GAMES.wolves.id, { date: sameKickoff });

    const alice = await apiLogin(USERS.alice);
    const admin = await apiLogin(USERS.admin);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      await createPick(alice, GAMES.eagles.id, 'home');
      await createPick(alice, GAMES.wolves.id, 'home');

      await setGameResult(admin, GAMES.lions.id, 'home');
      await setGameResult(admin, GAMES.eagles.id, 'home');
      await setGameResult(admin, GAMES.wolves.id, 'away');
      await waitForStreak(alice, { current: 0, longest: 2 });

      // Admin clears one of the wins. Recompute now sees only [W, L]
      // batch → current 0, naturally-computed longest 1. But longest
      // is MONOTONIC — the stamped 2 stays.
      await setGameResult(admin, GAMES.eagles.id, null);
      await waitForStreak(alice, { current: 0, longest: 2 });
    } finally {
      await alice.dispose();
      await admin.dispose();
    }
  });

  test('streak does not fire from pick create on an unscored game', async () => {
    // Pick a future game with no result. Streak hook used to fire from
    // PickService.createPick — that's been moved to the result hook.
    // Streak must stay 0 until a result lands.
    const alice = await apiLogin(USERS.alice);
    try {
      await createPick(alice, GAMES.lions.id, 'home');
      const me = await assertOk(alice, 'GET', '/api/me');
      expect(me.streak.current).toBe(0);
      expect(me.streak.longest).toBe(0);
    } finally {
      await alice.dispose();
    }
  });
});
