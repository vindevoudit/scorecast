'use strict';

// Tier 13 Chunk 2 — GroupService. Owns group CRUD + member ops + cascade.
// Tier 5.3 invariant: deleteGroup wraps cascadeDelete in sequelize.transaction;
// notify() fires OUTSIDE the transaction. Tier 5.2: every member-mutating op
// invalidates the per-group leaderboard cache.
//
// Tier 19 Chunks 1+3 — three-tier visibility (public / private / secret):
//   - public  → free join via `joinPublic`.
//   - private → discoverable AND joinable via THREE paths: invite
//               (`acceptInvite`), password (`joinWithPassword`, if owner
//               set one), or request-to-join workflow (`requestToJoin` →
//               owner `approveJoinRequest`/`declineJoinRequest`). The
//               three paths coexist — owner picks the combo by setting
//               (or not setting) a password.
//   - secret  → hidden from search/discover. `getVisible` returns 404 to
//               non-members. Invite-only.
//
// Password is bcrypt-hashed (rounds 10, matching user-password pattern).
// `lib/auth.js`-style timing helpers aren't reused — bcrypt's own constant-
// time compare is enough for the password-join path's brute-force surface
// (rate-limited at the route level via `groupJoinPasswordLimiter`).
const bcrypt = require('bcryptjs');
const {
  Group,
  GroupMember,
  GroupInvite,
  GroupJoinRequest,
  Comment,
  CommentReaction,
  sequelize,
} = require('../models');
const { Op } = require('sequelize');
const errors = require('../lib/errors');
const { getUserById, getUserByUsername } = require('../lib/users');
const { getGroupById, getJoinedGroupIds } = require('../lib/groups');
const NotificationService = require('./NotificationService');
const BadgeService = require('./BadgeService');
const LeaderboardService = require('./LeaderboardService');

const BCRYPT_ROUNDS = 10;
// 24h cooldown between a decline and the next request-to-join attempt
// from the same user on the same group.
const JOIN_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Tier 22 M4 — cap on group membership. Without this the leaderboard cache
// per-group can grow unboundedly: a 10k-member group serializes 10k rows
// every time the cache rebuilds. The cap is loose enough to never bite a
// legitimate friend-group but tight enough that the leaderboard payload
// stays comfortably under ~50 KB. Bumping this requires re-thinking the
// leaderboard pagination path.
//
// MAX_GROUP_MEMBERS env override exists so operators can dial it down for a
// staging environment to exercise the cap without seeding 500 fake users.
// Default 500; clamps to [10, 5000] so a typo can't disable the limit or
// blow the cache.
const MAX_GROUP_MEMBERS = (() => {
  const raw = Number(process.env.MAX_GROUP_MEMBERS);
  if (!Number.isFinite(raw) || raw <= 0) return 500;
  return Math.max(10, Math.min(5000, Math.floor(raw)));
})();

async function assertCanAddMember(groupId) {
  const count = await GroupMember.count({ where: { groupId } });
  if (count >= MAX_GROUP_MEMBERS) {
    throw errors.badRequest(
      `Group has reached its member limit (${MAX_GROUP_MEMBERS}). Ask the owner to create a sibling group.`,
    );
  }
}

async function cascadeDelete(group, { transaction } = {}) {
  const opts = transaction ? { transaction } : {};
  // Tier 18 Chunk 5 — explicitly destroy group comments + their reactions
  // inside the transaction. The FK on comments declares ON DELETE CASCADE
  // (and CommentReaction → Comment is the same), so SQL alone would handle
  // it — but we follow the post-Tier-11 user-cascade pattern of explicit
  // dependency destroys to guard against any sync-vs-migration table
  // where the FK might have landed as NO ACTION.
  const groupComments = await Comment.findAll({
    where: { groupId: group.id },
    attributes: ['id'],
    ...opts,
  });
  if (groupComments.length > 0) {
    const commentIds = groupComments.map((c) => c.id);
    await CommentReaction.destroy({ where: { commentId: commentIds }, ...opts });
    await Comment.destroy({ where: { groupId: group.id }, ...opts });
  }
  await GroupMember.destroy({ where: { groupId: group.id }, ...opts });
  await GroupInvite.destroy({ where: { groupId: group.id }, ...opts });
  // Tier 19 Chunk 3 — pending join requests follow the group into the grave.
  // FK on group_join_requests declares ON DELETE CASCADE; explicit destroy
  // mirrors the GroupInvite pattern in case the FK landed as NO ACTION on
  // a sync-before-migration deploy.
  await GroupJoinRequest.destroy({ where: { groupId: group.id }, ...opts });
  await group.destroy(opts);
}

