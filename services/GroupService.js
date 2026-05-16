'use strict';

// Tier 13 Chunk 2 — GroupService. Owns group CRUD + member ops + cascade.
// Tier 5.3 invariant: deleteGroup wraps cascadeDelete in sequelize.transaction;
// notify() fires OUTSIDE the transaction. Tier 5.2: every member-mutating op
// invalidates the per-group leaderboard cache.
const { Group, GroupMember, GroupInvite, sequelize } = require('../models');
const { Op } = require('sequelize');
const errors = require('../lib/errors');
const { getUserById, getUserByUsername } = require('../lib/users');
const { getGroupById, getJoinedGroupIds } = require('../lib/groups');
const NotificationService = require('./NotificationService');
const BadgeService = require('./BadgeService');
const LeaderboardService = require('./LeaderboardService');

async function cascadeDelete(group, { transaction } = {}) {
  const opts = transaction ? { transaction } : {};
  await GroupMember.destroy({ where: { groupId: group.id }, ...opts });
  await GroupInvite.destroy({ where: { groupId: group.id }, ...opts });
  await group.destroy(opts);
}

async function createGroup({ ownerId, name, visibility = 'private' }) {
  const group = await Group.create({ name, ownerId, visibility });
  await GroupMember.create({ groupId: group.id, userId: ownerId });
  const user = await getUserById(ownerId);
  BadgeService.evaluateBadges(ownerId, { groupCreated: true }).catch(() => {});
  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    visibility: group.visibility,
    members: [{ userId: ownerId, username: user.username }],
    invites: [],
    createdAt: group.createdAt,
  };
}

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

  // Anonymous browse mode: only public groups are visible. Return 404 (not
  // 403) so the existence of private groups isn't leaked.
  if (!viewerId) {
    const raw = await Group.findByPk(groupId);
    if (!raw || raw.visibility !== 'public') {
      throw errors.notFound('Group not found or access denied');
    }
    return group;
  }

  if (!group.members.some((m) => m.userId === viewerId)) {
    throw errors.notFound('Group not found or access denied');
  }
  return group;
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
    await GroupMember.create({ groupId, userId });
  }

  await GroupInvite.destroy({ where: { id: inviteId } });
  if (group.ownerId && group.ownerId !== userId) {
    NotificationService.notify(
      group.ownerId,
      'group-join',
      `${user.username} joined "${group.name}"`,
    ).catch(() => {});
  }
  LeaderboardService.invalidate(`group:${groupId}`);
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
  if (group.visibility !== 'public') throw errors.forbidden('This group is private');

  const existing = await GroupMember.findOne({ where: { groupId, userId } });
  if (existing) throw errors.badRequest('Already a member');

  await GroupMember.create({ groupId, userId });
  LeaderboardService.invalidate(`group:${groupId}`);
  const joiner = await getUserById(userId);
  if (group.ownerId !== userId) {
    NotificationService.notify(
      group.ownerId,
      'group-join',
      `${joiner.username} joined "${group.name}"`,
    ).catch(() => {});
  }
  return getGroupById(groupId);
}

async function leave({ groupId, userId }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.ownerId === userId) throw errors.badRequest('Transfer ownership before leaving');

  const membership = await GroupMember.findOne({ where: { groupId, userId } });
  if (!membership) throw errors.badRequest('Not a member of this group');

  await membership.destroy();
  LeaderboardService.invalidate(`group:${groupId}`);
  const leaver = await getUserById(userId);
  NotificationService.notify(
    group.ownerId,
    'group-join',
    `${leaver.username} left "${group.name}"`,
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
  LeaderboardService.invalidate(`group:${groupId}`);

  for (const memberId of memberIds) {
    NotificationService.notify(
      memberId,
      'group-join',
      `Group "${groupName}" was deleted by the owner`,
    ).catch(() => {});
  }
}

async function setVisibility({ groupId, requesterId, visibility }) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.ownerId !== requesterId) throw errors.forbidden('Only the owner can change visibility');
  group.visibility = visibility;
  await group.save();
  return group.visibility;
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
  leave,
  transferOwnership,
  deleteGroup,
  setVisibility,
};
