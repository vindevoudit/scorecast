'use strict';

// Tier 5.5b — API + DB helpers for specs that need to set up state without
// driving the full UI. Two sets of exports:
//
//  - HTTP helpers (apiLogin, setGameResult, markAllNotificationsRead, ...)
//    use Playwright's request fixture against the live webServer. Cookies +
//    CSRF token are tracked automatically inside the returned context.
//
//  - DB helpers (resetUserLockout, insertPasswordResetToken, clearTables, ...)
//    reach into the same Postgres instance the server runs against via the
//    seeder's Sequelize connection. Use sparingly — when an equivalent
//    HTTP path exists, prefer the HTTP helper so the test still exercises
//    middleware (auth, CSRF, rate limit).

const crypto = require('crypto');
const { request: pwRequest } = require('@playwright/test');
const { BASE_URL } = require('../fixtures/env');

const CSRF_COOKIE = 'sc_csrf';
const CSRF_HEADER = 'X-CSRF-Token';

// --- HTTP helpers ------------------------------------------------------------

// Bare anonymous APIRequestContext for use cases that need to hit endpoints
// without any cookie/CSRF state — primarily the 401-when-unauthenticated
// boundary tests in tests/e2e/api/*.
async function apiAnon() {
  return pwRequest.newContext({ baseURL: BASE_URL });
}

// Clone an authed context's cookie state without the X-CSRF-Token default
// header. Use this to test the CSRF-rejected boundary on state-changing
// routes: the bare context still presents sc_access but is missing the
// double-submit header, so middleware/csrf.js returns 403.
async function stripCsrf(authed) {
  const state = await authed.storageState();
  return pwRequest.newContext({ baseURL: BASE_URL, storageState: state });
}

// Returns an authenticated APIRequestContext that already carries the auth
// cookies (sc_access/sc_refresh/sc_csrf) and defaults the X-CSRF-Token header
// for state-changing requests. Caller is responsible for `dispose()`.
async function apiLogin({ username, password }) {
  const bootstrap = await pwRequest.newContext({ baseURL: BASE_URL });
  const res = await bootstrap.post('/api/login', { data: { username, password } });
  if (!res.ok()) {
    const body = await res.text();
    await bootstrap.dispose();
    throw new Error(`apiLogin failed for ${username}: ${res.status()} ${body}`);
  }
  const state = await bootstrap.storageState();
  await bootstrap.dispose();
  const csrf = state.cookies.find((c) => c.name === CSRF_COOKIE)?.value;
  if (!csrf) {
    throw new Error(`apiLogin: no ${CSRF_COOKIE} cookie returned for ${username}`);
  }
  return pwRequest.newContext({
    baseURL: BASE_URL,
    storageState: state,
    extraHTTPHeaders: { [CSRF_HEADER]: csrf },
  });
}

async function setGameResult(authed, gameId, result) {
  const res = await authed.post(`/api/games/${gameId}/result`, { data: { result } });
  if (!res.ok()) throw new Error(`setGameResult ${gameId}: ${res.status()} ${await res.text()}`);
}

async function createPick(authed, gameId, choice) {
  const res = await authed.post('/api/picks', { data: { gameId, choice } });
  if (!res.ok()) throw new Error(`createPick ${gameId}: ${res.status()} ${await res.text()}`);
}

async function markAllNotificationsRead(authed) {
  const res = await authed.post('/api/notifications/read-all');
  if (!res.ok()) throw new Error(`markAllRead: ${res.status()} ${await res.text()}`);
}

async function getNotifications(authed, { unreadOnly = false } = {}) {
  const url = unreadOnly ? '/api/notifications?unreadOnly=true' : '/api/notifications';
  const res = await authed.get(url);
  if (!res.ok()) throw new Error(`getNotifications: ${res.status()} ${await res.text()}`);
  return res.json();
}

async function getLeaderboard(authed) {
  const res = await authed.get('/api/leaderboard');
  if (!res.ok()) throw new Error(`getLeaderboard: ${res.status()} ${await res.text()}`);
  return res.json();
}