async function createGroup({ ownerId, name, visibility = 'secret', password = null }) {
  // Hash the password ONLY if the owner picked the private tier AND
  // supplied one. Schema validation already rejects password+non-private
  // combinations (refine in createGroupSchema), so we just trust the input.
  let passwordHash = null;
  if (visibility === 'private' && password) {
    passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  }
  const group = await Group.create({ name, ownerId, visibility, passwordHash });
  await GroupMember.create({ groupId: group.id, userId: ownerId });
  const user = await getUserById(ownerId);
  BadgeService.evaluateBadges(ownerId, { groupCreated: true }).catch(() => {});
  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    visibility: group.visibility,
    hasPassword: Boolean(passwordHash),
    members: [{ userId: ownerId, username: user.username }],
    invites: [],
    createdAt: group.createdAt,
  };
}

// Public-discovery panel. STRICTLY public groups; private groups are
// discoverable through the search endpoint with per-row CTAs instead, so
// keeping this surface narrow preserves the existing "browse all public
// groups" UX without confusing users with mixed-permission rows.
async function discoverPublic(viewerId) {
  const joinedIds = viewerId ? await getJoinedGroupIds(viewerId) : [];
  const publicGroups = await Group.findAll({
    where: {
      visibility: 'public',
      id: { [Op.notIn]: joinedIds.length ? joinedIds : ['00000000-0000-0000-0000-000000000000'] },
    },
    limit: 20,
    order: [['createdAt', 'DESC']],
  });
  const groupIds = publicGroups.map((g) => g.id);
  const members = await GroupMember.findAll({ where: { groupId: groupIds } });
  const countByGroup = new Map();
  for (const m of members) {
    countByGroup.set(m.groupId, (countByGroup.get(m.groupId) || 0) + 1);
  }
  return publicGroups.map((g) => ({
    id: g.id,
    name: g.name,
    ownerId: g.ownerId,
    visibility: g.visibility,
    memberCount: countByGroup.get(g.id) || 0,
    createdAt: g.createdAt,
  }));
}

async function getVisible(groupId, viewerId) {
  const group = await getGroupById(groupId);
  if (!group) throw errors.notFound('Group not found or access denied');

  // Anonymous browse mode: only public groups are visible. 404 (not 403)
  // so the existence of private/secret groups isn't leaked. Tier 8.6 —
  // member list is masked for any non-public member because anon viewers
  // are neither friends nor group-mates.
  if (!viewerId) {
    const raw = await Group.findByPk(groupId);
    if (!raw || raw.visibility !== 'public') {
      throw errors.notFound('Group not found or access denied');
    }
    return { ...group, members: maskMembersForAnon(group.members) };
  }

  const isMember = group.members.some((m) => m.userId === viewerId);
  if (isMember) {
    // Authed group members: no masking (Tier 8.6 same-group contract).
    // Reveal `hasPassword` so the owner UI can decide whether to render
    // "Change password" vs "Set password".
    const raw = await Group.findByPk(groupId);
    return { ...group, hasPassword: Boolean(raw?.passwordHash) };
  }

  // Non-member, authed. Tier 19: secret groups stay hidden (404). Private
  // groups return a STRIPPED metadata payload (no member list, no invite
  // list) so the user can see "this group exists, here's how to join" but
  // doesn't get any member-roster intel. Public falls through to the same
  // anon-masked shape for symmetry.
  const raw = await Group.findByPk(groupId);
  if (!raw) throw errors.notFound('Group not found or access denied');
  if (raw.visibility === 'secret') {
    throw errors.notFound('Group not found or access denied');
  }
  if (raw.visibility === 'private') {
    return {
      id: raw.id,
      name: raw.name,
      ownerId: raw.ownerId,
      visibility: raw.visibility,
      hasPassword: Boolean(raw.passwordHash),
      memberCount: group.members.length,
      members: [], // stripped for non-members
      invites: [],
      createdAt: raw.createdAt,
    };
  }
  // public: masked member list (same as anon).
  return { ...group, members: maskMembersForAnon(group.members) };
}

function maskMembersForAnon(members) {
  return members.map((m) => {
    if (m.profileVisibility === 'public') return m;
    const short = String(m.userId).replace(/-/g, '').slice(0, 4);
    return { userId: m.userId, username: `Player #${short}`, isMasked: true };
  });
}

