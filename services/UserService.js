'use strict';

// Tier 13 Chunk 2 — UserService. Owns the cascade delete for users (with
// the Tier 5.3 transaction wrap) plus admin user list / role flip / bulk
// ops. Auth-cookie lifecycle stays in lib/auth.js + AuthService.
const { Op } = require('sequelize');
const {
  User,
  Group,
  Pick,
  Comment,
  CommentReaction,
  Friendship,
  GroupMember,
  GroupInvite,
  Badge,
  Notification,
  EmailVerificationToken,
  PasswordResetToken,
  RefreshToken,
  sequelize,
} = require('../models');
const errors = require('../lib/errors');
const LeaderboardService = require('./LeaderboardService');

async function cascadeDelete(target, { transaction } = {}) {
  const opts = transaction ? { transaction } : {};

  // Owned groups: tear down their members + invites first.
  const ownedGroups = await Group.findAll({ where: { ownerId: target.id }, ...opts });
  const ownedGroupIds = ownedGroups.map((g) => g.id);
  if (ownedGroupIds.length > 0) {
    await GroupMember.destroy({ where: { groupId: ownedGroupIds }, ...opts });
    await GroupInvite.destroy({ where: { groupId: ownedGroupIds }, ...opts });
    await Group.destroy({ where: { id: ownedGroupIds }, ...opts });
  }

  // Reactions on the user's own comments must go before the comments
  // themselves (the comment_reactions → comments FK isn't cascading).
  const ownedComments = await Comment.findAll({
    where: { userId: target.id },
    attributes: ['id'],
    ...opts,
  });
  const ownedCommentIds = ownedComments.map((c) => c.id);
  if (ownedCommentIds.length > 0) {
    await CommentReaction.destroy({ where: { commentId: ownedCommentIds }, ...opts });
  }

  // The user's reactions on other people's comments.
  await CommentReaction.destroy({ where: { userId: target.id }, ...opts });

  await Pick.destroy({ where: { userId: target.id }, ...opts });
  await Comment.destroy({ where: { userId: target.id }, ...opts });
  await Friendship.destroy({
    where: { [Op.or]: [{ requesterId: target.id }, { addresseeId: target.id }] },
    ...opts,
  });
  await GroupMember.destroy({ where: { userId: target.id }, ...opts });
  await GroupInvite.destroy({ where: { username: target.username }, ...opts });

  // Tier 6 token tables + notifications + badges. These were created via
  // `sequelize.sync()` on the original deploy, so their FKs to users(id)
  // were never given ON DELETE CASCADE (the migrations declared it but
  // CREATE TABLE IF NOT EXISTS no-op'd against the synced tables). Until a
  // fix-up migration runs, we destroy these rows explicitly.
  await Notification.destroy({ where: { userId: target.id }, ...opts });
  await Badge.destroy({ where: { userId: target.id }, ...opts });
  await EmailVerificationToken.destroy({ where: { userId: target.id }, ...opts });
  await PasswordResetToken.destroy({ where: { userId: target.id }, ...opts });
  await RefreshToken.destroy({ where: { userId: target.id }, ...opts });

  await target.destroy(opts);
}

async function listAdminSummary() {
  const users = await User.findAll({ order: [['createdAt', 'ASC']] });
  const userIds = users.map((u) => u.id);
  const picks = await Pick.findAll({ where: { userId: userIds } });
  const memberships = await GroupMember.findAll({ where: { userId: userIds } });
  const picksByUser = new Map();
  for (const p of picks) picksByUser.set(p.userId, (picksByUser.get(p.userId) || 0) + 1);
  const groupsByUser = new Map();
  for (const m of memberships) groupsByUser.set(m.userId, (groupsByUser.get(m.userId) || 0) + 1);
  return users.map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
    picksCount: picksByUser.get(u.id) || 0,
    groupsCount: groupsByUser.get(u.id) || 0,
  }));
}

async function setRole({ targetId, requesterId, role }) {
  if (targetId === requesterId && role !== 'admin') {
    throw errors.badRequest('You cannot demote yourself');
  }
  const target = await User.findByPk(targetId);
  if (!target) throw errors.notFound('User not found');
  target.role = role;
  await target.save({ hooks: false });
  return target.role;
}

async function deleteUserById({ targetId, requesterId }) {
  if (targetId === requesterId) throw errors.badRequest('You cannot delete yourself');
  const target = await User.findByPk(targetId);
  if (!target) throw errors.notFound('User not found');
  await sequelize.transaction(async (t) => {
    await cascadeDelete(target, { transaction: t });
  });
  LeaderboardService.invalidate('all');
}

// Bulk admin user actions. CLAUDE.md invariant: the caller's own id is
// filtered and returned in `skipped:[{id,reason:'self'}]` rather than
// erroring the whole batch. Tier 5.3: one transaction per entity so a single
// bad row doesn't undo the rest.
async function bulkAction({ ids, action, requesterId }) {
  const skipped = [];
  const affected = [];
  const filteredIds = ids.filter((id) => {
    if (id === requesterId) {
      skipped.push({ id, reason: 'self' });
      return false;
    }
    return true;
  });
  const users = await User.findAll({ where: { id: filteredIds } });
  for (const target of users) {
    if (action === 'promote') {
      target.role = 'admin';
      await target.save({ hooks: false });
      affected.push(target.id);
    } else if (action === 'demote') {
      target.role = 'user';
      await target.save({ hooks: false });
      affected.push(target.id);
    } else if (action === 'delete') {
      await sequelize.transaction(async (t) => {
        await cascadeDelete(target, { transaction: t });
      });
      affected.push(target.id);
    }
  }
  if (affected.length > 0 && action === 'delete') LeaderboardService.invalidate('all');
  return { affected, skipped };
}

module.exports = {
  cascadeDelete,
  listAdminSummary,
  setRole,
  deleteUserById,
  bulkAction,
};
