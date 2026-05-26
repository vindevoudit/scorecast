'use strict';

// Per-endpoint boundary suite for routes/groups.js. Eleven endpoints —
// list / discover / get / create / invite / accept / decline / join / leave
// / transfer / delete / visibility.
//
// The /groups/discover route MUST resolve before /groups/:groupId (CLAUDE.md
// invariant) — covered by the dedicated test in the describe block.

const { test, expect } = require('@playwright/test');

const { USERS } = require('../fixtures/data');
const { apiAnon, apiLogin, clearGroupsCreatedBy } = require('../helpers/api');
const {
  assertOk,
  assertUnauthorized,
  assertCsrfRejected,
  assertValidationError,
  assertNotFound,
  expectShape,
} = require('../helpers/apiAssertions');

const BOGUS_ID = '99999999-0000-4000-8000-999999999999';

// Many tests need a fresh group owned by alice. Helper to spin one up.
async function createGroupAs(user, { name, visibility = 'private' } = {}) {
  const authed = await apiLogin(user);
  try {
    const payload = await assertOk(authed, 'POST', '/api/groups', {
      name: name || `g_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      visibility,
    });
    return payload.id;
  } finally {
    await authed.dispose();
  }
}

// Issue an invite from alice and pull the resulting invite ID via bob's
// pendingInvites on GET /me — the invite ID isn't returned on the invite
// response itself (lib/groups.js getGroupById only surfaces {username,
// createdAt} per Tier 5.7 invariant).
async function inviteBobAndGetInviteId(groupId) {
  const aliceCtx = await apiLogin(USERS.alice);
  try {
    await assertOk(aliceCtx, 'POST', `/api/groups/${groupId}/invite`, {
      username: USERS.bob.username,
    });
  } finally {
    await aliceCtx.dispose();
  }
  const bobCtx = await apiLogin(USERS.bob);
  try {
    const me = await assertOk(bobCtx, 'GET', '/api/me');
    const invite = me.pendingInvites.find((i) => i.groupId === groupId);
    return invite?.id;
  } finally {
    await bobCtx.dispose();
  }
}

test.beforeEach(async () => {
  await clearGroupsCreatedBy([USERS.alice.id, USERS.bob.id, USERS.admin.id]);
});

// ---------------------------------------------------------------------------
// GET /api/groups
// ---------------------------------------------------------------------------

test.describe('GET /api/groups', () => {
  test('happy path → 200 + array', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/groups');
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('GET', '/api/groups');
  });
});

// ---------------------------------------------------------------------------
// GET /api/groups/discover  (must be matched before /groups/:groupId)
// ---------------------------------------------------------------------------

test.describe('GET /api/groups/discover', () => {
  test('anon → 200 + array (NOT 404 from UUID-shape mismatch)', async () => {
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', '/api/groups/discover');
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await anon.dispose();
    }
  });

  test('authed → 200 + array', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', '/api/groups/discover');
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/groups/:groupId
// ---------------------------------------------------------------------------

test.describe('GET /api/groups/:groupId', () => {
  test('owner viewing private group → 200', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', `/api/groups/${groupId}`);
      expectShape(payload, ['id', 'name', 'members']);
    } finally {
      await authed.dispose();
    }
  });

  test('anon viewing private group → 404 (no existence leak)', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const anon = await apiAnon();
    try {
      const res = await anon.get(`/api/groups/${groupId}`);
      expect(res.status()).toBe(404);
    } finally {
      await anon.dispose();
    }
  });

  test('anon viewing public group → 200', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'public' });
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', `/api/groups/${groupId}`);
      expectShape(payload, ['id', 'name']);
    } finally {
      await anon.dispose();
    }
  });

  test('unknown UUID → 404', async () => {
    const anon = await apiAnon();
    try {
      const res = await anon.get(`/api/groups/${BOGUS_ID}`);
      expect(res.status()).toBe(404);
    } finally {
      await anon.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/groups
// ---------------------------------------------------------------------------

test.describe('POST /api/groups', () => {
  test('happy path → 200 + group row', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', '/api/groups', {
        name: 'API Test Group',
        visibility: 'private',
      });
      expectShape(payload, ['id', 'name', 'ownerId']);
    } finally {
      await authed.dispose();
    }
  });

  test('empty name → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', '/api/groups', { name: '' });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', '/api/groups', { name: 'x' });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', '/api/groups', { name: 'x' });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/groups/:groupId/invite
// ---------------------------------------------------------------------------

test.describe('POST /api/groups/:groupId/invite', () => {
  test('owner inviting → 200', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', `/api/groups/${groupId}/invite`, {
        username: USERS.bob.username,
      });
      expect(payload.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('non-member inviting → 403', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.bob);
    try {
      const res = await authed.post(`/api/groups/${groupId}/invite`, {
        data: { username: USERS.admin.username },
      });
      expect(res.status()).toBe(403);
    } finally {
      await authed.dispose();
    }
  });

  test('unknown invitee → 400 (service throws bad_request, not 404)', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post(`/api/groups/${groupId}/invite`, {
        data: { username: 'nonexistent_user' },
      });
      expect(res.status()).toBe(400);
    } finally {
      await authed.dispose();
    }
  });

  test('bad body → 400', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', `/api/groups/${groupId}/invite`, {});
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/groups/${BOGUS_ID}/invite`, { username: 'x' });
  });

  test('no CSRF → 403', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', `/api/groups/${groupId}/invite`, {
        username: USERS.bob.username,
      });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/groups/:groupId/invite/:inviteId/accept   |   /decline
