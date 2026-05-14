'use strict';

// Tier 13 Chunk 1 — transactional cascade-delete helpers extracted from
// server.js. Each accepts a {transaction} option and forwards it to every
// internal destroy() (Tier 5.3 invariant). Callers wrap in
// `sequelize.transaction(async (t) => { await cascadeFn(x, {transaction:t}) })`.
//
// Bulk endpoints run ONE transaction per entity so a single bad row doesn't
// undo the rest. notify() calls fire OUTSIDE the transaction (see CLAUDE.md).
const { Op } = require('sequelize');
const { Group, Pick, Comment, Friendship, GroupMember, GroupInvite } = require('../models');

async function cascadeDeleteUser(target, { transaction } = {}) {
  const opts = transaction ? { transaction } : {};
  const ownedGroups = await Group.findAll({ where: { ownerId: target.id }, ...opts });
  const ownedGroupIds = ownedGroups.map((g) => g.id);
  if (ownedGroupIds.length > 0) {
    await GroupMember.destroy({ where: { groupId: ownedGroupIds }, ...opts });
    await GroupInvite.destroy({ where: { groupId: ownedGroupIds }, ...opts });
    await Group.destroy({ where: { id: ownedGroupIds }, ...opts });
  }
  await Pick.destroy({ where: { userId: target.id }, ...opts });
  await Comment.destroy({ where: { userId: target.id }, ...opts });
  await Friendship.destroy({
    where: { [Op.or]: [{ requesterId: target.id }, { addresseeId: target.id }] },
    ...opts,
  });
  await GroupMember.destroy({ where: { userId: target.id }, ...opts });
  await GroupInvite.destroy({ where: { username: target.username }, ...opts });
  await target.destroy(opts);
}

async function cascadeDeleteGame(game, { transaction } = {}) {
  const opts = transaction ? { transaction } : {};
  await Pick.destroy({ where: { gameId: game.id }, ...opts });
  await Comment.destroy({ where: { gameId: game.id }, ...opts });
  await game.destroy(opts);
}

async function cascadeDeleteGroup(group, { transaction } = {}) {
  const opts = transaction ? { transaction } : {};
  await GroupMember.destroy({ where: { groupId: group.id }, ...opts });
  await GroupInvite.destroy({ where: { groupId: group.id }, ...opts });
  await group.destroy(opts);
}

module.exports = { cascadeDeleteUser, cascadeDeleteGame, cascadeDeleteGroup };