async function invite({ groupId, inviterId, username }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');

  const isMember = await GroupMember.findOne({ where: { groupId, userId: inviterId } });
  if (!isMember) throw errors.forbidden();

  const invitedUser = await getUserByUsername(username);
  if (!invitedUser) throw errors.badRequest('No user found with that username');

  const isAlreadyMember = await GroupMember.findOne({
    where: { groupId, userId: invitedUser.id },
  });
  if (isAlreadyMember) throw errors.badRequest('User is already a member of this group');

  const existingInvite = await GroupInvite.findOne({
    where: { groupId, username: invitedUser.username },
  });
  if (existingInvite) throw errors.badRequest('User has already been invited to this group');

  await GroupInvite.create({ groupId, username: invitedUser.username });
  NotificationService.notify(
    invitedUser.id,
    'invite',
    `You were invited to "${group.name}"`,
    'Open the Groups tab to accept or decline.',
    `/?view=groups&groupId=${groupId}`,
  ).catch(() => {});
  return getGroupById(groupId);
}

async function acceptInvite({ groupId, inviteId, userId }) {
  const invite = await GroupInvite.findByPk(inviteId);
  if (!invite) throw errors.notFound('Invite not found');

  const user = await getUserById(userId);
  if (!user || user.username !== invite.username) throw errors.forbidden();

  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');

  const isAlreadyMember = await GroupMember.findOne({ where: { groupId, userId } });
  if (!isAlreadyMember) {
    await assertCanAddMember(groupId);
    await GroupMember.create({ groupId, userId });
  }

  await GroupInvite.destroy({ where: { id: inviteId } });
  if (group.ownerId && group.ownerId !== userId) {
    NotificationService.notify(
      group.ownerId,
      'group-join',
      `${user.username} joined "${group.name}"`,
      null,
      `/?view=groups&groupId=${groupId}`,
    ).catch(() => {});
  }
  LeaderboardService.invalidatePrefix(`group:${groupId}`);
  return getGroupById(groupId);
}

async function declineInvite({ inviteId, userId }) {
  const invite = await GroupInvite.findByPk(inviteId);
  if (!invite) throw errors.notFound('Invite not found');

  const user = await getUserById(userId);
  if (!user || user.username !== invite.username) throw errors.forbidden();

  await GroupInvite.destroy({ where: { id: inviteId } });
}

async function joinPublic({ groupId, userId }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.visibility !== 'public') {
    // Tier 19 — non-public groups now have their own join paths. Surface
    // a clear, type-specific 403 so the frontend can route to the right
    // dialog (password / request-to-join) instead of a generic "private".
    if (group.visibility === 'private') {
      throw errors.forbidden('This group requires a password or an approved join request');
    }
    throw errors.forbidden('This group is invite-only');
  }

  const existing = await GroupMember.findOne({ where: { groupId, userId } });
  if (existing) throw errors.badRequest('Already a member');
  await assertCanAddMember(groupId);

  await GroupMember.create({ groupId, userId });
  LeaderboardService.invalidatePrefix(`group:${groupId}`);
  const joiner = await getUserById(userId);
  if (group.ownerId !== userId) {
    NotificationService.notify(
      group.ownerId,
      'group-join',
      `${joiner.username} joined "${group.name}"`,
      null,
      `/?view=groups&groupId=${groupId}`,
    ).catch(() => {});
  }
  return getGroupById(groupId);
}

// Tier 19 Chunk 1 — password path into a private group. The owner's
// bcrypt hash lives on the row; we constant-time compare here (bcrypt
// is constant-time itself), and rate-limit at the route level to deter
// brute force. Pending join-requests (if any) are destroyed so the user
// doesn't appear in the owner's pending list after joining out-of-band.
async function joinWithPassword({ groupId, userId, password }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.visibility !== 'private') {
    throw errors.forbidden('This group does not accept password joins');
  }
  if (!group.passwordHash) {
    throw errors.forbidden('This group has no password set');
  }

  const existing = await GroupMember.findOne({ where: { groupId, userId } });
  if (existing) throw errors.badRequest('Already a member');

  const ok = await bcrypt.compare(password, group.passwordHash);
  if (!ok) throw errors.unauthorized('Incorrect password');

  await assertCanAddMember(groupId);
  await GroupMember.create({ groupId, userId });
  // Sweep any stale pending request from the same user — no point keeping
  // it once they're already in via the password path.
  await GroupJoinRequest.destroy({ where: { groupId, requesterId: userId } });
  LeaderboardService.invalidatePrefix(`group:${groupId}`);

  const joiner = await getUserById(userId);
  if (group.ownerId !== userId) {
    NotificationService.notify(
      group.ownerId,
      'group-join',
      `${joiner.username} joined "${group.name}"`,
      null,
      `/?view=groups&groupId=${groupId}`,
    ).catch(() => {});
  }
  return getGroupById(groupId);
}

