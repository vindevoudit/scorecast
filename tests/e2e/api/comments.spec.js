'use strict';

// Per-endpoint boundary suite for routes/comments.js. Covers PUT/DELETE
// /api/comments/:id (owner-only; admin override for delete only) plus the
// reaction endpoints — POST /comments/:id/reactions and DELETE
// /comments/:id/reactions/:emoji.

const { test, expect } = require('@playwright/test');

const { USERS, GAMES } = require('../fixtures/data');
const { apiLogin, clearComments } = require('../helpers/api');
const {
  assertOk,
  assertUnauthorized,
  assertCsrfRejected,
  assertValidationError,
  assertNotFound,
} = require('../helpers/apiAssertions');

const BOGUS_ID = '99999999-0000-4000-8000-999999999999';

let aliceCommentId;

async function seedAliceComment() {
  const authed = await apiLogin(USERS.alice);
  try {
    const res = await authed.post(`/api/games/${GAMES.lions.id}/comments`, {
      data: { body: 'seed from comments.spec' },
    });
    const payload = await res.json();
    return payload.id;
  } finally {
    await authed.dispose();
  }
}

test.beforeEach(async () => {
  await clearComments(GAMES.lions.id);
  aliceCommentId = await seedAliceComment();
});

// ---------------------------------------------------------------------------
// PUT /api/comments/:id
// ---------------------------------------------------------------------------

test.describe('PUT /api/comments/:id', () => {
  test('happy path → 200 with updated row', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'PUT', `/api/comments/${aliceCommentId}`, {
        body: 'edited body',
      });
      expect(payload.body).toBe('edited body');
    } finally {
      await authed.dispose();
    }
  });

  test('not the owner (bob editing alice comment) → 403', async () => {
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.put(`/api/comments/${aliceCommentId}`, { data: { body: 'pwn' } });
      expect(res.status()).toBe(403);
    } finally {
      await bob.dispose();
    }
  });

  test('unknown id → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertNotFound(authed, 'PUT', `/api/comments/${BOGUS_ID}`, { body: 'whatever' });
    } finally {
      await authed.dispose();
    }
  });

  test('empty body → 400', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertValidationError(authed, 'PUT', `/api/comments/${aliceCommentId}`, { body: '' });
    } finally {
      await authed.dispose();
    }
  });

  // Tier 20 Chunk 2 — profanity rejection. The obscenity matcher is shared
  // across 6 free-text surfaces (username, displayName, bio, comment body,
  // group name, join-request message); covering one surface here is enough
  // to lock the wiring. The other two surfaces get their own boundary
  // tests in me.spec.js and groups.spec.js.
  test('profane body → 400 with rejection message', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const res = await authed.put(`/api/comments/${aliceCommentId}`, {
        data: { body: 'this is shit' },
      });
      expect(res.status()).toBe(400);
      const payload = await res.json();
      expect(payload.error).toMatch(/inappropriate language/i);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('PUT', `/api/comments/${aliceCommentId}`, { body: 'x' });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'PUT', `/api/comments/${aliceCommentId}`, { body: 'x' });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/comments/:id
// ---------------------------------------------------------------------------