// ---------------------------------------------------------------------------

test.describe('POST /api/groups/:groupId/invite/:inviteId/{accept,decline}', () => {
  let groupId;
  let inviteId;

  test.beforeEach(async () => {
    groupId = await createGroupAs(USERS.alice);
    inviteId = await inviteBobAndGetInviteId(groupId);
  });

  test('accept happy path → 200', async () => {
    const bob = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(
        bob,
        'POST',
        `/api/groups/${groupId}/invite/${inviteId}/accept`,
      );
      expect(payload.success).toBe(true);
    } finally {
      await bob.dispose();
    }
  });

  test('accept by wrong user → 403', async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const res = await admin.post(`/api/groups/${groupId}/invite/${inviteId}/accept`);
      expect([403, 404]).toContain(res.status());
    } finally {
      await admin.dispose();
    }
  });

  test('accept no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/groups/${groupId}/invite/${inviteId}/accept`);
  });

  test('decline happy path → 200', async () => {
    const bob = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(
        bob,
        'POST',
        `/api/groups/${groupId}/invite/${inviteId}/decline`,
      );
      expect(payload.success).toBe(true);
    } finally {
      await bob.dispose();
    }
  });

  test('decline no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/groups/${groupId}/invite/${inviteId}/decline`);
  });
});

// ---------------------------------------------------------------------------
// POST /api/groups/:groupId/join + /leave
// ---------------------------------------------------------------------------

test.describe('POST /api/groups/:groupId/join + /leave', () => {
  test('join public group happy path → 200', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'public' });
    const bob = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(bob, 'POST', `/api/groups/${groupId}/join`);
      expect(payload.success).toBe(true);
    } finally {
      await bob.dispose();
    }
  });

  test('join private group → 403/404', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.post(`/api/groups/${groupId}/join`);
      expect([403, 404]).toContain(res.status());
    } finally {
      await bob.dispose();
    }
  });

  test('leave happy path → 200', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'public' });
    const bob = await apiLogin(USERS.bob);
    try {
      await assertOk(bob, 'POST', `/api/groups/${groupId}/join`);
      const payload = await assertOk(bob, 'POST', `/api/groups/${groupId}/leave`);
      expect(payload.success).toBe(true);
    } finally {
      await bob.dispose();
    }
  });

  test('join no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/groups/${BOGUS_ID}/join`);
  });

  test('leave no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/groups/${BOGUS_ID}/leave`);
  });
});

// ---------------------------------------------------------------------------
// POST /api/groups/:groupId/transfer
// ---------------------------------------------------------------------------

test.describe('POST /api/groups/:groupId/transfer', () => {
  let groupId;
  test.beforeEach(async () => {
    groupId = await createGroupAs(USERS.alice);
    const inviteIdLocal = await inviteBobAndGetInviteId(groupId);
    const bobCtx = await apiLogin(USERS.bob);
    try {
      await assertOk(bobCtx, 'POST', `/api/groups/${groupId}/invite/${inviteIdLocal}/accept`);
    } finally {
      await bobCtx.dispose();
    }
  });

  test('owner transfers to member → 200', async () => {
    const aliceCtx = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(aliceCtx, 'POST', `/api/groups/${groupId}/transfer`, {
        newOwnerId: USERS.bob.id,
      });
      expect(payload.success).toBe(true);
    } finally {
      await aliceCtx.dispose();
    }
  });

  test('non-owner attempts transfer → 403', async () => {
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.post(`/api/groups/${groupId}/transfer`, {
        data: { newOwnerId: USERS.admin.id },
      });
      expect(res.status()).toBe(403);
    } finally {
      await bob.dispose();
    }
  });

  test('bad body → 400', async () => {
    const aliceCtx = await apiLogin(USERS.alice);
    try {
      await assertValidationError(aliceCtx, 'POST', `/api/groups/${groupId}/transfer`, {});
    } finally {
      await aliceCtx.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/groups/${groupId}/transfer`, {
      newOwnerId: USERS.bob.id,
    });
  });

  test('no CSRF → 403', async () => {
    const aliceCtx = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(aliceCtx, 'POST', `/api/groups/${groupId}/transfer`, {
        newOwnerId: USERS.bob.id,
      });
    } finally {
      await aliceCtx.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/groups/:groupId
// ---------------------------------------------------------------------------

test.describe('DELETE /api/groups/:groupId', () => {
  test('owner deletes → 200', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'DELETE', `/api/groups/${groupId}`);
      expect(payload.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('non-owner attempts → 403', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.delete(`/api/groups/${groupId}`);
      expect(res.status()).toBe(403);
    } finally {
      await bob.dispose();
    }
  });

  test('unknown id → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertNotFound(authed, 'DELETE', `/api/groups/${BOGUS_ID}`);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('DELETE', `/api/groups/${BOGUS_ID}`);
  });

  test('no CSRF → 403', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'DELETE', `/api/groups/${groupId}`);
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/groups/:groupId/visibility
// ---------------------------------------------------------------------------

test.describe('POST /api/groups/:groupId/visibility', () => {
  test('owner flips → 200', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', `/api/groups/${groupId}/visibility`, {
        visibility: 'public',
      });
      expect(payload.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('non-owner flips → 403', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.post(`/api/groups/${groupId}/visibility`, {
        data: { visibility: 'public' },
      });
      expect(res.status()).toBe(403);
    } finally {
      await bob.dispose();
    }
  });

  test('bad enum → 400', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', `/api/groups/${groupId}/visibility`, {
        visibility: 'secret',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/groups/${BOGUS_ID}/visibility`, {
      visibility: 'public',
    });
  });
});