// --- DB helpers --------------------------------------------------------------
//
// Lazy-load the seeder's models module — requiring it at the top of this file
// would force every spec that imports an HTTP helper to also pay the
// Sequelize startup cost. The lazy load also ensures DATABASE_URL/env is set
// (which fixtures/env.js handles) before models/index.js reads it.

let _models = null;
function getModels() {
  if (_models) return _models;
  // Match the seeder's env contract — fixtures/env.js sets DATABASE_URL when
  // required, but global-setup.js + seed.js also force NODE_ENV / LOG_LEVEL.
  require('../fixtures/env');
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  _models = require('../../../models');
  return _models;
}

async function resetUserLockout(username) {
  const { User } = getModels();
  const user = await User.findOne({ where: { username } });
  if (!user) throw new Error(`resetUserLockout: user ${username} not found`);
  user.loginAttempts = 0;
  user.lockedUntil = null;
  await user.save({ hooks: false });
}

// Inserts a fresh, unconsumed password-reset token for the user and returns
// the *raw* token string. Mirrors the production flow in routes/auth.js but
// lets the spec recover the raw token (which the real flow only emails out).
async function insertPasswordResetToken(username) {
  const { User, PasswordResetToken } = getModels();
  const user = await User.findOne({ where: { username } });
  if (!user) throw new Error(`insertPasswordResetToken: user ${username} not found`);
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  await PasswordResetToken.create({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
  return raw;
}

async function clearFriendships(userIds) {
  const { Friendship } = getModels();
  const { Op } = require('sequelize');
  await Friendship.destroy({
    where: {
      [Op.or]: [{ requesterId: userIds }, { addresseeId: userIds }],
    },
  });
}

async function clearPicksAndBadges(userIds) {
  const { Pick, Badge } = getModels();
  await Pick.destroy({ where: { userId: userIds } });
  await Badge.destroy({ where: { userId: userIds } });
}

async function clearGameResults(gameIds) {
  const { Game } = getModels();
  // Tier 4b Chunk 2 linked status to result: setResult flips both. The
  // reset must do the same or the games stay in `status: 'finished'` and
  // useGames buckets them as completed, hiding the pick button from any
  // later spec that needs to pick on them.
  await Game.update({ result: null, status: 'scheduled' }, { where: { id: gameIds } });
}

async function clearNotifications(userIds) {
  const { Notification } = getModels();
  await Notification.destroy({ where: { userId: userIds } });
}

// PWA Chunk 6 — wipe push_subscriptions + reset users.pushPreferences for
// the supplied user(s). Used by tests/e2e/api/push.spec.js to keep specs
// isolated when they create/delete subscriptions or flip prefs.
async function clearPushSubscriptions(userIds) {
  const { PushSubscription, User } = getModels();
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  await PushSubscription.destroy({ where: { userId: ids } });
  await User.update({ pushPreferences: {} }, { where: { id: ids }, hooks: false });
}

async function clearComments(gameId) {
  const { Comment } = getModels();
  await Comment.destroy({ where: { gameId } });
}

async function clearGroupsCreatedBy(userIds) {
  const { Group, GroupMember, GroupInvite } = getModels();
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const groups = await Group.findAll({ where: { ownerId: ids } });
  const groupIds = groups.map((g) => g.id);
  if (groupIds.length === 0) return;
  await GroupInvite.destroy({ where: { groupId: groupIds } });
  await GroupMember.destroy({ where: { groupId: groupIds } });
  await Group.destroy({ where: { id: groupIds } });
}

async function clearLeaguesByName(namePrefix) {
  const { League } = getModels();
  const { Op } = require('sequelize');
  await League.destroy({ where: { name: { [Op.like]: `${namePrefix}%` } } });
}

async function clearAuditLog() {
  const { AuditLog } = getModels();
  if (!AuditLog) return;
  await AuditLog.destroy({ truncate: true });
}

// Wipes a user by exact username — used to clean up users created by
// /api/register inside the auth boundary suite. Cascade-delete (migration
// 20260516000002) tears down their refresh tokens / verify tokens / etc.
async function deleteUserByUsername(username) {
  const { User } = getModels();
  const user = await User.findOne({ where: { username } });
  if (user) await user.destroy();
}

// Reset a user's TOTP fields so the 2FA-spec teardown leaves the seed user
// in its baseline state regardless of which step failed in the middle.
async function clear2faForUser(userId) {
  const { User } = getModels();
  await User.update(
    { totpSecret: null, totpEnabledAt: null, totpRecoveryCodes: null },
    { where: { id: userId }, hooks: false },
  );
}

// Force a user's password back to a known value (bcrypt-hashed via the model
// hook). Used by reset-password / change-password specs to restore the seed
// password after a test mutates it.
async function setUserPassword(userId, plainPassword) {
  const { User } = getModels();
  const user = await User.findByPk(userId);
  if (!user) throw new Error(`setUserPassword: user ${userId} not found`);
  user.password = plainPassword;
  await user.save();
}

// Generic update for spec teardown — patches a user row without re-running
// hooks. Use this to restore email / emailVerifiedAt / displayName / bio /
// profileVisibility after a test mutates them.
async function updateUserFields(userId, fields) {
  const { User } = getModels();
  await User.update(fields, { where: { id: userId }, hooks: false });
}

async function getUserId(username) {
  const { User } = getModels();
  const user = await User.findOne({ where: { username } });
  return user?.id || null;
}

// Tier 8.6 — flip a user's profileVisibility. Routed through PUT /api/me
// so the cache-invalidation side effect (LeaderboardService.invalidate)
// fires the same way the UI path does — otherwise tests that hit the
// leaderboard immediately after would observe stale cached rows for up to
// the 30 s TTL. Caller passes the USER fixture (with password) because
// PUT /api/me requires auth as the target user.
async function setProfileVisibility(user, visibility) {
  const authed = await apiLogin(user);
  try {
    const res = await authed.put('/api/me', { data: { profileVisibility: visibility } });
    if (!res.ok()) {
      throw new Error(`setProfileVisibility ${user.username}: ${res.status()} ${await res.text()}`);
    }
  } finally {
    await authed.dispose();
  }
}

// Tier 8.6 — bypass the friend-request → accept flow for tests that need
// two users to already be accepted friends. Mirrors what
// services/FriendService.acceptInvite would produce.
async function createAcceptedFriendship(userAId, userBId) {
  const { Friendship } = getModels();
  await Friendship.create({
    requesterId: userAId,
    addresseeId: userBId,
    status: 'accepted',
  });
}

// Tier 19 Chunk 2 — creates a pending friend-request row directly.
// Returns the new row's id so tests can assert friendshipId on the
// `pending-in` viewer's search results.
async function createPendingFriendship(requesterId, addresseeId) {
  const { Friendship } = getModels();
  const row = await Friendship.create({
    requesterId,
    addresseeId,
    status: 'pending',
  });
  return row.id;
}

async function closeDb() {
  if (_models) {
    await _models.sequelize.close();
    _models = null;
  }
}

module.exports = {
  // HTTP
  apiAnon,
  apiLogin,
  stripCsrf,
  setGameResult,
  createPick,
  markAllNotificationsRead,
  getNotifications,
  getLeaderboard,
  // DB
  resetUserLockout,
  insertPasswordResetToken,
  clearFriendships,
  createPendingFriendship,
  clearPicksAndBadges,
  clearGameResults,
  clearNotifications,
  clearPushSubscriptions,
  clearComments,
  clearGroupsCreatedBy,
  clearLeaguesByName,
  clearAuditLog,
  deleteUserByUsername,
  clear2faForUser,
  setUserPassword,
  updateUserFields,
  getUserId,
  setProfileVisibility,
  createAcceptedFriendship,
  closeDb,
};