test.describe('DELETE /api/comments/:id', () => {
  test('owner deletes own → 200', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      const payload = await assertOk(authed, 'DELETE', `/api/comments/${aliceCommentId}`);
      expect(payload.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test("admin deletes anyone's → 200 (admin override)", async () => {
    const admin = await apiLogin(USERS.admin);
    try {
      const payload = await assertOk(admin, 'DELETE', `/api/comments/${aliceCommentId}`);
      expect(payload.success).toBe(true);
    } finally {
      await admin.dispose();
    }
  });

  test('not the owner (bob) → 403', async () => {
    const bob = await apiLogin(USERS.bob);
    try {
      const res = await bob.delete(`/api/comments/${aliceCommentId}`);
      expect(res.status()).toBe(403);
    } finally {
      await bob.dispose();
    }
  });

  test('unknown id → 404', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertNotFound(authed, 'DELETE', `/api/comments/${BOGUS_ID}`);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('DELETE', `/api/comments/${aliceCommentId}`);
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.alice);
    try {
      await assertCsrfRejected(authed, 'DELETE', `/api/comments/${aliceCommentId}`);
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/comments/:id/reactions
// ---------------------------------------------------------------------------

test.describe('POST /api/comments/:id/reactions', () => {
  test('happy path (👍) → 200', async () => {
    const authed = await apiLogin(USERS.bob);
    try {
      const payload = await assertOk(authed, 'POST', `/api/comments/${aliceCommentId}/reactions`, {
        emoji: '👍',
      });
      expect(payload.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('disallowed emoji → 400', async () => {
    const authed = await apiLogin(USERS.bob);
    try {
      await assertValidationError(authed, 'POST', `/api/comments/${aliceCommentId}/reactions`, {
        emoji: '🥑',
      });
    } finally {
      await authed.dispose();
    }
  });

  test('unknown comment → 404', async () => {
    const authed = await apiLogin(USERS.bob);
    try {
      await assertNotFound(authed, 'POST', `/api/comments/${BOGUS_ID}/reactions`, { emoji: '👍' });
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    await assertUnauthorized('POST', `/api/comments/${aliceCommentId}/reactions`, {
      emoji: '👍',
    });
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.bob);
    try {
      await assertCsrfRejected(authed, 'POST', `/api/comments/${aliceCommentId}/reactions`, {
        emoji: '👍',
      });
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/comments/:id/reactions/:emoji
// ---------------------------------------------------------------------------

test.describe('DELETE /api/comments/:id/reactions/:emoji', () => {
  test('happy path → 200 (idempotent — unreact when none present is fine)', async () => {
    const authed = await apiLogin(USERS.bob);
    try {
      // First react, then unreact.
      await assertOk(authed, 'POST', `/api/comments/${aliceCommentId}/reactions`, {
        emoji: '👍',
      });
      const encoded = encodeURIComponent('👍');
      const payload = await assertOk(
        authed,
        'DELETE',
        `/api/comments/${aliceCommentId}/reactions/${encoded}`,
      );
      expect(payload.success).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('unknown emoji in URL → 400', async () => {
    const authed = await apiLogin(USERS.bob);
    try {
      const encoded = encodeURIComponent('🥑');
      const res = await authed.delete(`/api/comments/${aliceCommentId}/reactions/${encoded}`);
      expect(res.status()).toBe(400);
    } finally {
      await authed.dispose();
    }
  });

  test('no auth → 401', async () => {
    const encoded = encodeURIComponent('👍');
    await assertUnauthorized('DELETE', `/api/comments/${aliceCommentId}/reactions/${encoded}`);
  });

  test('no CSRF → 403', async () => {
    const authed = await apiLogin(USERS.bob);
    try {
      const encoded = encodeURIComponent('👍');
      await assertCsrfRejected(
        authed,
        'DELETE',
        `/api/comments/${aliceCommentId}/reactions/${encoded}`,
      );
    } finally {
      await authed.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 22 H3 — group-scoped comment edit/delete must re-check membership.
// Without this, a user who leaves a group can still PUT-rewrite or DELETE
// their own historical comments inside it (the create-side membership gate
// is bypassed because the row already exists).
// ---------------------------------------------------------------------------

test.describe('Tier 22 H3 — group-comment edit/delete checks current membership', () => {
  test('after leaving a group, PUT /api/comments/:id → 403', async () => {
    const owner = await apiLogin(USERS.alice);
    let groupId;
    let commentId;
    try {
      // Owner creates a public group, bob joins, bob comments.
      const grpRes = await owner.post('/api/groups', {
        data: { name: `tier22-h3-edit-${Date.now()}`, visibility: 'public' },
      });
      groupId = (await grpRes.json()).id;

      const bob = await apiLogin(USERS.bob);
      try {
        await assertOk(bob, 'POST', `/api/groups/${groupId}/join`);
        const cRes = await bob.post(`/api/groups/${groupId}/comments`, {
          data: { body: 'bob comment in group' },
        });
        commentId = (await cRes.json()).id;

        // Bob leaves the group.
        await assertOk(bob, 'POST', `/api/groups/${groupId}/leave`);

        // Bob tries to edit his old comment. Membership gate must reject.
        const editRes = await bob.put(`/api/comments/${commentId}`, {
          data: { body: 'rewritten after leaving' },
        });
        expect(editRes.status()).toBe(403);
      } finally {
        await bob.dispose();
      }
    } finally {
      // Cleanup: owner deletes the group.
      if (groupId) {
        await owner.delete(`/api/groups/${groupId}`).catch(() => {});
      }
      await owner.dispose();
    }
  });

  test('after leaving a group, DELETE /api/comments/:id → 403 (for non-admin)', async () => {
    const owner = await apiLogin(USERS.alice);
    let groupId;
    let commentId;
    try {
      const grpRes = await owner.post('/api/groups', {
        data: { name: `tier22-h3-delete-${Date.now()}`, visibility: 'public' },
      });
      groupId = (await grpRes.json()).id;

      const bob = await apiLogin(USERS.bob);
      try {
        await assertOk(bob, 'POST', `/api/groups/${groupId}/join`);
        const cRes = await bob.post(`/api/groups/${groupId}/comments`, {
          data: { body: 'bob to delete after leaving' },
        });
        commentId = (await cRes.json()).id;
        await assertOk(bob, 'POST', `/api/groups/${groupId}/leave`);

        const delRes = await bob.delete(`/api/comments/${commentId}`);
        expect(delRes.status()).toBe(403);
      } finally {
        await bob.dispose();
      }
    } finally {
      if (groupId) {
        await owner.delete(`/api/groups/${groupId}`).catch(() => {});
      }
      await owner.dispose();
    }
  });
});
