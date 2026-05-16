'use strict';

// Tier 8.6 — profile-privacy invariants.
//
// Verifies the visibility gate (UserService.getProfileByUsername) + the
// leaderboard masking layer (LeaderboardService.applyMasking) across the
// five invariants called out in the plan:
//   1. friends-only profile from non-friend → 404
//   2. friends-only profile from accepted friend → full payload
//   3. private profile from non-admin → 404
//   4. private profile from admin → full payload
//   5. leaderboard rows masked for non-friend non-admin viewer
//
// Reset profileVisibility to 'public' between tests so ordering across
// this file doesn't matter and parallel runs leave seeded users tidy.
// CLAUDE.md invariant: don't call closeDb in afterAll — workers:1 shares
// the Sequelize pool with sibling specs.

const { test, expect } = require('@playwright/test');
const {
  apiLogin,
  setProfileVisibility,
  createAcceptedFriendship,
  clearFriendships,
  getUserId,
} = require('./helpers/api');
const { USERS } = require('./fixtures/data');

let aliceId;
let bobId;
let adminId;

test.beforeAll(async () => {
  aliceId = await getUserId(USERS.alice.username);
  bobId = await getUserId(USERS.bob.username);
  adminId = await getUserId(USERS.admin.username);
  if (!aliceId || !bobId || !adminId) {
    throw new Error('profile-privacy: seeded e2e users missing');
  }
});

test.beforeEach(async () => {
  await setProfileVisibility(USERS.alice, 'public');
  await setProfileVisibility(USERS.bob, 'public');
  await clearFriendships([aliceId, bobId]);
});

test.afterAll(async () => {
  await setProfileVisibility(USERS.alice, 'public');
  await setProfileVisibility(USERS.bob, 'public');
  await clearFriendships([aliceId, bobId]);
});

test('friends-only profile: non-friend gets 404, friend gets full payload', async () => {
  await setProfileVisibility(USERS.alice, 'friends');

  // Phase 1 — bob is not yet a friend → 404 (same shape as "not found"
  // so the friend graph can't be probed via response codes).
  const bobUnfriended = await apiLogin(USERS.bob);
  const resDenied = await bobUnfriended.get(`/api/users/${USERS.alice.username}/profile`);
  expect(resDenied.status()).toBe(404);
  await bobUnfriended.dispose();

  // Phase 2 — bob is now an accepted friend → full payload.
  await createAcceptedFriendship(aliceId, bobId);
  const bobFriended = await apiLogin(USERS.bob);
  const resAllowed = await bobFriended.get(`/api/users/${USERS.alice.username}/profile`);
  expect(resAllowed.status()).toBe(200);
  const body = await resAllowed.json();
  expect(body.username).toBe(USERS.alice.username);
  expect(body.profileVisibility).toBe('friends');
  expect(body.friendStatus).toBe('friends');
  await bobFriended.dispose();
});

test('private profile: non-admin gets 404, admin sees full payload', async () => {
  await setProfileVisibility(USERS.alice, 'private');

  const bob = await apiLogin(USERS.bob);
  const resBob = await bob.get(`/api/users/${USERS.alice.username}/profile`);
  expect(resBob.status()).toBe(404);
  await bob.dispose();

  const admin = await apiLogin(USERS.admin);
  const resAdmin = await admin.get(`/api/users/${USERS.alice.username}/profile`);
  expect(resAdmin.status()).toBe(200);
  const adminBody = await resAdmin.json();
  expect(adminBody.username).toBe(USERS.alice.username);
  expect(adminBody.profileVisibility).toBe('private');
  await admin.dispose();
});

test('self always sees own profile regardless of visibility', async () => {
  await setProfileVisibility(USERS.alice, 'private');
  const alice = await apiLogin(USERS.alice);
  const res = await alice.get(`/api/users/${USERS.alice.username}/profile`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.username).toBe(USERS.alice.username);
  expect(body.profileVisibility).toBe('private');
  await alice.dispose();
});

test('leaderboard masks non-public rows for non-friend non-admin viewer', async () => {
  await setProfileVisibility(USERS.alice, 'private');

  // bob is neither admin nor friend → alice's row should be masked.
  const bob = await apiLogin(USERS.bob);
  const resBob = await bob.get('/api/leaderboard');
  expect(resBob.ok()).toBeTruthy();
  const bobBody = await resBob.json();
  const aliceForBob = bobBody.overall.find((r) => r.userId === aliceId);
  expect(aliceForBob).toBeTruthy();
  expect(aliceForBob.isMasked).toBe(true);
  expect(aliceForBob.username).not.toBe(USERS.alice.username);
  await bob.dispose();

  // admin → unmasked.
  const admin = await apiLogin(USERS.admin);
  const resAdmin = await admin.get('/api/leaderboard');
  const adminBody = await resAdmin.json();
  const aliceForAdmin = adminBody.overall.find((r) => r.userId === aliceId);
  expect(aliceForAdmin.isMasked).toBeFalsy();
  expect(aliceForAdmin.username).toBe(USERS.alice.username);
  await admin.dispose();
});

test('leaderboard does NOT mask a friends-only user for their accepted friend', async () => {
  await setProfileVisibility(USERS.alice, 'friends');
  await createAcceptedFriendship(aliceId, bobId);

  const bob = await apiLogin(USERS.bob);
  const res = await bob.get('/api/leaderboard');
  const body = await res.json();
  const aliceRow = body.overall.find((r) => r.userId === aliceId);
  expect(aliceRow.isMasked).toBeFalsy();
  expect(aliceRow.username).toBe(USERS.alice.username);
  await bob.dispose();
});