// ---------------------------------------------------------------------------
// GET/POST /api/groups/:id/comments — Tier 18 Chunk 5
// ---------------------------------------------------------------------------

// Walks bob through invite → accept so he ends up as a member of the group.
async function addBobToGroup(groupId) {
  const inviteId = await inviteBobAndGetInviteId(groupId);
  const bobCtx = await apiLogin(USERS.bob);
  try {
    await assertOk(bobCtx, 'POST', `/api/groups/${groupId}/invite/${inviteId}/accept`);
  } finally {
    await bobCtx.dispose();
  }
}

test.describe('GET /api/groups/:groupId/comments', () => {
  test('owner reading own private group → 200 + array', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', `/api/groups/${groupId}/comments`);
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('member reading private group → 200', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    await addBobToGroup(groupId);
    const bobCtx = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(bobCtx, 'GET', `/api/groups/${groupId}/comments`);
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await bobCtx.dispose();
    }
  });

  test('non-member reading private group → 404 (no existence leak)', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const bobCtx = await apiLogin(USERS.bob);
    try {
      await assertNotFound(bobCtx, 'GET', `/api/groups/${groupId}/comments`);
    } finally {
      await bobCtx.dispose();
    }
  });

  test('anon reading public group → 200', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'public' });
    const anon = await apiAnon();
    try {
      const payload = await assertOk(anon, 'GET', `/api/groups/${groupId}/comments`);
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await anon.dispose();
    }
  });

  test('unknown group id → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertNotFound(authed, 'GET', `/api/groups/${BOGUS_ID}/comments`);
    } finally {
      await authed.dispose();
    }
  });
});

test.describe('POST /api/groups/:groupId/comments', () => {
  test('member happy path → 200 with comment shape', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const authed = await apiLogin(USERS.alice);
    try {
      const created = await assertOk(authed, 'POST', `/api/groups/${groupId}/comments`, {
        body: 'first post',
      });
      expectShape(created, ['id', 'groupId', 'userId', 'username', 'body', 'createdAt']);
      expect(created.body).toBe('first post');
      expect(created.groupId).toBe(groupId);
      expect(created.gameId).toBeNull();
    } finally {
      await authed.dispose();
    }
  });

  test('non-member → 403', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'public' });
    const bobCtx = await apiLogin(USERS.bob);
    try {
      const res = await bobCtx.post(`/api/groups/${groupId}/comments`, {
        data: { body: 'sneaky' },
      });
      expect(res.status()).toBe(403);
    } finally {
      await bobCtx.dispose();
    }
  });

  test('post appears in subsequent GET list', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const authed = await apiLogin(USERS.alice);
    try {
      await assertOk(authed, 'POST', `/api/groups/${groupId}/comments`, { body: 'hello group' });
      const list = await assertOk(authed, 'GET', `/api/groups/${groupId}/comments`);
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0].body).toBe('hello group');
    } finally {
      await authed.dispose();
    }
  });

  test('empty body → 400', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', `/api/groups/${groupId}/comments`, { body: '' });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/groups/${BOGUS_ID}/comments`, { body: 'nope' });
  });

  test('no CSRF → 403', async () => {
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'POST', `/api/groups/${groupId}/comments`, {
        body: 'nope',
      });
    } finally {
      await authed.dispose();
    }
  });
});