// Tier 19 Chunk 1 — owner-only password setter / clearer.
// `password = null` clears (group reverts to request-to-join + invite only).
// Only valid for private groups; trying to set a password on public or
// secret throws so the frontend doesn't accidentally orphan the password.
async function setPassword({ groupId, requesterId, password }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.ownerId !== requesterId) {
    throw errors.forbidden('Only the owner can set the group password');
  }
  if (group.visibility !== 'private') {
    throw errors.badRequest('Passwords are only allowed on private groups');
  }
  group.passwordHash = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : null;
  await group.save();
  return { hasPassword: Boolean(group.passwordHash) };
}

// Tier 19 Chunk 3 — request-to-join lifecycle.
async function requestToJoin({ groupId, requesterId, message }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.visibility === 'public') {
    throw errors.badRequest('Public groups can be joined directly');
  }
  if (group.visibility === 'secret') {
    // Don't leak that the group exists.
    throw errors.notFound('Group not found or access denied');
  }
  if (group.ownerId === requesterId) {
    throw errors.badRequest('You already own this group');
  }
  const isMember = await GroupMember.findOne({ where: { groupId, userId: requesterId } });
  if (isMember) throw errors.badRequest('Already a member');

  // Active request? Partial-unique index will catch duplicates; checking
  // here gives a friendlier 400 instead of the constraint error surface.
  const active = await GroupJoinRequest.findOne({
    where: { groupId, requesterId, declinedAt: null },
  });
  if (active) throw errors.badRequest('You already have a pending request for this group');

  // Cooldown — most-recent decline must be ≥ 24h ago.
  const recentDecline = await GroupJoinRequest.findOne({
    where: {
      groupId,
      requesterId,
      declinedAt: { [Op.ne]: null, [Op.gte]: new Date(Date.now() - JOIN_REQUEST_COOLDOWN_MS) },
    },
    order: [['declinedAt', 'DESC']],
  });
  if (recentDecline) {
    const unlockAt = new Date(recentDecline.declinedAt.getTime() + JOIN_REQUEST_COOLDOWN_MS);
    const err = errors.badRequest(
      `Please wait until ${unlockAt.toISOString()} before requesting again`,
    );
    err.code = 'join_request_cooldown';
    err.unlockAt = unlockAt.toISOString();
    throw err;
  }

  const row = await GroupJoinRequest.create({
    groupId,
    requesterId,
    message: message ? message.trim().slice(0, 160) : null,
  });

  const requester = await getUserById(requesterId);
  NotificationService.notify(
    group.ownerId,
    'join-request',
    `${requester.username} requested to join "${group.name}"`,
    message ? message.trim().slice(0, 160) : null,
    `/?view=groups&groupId=${groupId}`,
  ).catch(() => {});

  return {
    id: row.id,
    groupId: row.groupId,
    requesterId: row.requesterId,
    message: row.message,
    createdAt: row.createdAt,
  };
}

async function listJoinRequests({ groupId, requesterId }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.ownerId !== requesterId) {
    throw errors.forbidden('Only the owner can see join requests');
  }
  const rows = await GroupJoinRequest.findAll({
    where: { groupId, declinedAt: null },
    order: [['createdAt', 'ASC']],
  });
  // Hydrate requester display info for the owner UI.
  const out = [];
  for (const row of rows) {
    const requester = await getUserById(row.requesterId).catch(() => null);
    if (!requester) continue;
    out.push({
      id: row.id,
      requesterId: row.requesterId,
      username: requester.username,
      displayName: requester.displayName || null,
      message: row.message,
      createdAt: row.createdAt,
    });
  }
  return out;
}

async function approveJoinRequest({ groupId, requestId, ownerId }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.ownerId !== ownerId) {
    throw errors.forbidden('Only the owner can approve join requests');
  }
  const request = await GroupJoinRequest.findOne({
    where: { id: requestId, groupId, declinedAt: null },
  });
  if (!request) throw errors.notFound('Join request not found');

  const existing = await GroupMember.findOne({
    where: { groupId, userId: request.requesterId },
  });
  if (!existing) {
    await assertCanAddMember(groupId);
    await GroupMember.create({ groupId, userId: request.requesterId });
  }
  // Approve == destroy (no cooldown after a positive resolution).
  await request.destroy();
  LeaderboardService.invalidatePrefix(`group:${groupId}`);

  NotificationService.notify(
    request.requesterId,
    'join-request-approved',
    `Your request to join "${group.name}" was approved`,
    null,
    `/?view=groups&groupId=${groupId}`,
  ).catch(() => {});
  return getGroupById(groupId);
}

