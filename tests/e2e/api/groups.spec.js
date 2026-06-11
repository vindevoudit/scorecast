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
// Tier 19 — extended to accept an optional password (private groups only).
async function createGroupAs(user, { name, visibility = 'secret', password } = {}) {
  const authed = await apiLogin(user);
  try {
    const body = {
      name: name || `g_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      visibility,
    };
    if (password) body.password = password;
    const payload = await assertOk(authed, 'POST', '/api/groups', body);
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
    const groupId = await createGroupAs(USERS.alice, { visibility: 'secret' });
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
        visibility: 'secret',
      });
      expectShape(payload, ['id', 'name', 'ownerId', 'discriminator']);
    } finally {
      await authed.dispose();
    }
  });

  // Phase 0 T29-1 — discriminator contract. 6 uppercase hex chars,
  // server-set on every group create, and unique across all groups so
  // two groups with identical names can be visually disambiguated.
  test('discriminator is 6 uppercase hex chars on every create', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'POST', '/api/groups', {
        name: 'Discriminator Format Test',
        visibility: 'secret',
      });
      expect(payload.discriminator).toMatch(/^[0-9A-F]{6}$/);
    } finally {
      await authed.dispose();
    }
  });

  test('two groups with identical names get distinct discriminators', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const a = await assertOk(authed, 'POST', '/api/groups', {
        name: 'Friday Football',
        visibility: 'secret',
      });
      const b = await assertOk(authed, 'POST', '/api/groups', {
        name: 'Friday Football',
        visibility: 'secret',
      });
      expect(a.name).toBe(b.name);
      expect(a.id).not.toBe(b.id);
      // Both well-formed.
      expect(a.discriminator).toMatch(/^[0-9A-F]{6}$/);
      expect(b.discriminator).toMatch(/^[0-9A-F]{6}$/);
      // And distinct — the disambiguator does its job.
      expect(a.discriminator).not.toBe(b.discriminator);
    } finally {
      await authed.dispose();
    }
  });

  test('discriminator persists across reads (GET /api/groups)', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const created = await assertOk(authed, 'POST', '/api/groups', {
        name: 'Discriminator Roundtrip',
        visibility: 'secret',
      });
      const list = await assertOk(authed, 'GET', '/api/groups');
      const found = list.find((g) => g.id === created.id);
      expect(found).toBeDefined();
      expect(found.discriminator).toBe(created.discriminator);
    } finally {
      await authed.dispose();
    }
  });

  test('discriminator surfaces on GET /api/groups/:groupId', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const created = await assertOk(authed, 'POST', '/api/groups', {
        name: 'GetById Discriminator',
        visibility: 'public',
      });
      const fetched = await assertOk(authed, 'GET', `/api/groups/${created.id}`);
      expect(fetched.discriminator).toBe(created.discriminator);
    } finally {
      await authed.dispose();
    }
  });

  test('search returns discriminator on group results', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const uniqueName = `SearchDiscrim_${Date.now()}`;
      const created = await assertOk(authed, 'POST', '/api/groups', {
        name: uniqueName,
        visibility: 'public',
      });
      const result = await assertOk(
        authed,
        'GET',
        `/api/search?q=${encodeURIComponent(uniqueName)}&type=groups`,
      );
      const row = (result.groups || []).find((g) => g.id === created.id);
      expect(row).toBeDefined();
      expect(row.discriminator).toBe(created.discriminator);
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

  // Tier 20 Chunk 2 — profanity rejection on group name. Third surface
  // covered (comment body + displayName covered in comments.spec.js +
  // me.spec.js).
  test('profane name → 400 with rejection message', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.post('/api/groups', {
        data: { name: 'Shit group' },
      });
      expect(res.status()).toBe(400);
      const payload = await res.json();
      expect(payload.error).toMatch(/inappropriate language/i);
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
    const groupId = await createGroupAs(USERS.alice, { visibility: 'secret' });
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
    const groupId = await createGroupAs(USERS.alice, { visibility: 'secret' });
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
    // Tier 19 — visibility enum is now public/private/secret. Use a
    // string that's NOT in the set so we hit the zod validation path.
    const groupId = await createGroupAs(USERS.alice);
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'POST', `/api/groups/${groupId}/visibility`, {
        visibility: 'bogus',
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
    const groupId = await createGroupAs(USERS.alice, { visibility: 'secret' });
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'GET', `/api/groups/${groupId}/comments`);
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('member reading private group → 200', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'secret' });
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
    const groupId = await createGroupAs(USERS.alice, { visibility: 'secret' });
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
    const groupId = await createGroupAs(USERS.alice, { visibility: 'secret' });
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
    const groupId = await createGroupAs(USERS.alice, { visibility: 'secret' });
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

// ---------------------------------------------------------------------------
// Tier 19 Chunk 1 — Password-protected join + owner password rotation
// ---------------------------------------------------------------------------

test.describe('POST /api/groups/:groupId/join-with-password', () => {
  test('private + correct password → 200, becomes a member', async () => {
    const groupId = await createGroupAs(USERS.alice, {
      visibility: 'private',
      password: 'sosecret',
    });
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await assertOk(bob, 'POST', `/api/groups/${groupId}/join-with-password`, {
        password: 'sosecret',
      });
      expect(res.group.members.some((m) => m.userId === USERS.bob.id)).toBe(true);
    } finally {
      await bob.dispose();
    }
  });

  test('private + wrong password → 403', async () => {
    const groupId = await createGroupAs(USERS.alice, {
      visibility: 'private',
      password: 'sosecret',
    });
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.post(`/api/groups/${groupId}/join-with-password`, {
        data: { password: 'wrong' },
      });
      // 403, NOT 401 — a 401 here would be treated by the frontend's
      // useRequest as an expired session and force-log-out the user.
      expect(res.status()).toBe(403);
      expect((await res.json()).error.message).toMatch(/incorrect password/i);
    } finally {
      await bob.dispose();
    }
  });

  test('private with no password set → 403', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.post(`/api/groups/${groupId}/join-with-password`, {
        data: { password: 'anything' },
      });
      expect(res.status()).toBe(403);
    } finally {
      await bob.dispose();
    }
  });

  test('public group rejects password-join → 403', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'public' });
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.post(`/api/groups/${groupId}/join-with-password`, {
        data: { password: 'anything' },
      });
      expect(res.status()).toBe(403);
    } finally {
      await bob.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/groups/${BOGUS_ID}/join-with-password`, {
      password: 'x',
    });
  });
});

