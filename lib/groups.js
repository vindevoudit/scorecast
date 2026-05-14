'use strict';

// Tier 13 Chunk 1 — group helpers extracted from server.js.
// getGroupsForUser returns shape {id, name, ownerId, visibility, members,
// invites, createdAt}; getGroupById omits `visibility` (Tier 5.7 invariant —
// preserved by several components that consume the helper).
const { User, Group, Pick, Game, GroupMember, GroupInvite } = require('../models');
const { scorePick } = require('./scoring');
const { getUserById } = require('./users');

async function getJoinedGroupIds(userId) {
  const memberships = await GroupMember.findAll({ where: { userId } });
  return memberships.map((m) => m.groupId);
}

async function getPendingInvites(userId) {
  const user = await getUserById(userId);
  if (!user) return [];

  const invites = await GroupInvite.findAll({ where: { username: user.username } });
  const groups = await Group.findAll({ where: { id: invites.map((i) => i.groupId) } });

  return invites.map((invite) => {
    const group = groups.find((g) => g.id === invite.groupId);
    return {
      id: invite.id,
      groupId: invite.groupId,
      groupName: group?.name || 'Unknown Group',
      createdAt: invite.createdAt,
    };
  });
}

async function getGroupsForUser(userId) {
  const memberships = await GroupMember.findAll({ where: { userId } });
  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length === 0) return [];
  const groups = await Group.findAll({ where: { id: groupIds } });

  const [allMembers, allInvites] = await Promise.all([
    GroupMember.findAll({ where: { groupId: groupIds }, include: [{ model: User }] }),
    GroupInvite.findAll({ where: { groupId: groupIds } }),
  ]);

  const membersByGroup = new Map();
  for (const m of allMembers) {
    if (!membersByGroup.has(m.groupId)) membersByGroup.set(m.groupId, []);
    membersByGroup.get(m.groupId).push({
      userId: m.userId,
      username: m.User?.username || 'Unknown',
    });
  }
  const invitesByGroup = new Map();
  for (const i of allInvites) {
    if (!invitesByGroup.has(i.groupId)) invitesByGroup.set(i.groupId, []);
    invitesByGroup.get(i.groupId).push({ username: i.username, createdAt: i.createdAt });
  }

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    visibility: group.visibility,
    members: membersByGroup.get(group.id) || [],
    invites: invitesByGroup.get(group.id) || [],
    createdAt: group.createdAt,
  }));
}

async function getGroupById(groupId) {
  const group = await Group.findByPk(groupId);
  if (!group) return null;

  const [members, invites] = await Promise.all([
    GroupMember.findAll({ where: { groupId }, include: [{ model: User }] }),
    GroupInvite.findAll({ where: { groupId } }),
  ]);

  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    members: members.map((m) => ({ userId: m.userId, username: m.User?.username || 'Unknown' })),
    invites: invites.map((i) => ({ username: i.username, createdAt: i.createdAt })),
    createdAt: group.createdAt,
  };
}

async function buildGroupLeaderboard(groupId) {
  const group = await Group.findByPk(groupId);
  if (!group) return [];

  const members = await GroupMember.findAll({ where: { groupId } });
  const memberIds = members.map((m) => m.userId);
  const memberUsers = await User.findAll({ where: { id: memberIds } });
  const picks = await Pick.findAll({ where: { userId: memberIds } });
  const games = await Game.findAll();
  const gameById = new Map(games.map((g) => [g.id, g]));

  return memberIds
    .map((memberId) => {
      const user = memberUsers.find((u) => u.id === memberId);
      const userPicks = picks.filter((pick) => pick.userId === memberId);
      let points = 0;
      let scored = 0;
      let won = 0;
      for (const pick of userPicks) {
        const game = gameById.get(pick.gameId);
        if (!game) continue;
        points += scorePick(pick, game);
        if (game.result) {
          scored += 1;
          if (pick.choice === game.result) won += 1;
        }
      }
      const winRate = scored > 0 ? won / scored : 0;
      return {
        userId: memberId,
        username: user?.username || 'Unknown',
        displayName: user?.displayName || null,
        points,
        winRate,
      };
    })
    .sort((a, b) => b.points - a.points);
}

module.exports = {
  getJoinedGroupIds,
  getPendingInvites,
  getGroupsForUser,
  getGroupById,
  buildGroupLeaderboard,
};