async function declineJoinRequest({ groupId, requestId, ownerId }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.ownerId !== ownerId) {
    throw errors.forbidden('Only the owner can decline join requests');
  }
  const request = await GroupJoinRequest.findOne({
    where: { id: requestId, groupId, declinedAt: null },
  });
  if (!request) throw errors.notFound('Join request not found');

  request.declinedAt = new Date();
  await request.save();

  NotificationService.notify(
    request.requesterId,
    'join-request-declined',
    `Your request to join "${group.name}" was declined`,
    null,
    `/?view=groups&groupId=${groupId}`,
  ).catch(() => {});
}

async function cancelJoinRequest({ groupId, requestId, requesterId }) {
  const request = await GroupJoinRequest.findOne({
    where: { id: requestId, groupId, requesterId, declinedAt: null },
  });
  if (!request) throw errors.notFound('Join request not found');
  // Self-cancel — no cooldown, no notify.
  await request.destroy();
}

async function leave({ groupId, userId }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.ownerId === userId) throw errors.badRequest('Transfer ownership before leaving');

  const membership = await GroupMember.findOne({ where: { groupId, userId } });
  if (!membership) throw errors.badRequest('Not a member of this group');

  await membership.destroy();
  LeaderboardService.invalidatePrefix(`group:${groupId}`);
  const leaver = await getUserById(userId);
  NotificationService.notify(
    group.ownerId,
    'group-join',
    `${leaver.username} left "${group.name}"`,
    null,
    `/?view=groups&groupId=${groupId}`,
  ).catch(() => {});
}

async function transferOwnership({ groupId, currentOwnerId, newOwnerId }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.ownerId !== currentOwnerId)
    throw errors.forbidden('Only the owner can transfer ownership');
  if (newOwnerId === currentOwnerId) throw errors.badRequest('You are already the owner');

  const newOwnerMembership = await GroupMember.findOne({
    where: { groupId, userId: newOwnerId },
  });
  if (!newOwnerMembership) throw errors.badRequest('New owner must be a member of the group');
  const newOwner = await getUserById(newOwnerId);
  if (!newOwner) throw errors.notFound('New owner user not found');

  group.ownerId = newOwner.id;
  await group.save();
  NotificationService.notify(
    newOwner.id,
    'group-join',
    `You are now the owner of "${group.name}"`,
    null,
    `/?view=groups&groupId=${groupId}`,
  ).catch(() => {});
  return getGroupById(groupId);
}

async function deleteGroup({ groupId, requesterId }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.ownerId !== requesterId) throw errors.forbidden('Only the owner can delete the group');

  const members = await GroupMember.findAll({ where: { groupId } });
  const memberIds = members.map((m) => m.userId).filter((id) => id !== requesterId);
  const groupName = group.name;

  await sequelize.transaction(async (t) => {
    await cascadeDelete(group, { transaction: t });
  });
  LeaderboardService.invalidatePrefix(`group:${groupId}`);

  for (const memberId of memberIds) {
    // Group is gone; deep-link to the groups tab only (no groupId).
    NotificationService.notify(
      memberId,
      'group-join',
      `Group "${groupName}" was deleted by the owner`,
      null,
      '/?view=groups',
    ).catch(() => {});
  }
}

// Tier 19 — visibility flip now spans 3 values. When leaving 'private',
// null out the password hash so a future flip back to 'private' starts
// from a clean slate (preventing surprise auto-restoration of an old
// password). When entering 'private' with a password param, set the hash
// in the same save.
async function setVisibility({ groupId, requesterId, visibility, password = null }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.ownerId !== requesterId) throw errors.forbidden('Only the owner can change visibility');

  const wasPrivate = group.visibility === 'private';
  group.visibility = visibility;
  if (visibility === 'private') {
    if (password) {
      group.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    }
    // If transitioning into private without a password, leave whatever
    // hash exists (NULL means "request-to-join + invite only").
  } else if (wasPrivate) {
    // Leaving private — drop any stored password hash.
    group.passwordHash = null;
  }
  await group.save();
  return { visibility: group.visibility, hasPassword: Boolean(group.passwordHash) };
}

module.exports = {
  cascadeDelete,
  createGroup,
  discoverPublic,
  getVisible,
  invite,
  acceptInvite,
  declineInvite,
  joinPublic,
  joinWithPassword,
  setPassword,
  requestToJoin,
  listJoinRequests,
  approveJoinRequest,
  declineJoinRequest,
  cancelJoinRequest,
  leave,
  transferOwnership,
  deleteGroup,
  setVisibility,
};