test.describe('PUT /api/groups/:groupId/password', () => {
  test('owner sets a password → 200, hasPassword:true', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const alice = await apiLogin(USERS.alice);
    try {
      const res = await assertOk(alice, 'PUT', `/api/groups/${groupId}/password`, {
        password: 'rotated',
      });
      expect(res.hasPassword).toBe(true);
    } finally {
      await alice.dispose();
    }
  });

  test('owner clears the password (null) → 200, hasPassword:false', async () => {
    const groupId = await createGroupAs(USERS.alice, {
      visibility: 'private',
      password: 'starting',
    });
    const alice = await apiLogin(USERS.alice);
    try {
      const res = await assertOk(alice, 'PUT', `/api/groups/${groupId}/password`, {
        password: null,
      });
      expect(res.hasPassword).toBe(false);
    } finally {
      await alice.dispose();
    }
  });

  test('non-owner → 403', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const bob = await apiLogin(USERS.bob);
    try {
      // Use a 4+ char password so we hit the ownership check, not the
      // zod min(4) rule that would surface a 400 first.
      const res = await bob.put(`/api/groups/${groupId}/password`, {
        data: { password: 'try-this' },
      });
      expect(res.status()).toBe(403);
    } finally {
      await bob.dispose();
    }
  });

  test('non-private group → 400', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'public' });
    const alice = await apiLogin(USERS.alice);
    try {
      const res = await alice.put(`/api/groups/${groupId}/password`, {
        data: { password: 'longenough' },
      });
      expect(res.status()).toBe(400);
    } finally {
      await alice.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 19 Chunk 3 — Request-to-join lifecycle
// ---------------------------------------------------------------------------

test.describe('POST /api/groups/:groupId/join-request', () => {
  test('private group, no relation → 200 with request payload', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await assertOk(bob, 'POST', `/api/groups/${groupId}/join-request`, {
        message: 'lmk',
      });
      expect(res.request.groupId).toBe(groupId);
      expect(res.request.requesterId).toBe(USERS.bob.id);
      expect(res.request.message).toBe('lmk');
    } finally {
      await bob.dispose();
    }
  });

  test('public group rejects request-to-join → 400', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'public' });
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.post(`/api/groups/${groupId}/join-request`, { data: {} });
      expect(res.status()).toBe(400);
    } finally {
      await bob.dispose();
    }
  });

  test('secret group → 404 (no existence leak)', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'secret' });
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.post(`/api/groups/${groupId}/join-request`, { data: {} });
      expect(res.status()).toBe(404);
    } finally {
      await bob.dispose();
    }
  });

  // Phase 0 P0-9 — duplicate active request is now idempotent (returns the
  // existing row with alreadyExisted:true) instead of 400ing. Behavior
  // change from Tier 19 Chunk 3 → Phase 0; the rationale is in
  // CLAUDE.md's "Idempotent join request" invariant.
  test('duplicate active request → 200 idempotent, returns existing row', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const bob = await apiLogin(USERS.bob);
    try {
      const first = await assertOk(bob, 'POST', `/api/groups/${groupId}/join-request`, {
        message: 'first try',
      });
      const second = await assertOk(bob, 'POST', `/api/groups/${groupId}/join-request`, {
        message: 'second try',
      });
      // Route wraps the service return in { success, request }.
      expect(second.request.id).toBe(first.request.id);
      expect(second.request.alreadyExisted).toBe(true);
      // Stored message is the ORIGINAL — second call doesn't overwrite.
      expect(second.request.message).toBe('first try');
    } finally {
      await bob.dispose();
    }
  });
});

test.describe('GET /api/groups/:groupId/join-requests', () => {
  test('owner sees pending requests', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    // Bob requests
    const bob = await apiLogin(USERS.bob);
    try {
      await assertOk(bob, 'POST', `/api/groups/${groupId}/join-request`, { message: 'pls' });
    } finally {
      await bob.dispose();
    }
    // Alice (owner) lists
    const alice = await apiLogin(USERS.alice);
    try {
      const res = await assertOk(alice, 'GET', `/api/groups/${groupId}/join-requests`);
      expect(res.items.length).toBe(1);
      expect(res.items[0].requesterId).toBe(USERS.bob.id);
      expect(res.items[0].message).toBe('pls');
    } finally {
      await alice.dispose();
    }
  });

  test('non-owner → 403', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.get(`/api/groups/${groupId}/join-requests`);
      expect(res.status()).toBe(403);
    } finally {
      await bob.dispose();
    }
  });
});

test.describe('approve / decline / cancel join request', () => {
  test('owner approves → bob becomes a member, request row destroyed', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    // Bob requests
    let requestId;
    const bob = await apiLogin(USERS.bob);
    try {
      const created = await assertOk(bob, 'POST', `/api/groups/${groupId}/join-request`, {});
      requestId = created.request.id;
    } finally {
      await bob.dispose();
    }
    // Alice approves
    const alice = await apiLogin(USERS.alice);
    try {
      const res = await assertOk(
        alice,
        'POST',
        `/api/groups/${groupId}/join-requests/${requestId}/approve`,
        {},
      );
      expect(res.group.members.some((m) => m.userId === USERS.bob.id)).toBe(true);

      // Pending list now empty
      const list = await assertOk(alice, 'GET', `/api/groups/${groupId}/join-requests`);
      expect(list.items).toHaveLength(0);
    } finally {
      await alice.dispose();
    }
  });

  test('owner declines → request stays as declined (cooldown bookkeeping)', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    let requestId;
    const bob = await apiLogin(USERS.bob);
    try {
      const created = await assertOk(bob, 'POST', `/api/groups/${groupId}/join-request`, {});
      requestId = created.request.id;
    } finally {
      await bob.dispose();
    }
    const alice = await apiLogin(USERS.alice);
    try {
      await assertOk(
        alice,
        'POST',
        `/api/groups/${groupId}/join-requests/${requestId}/decline`,
        {},
      );
      // Active list is empty (only `declinedAt IS NULL` rows surface).
      const list = await assertOk(alice, 'GET', `/api/groups/${groupId}/join-requests`);
      expect(list.items).toHaveLength(0);
    } finally {
      await alice.dispose();
    }

    // Bob trying again within cooldown → 400 with cooldown code.
    const bob2 = await apiLogin(USERS.bob);
    try {
      const res = await bob2.post(`/api/groups/${groupId}/join-request`, { data: {} });
      expect(res.status()).toBe(400);
    } finally {
      await bob2.dispose();
    }
  });

  test('non-owner approve → 403', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    let requestId;
    const bob = await apiLogin(USERS.bob);
    try {
      const created = await assertOk(bob, 'POST', `/api/groups/${groupId}/join-request`, {});
      requestId = created.request.id;
      const res = await bob.post(`/api/groups/${groupId}/join-requests/${requestId}/approve`, {
        data: {},
      });
      expect(res.status()).toBe(403);
    } finally {
      await bob.dispose();
    }
  });

  test('requester cancels own request → 200, no cooldown applies', async () => {
    const groupId = await createGroupAs(USERS.alice, { visibility: 'private' });
    const bob = await apiLogin(USERS.bob);
    try {
      const created = await assertOk(bob, 'POST', `/api/groups/${groupId}/join-request`, {});
      const requestId = created.request.id;
      await assertOk(bob, 'DELETE', `/api/groups/${groupId}/join-requests/${requestId}`);
      // Re-request immediately works (no cooldown after self-cancel).
      const res = await assertOk(bob, 'POST', `/api/groups/${groupId}/join-request`, {});
      expect(res.request.requesterId).toBe(USERS.bob.id);
    } finally {
      await bob.dispose();
    }
  });
});
