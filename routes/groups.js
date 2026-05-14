'use strict';

// Tier 13 Chunk 1 — group routes extracted from server.js. /groups/discover
// MUST be declared before /groups/:groupId so Express doesn't treat
// "discover" as a path param (CLAUDE.md invariant).
//
// Tier 5.3 cascade contract: delete uses sequelize.transaction wrapping
// cascadeDeleteGroup; notify() fires OUTSIDE the transaction. Tier 5.2 cache:
// member-mutating endpoints invalidate `group:<id>` before responding.
const express = require('express');
const { Op } = require('sequelize');
const { validate } = require('../validation/middleware');
const {
  createGroupSchema,
  inviteSchema,
  transferOwnerSchema,
  visibilitySchema,
} = require('../validation/schemas');
const { authMiddleware } = require('../middleware/auth');
const { notify, evaluateBadges } = require('../lib/badges');
const { getUserById, getUserByUsername } = require('../lib/users');
const { getJoinedGroupIds, getGroupsForUser, getGroupById } = require('../lib/groups');
const { cascadeDeleteGroup } = require('../lib/cascade');
const leaderboardCache = require('../lib/leaderboardCache');
const { Group, GroupMember, GroupInvite, sequelize } = require('../models');

const router = express.Router();

router.get('/groups', authMiddleware, async (req, res) => {
  try {
    const groups = await getGroupsForUser(req.user.id);
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// MUST come before /groups/:groupId — CLAUDE.md invariant.
router.get('/groups/discover', authMiddleware, async (req, res) => {
  try {
    const joinedIds = await getJoinedGroupIds(req.user.id);
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
    res.json(
      publicGroups.map((g) => ({
        id: g.id,
        name: g.name,
        ownerId: g.ownerId,
        visibility: g.visibility,
        memberCount: countByGroup.get(g.id) || 0,
        createdAt: g.createdAt,
      })),
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch public groups' });
  }
});

router.get('/groups/:groupId', authMiddleware, async (req, res) => {
  try {
    const group = await getGroupById(req.params.groupId);
    if (!group || !group.members.some((m) => m.userId === req.user.id)) {
      return res.status(404).json({ error: 'Group not found or access denied' });
    }
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

router.post('/groups', authMiddleware, validate(createGroupSchema), async (req, res) => {
  const { name, visibility = 'private' } = req.body;

  try {
    const group = await Group.create({ name, ownerId: req.user.id, visibility });
    await GroupMember.create({ groupId: group.id, userId: req.user.id });
    const user = await getUserById(req.user.id);
    evaluateBadges(req.user.id, { groupCreated: true }).catch(() => {});
    res.json({
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      visibility: group.visibility,
      members: [{ userId: req.user.id, username: user.username }],
      invites: [],
      createdAt: group.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create group' });
  }
});

router.post('/groups/:groupId/invite', authMiddleware, validate(inviteSchema), async (req, res) => {
  const { username } = req.body;

  try {
    const group = await Group.findByPk(req.params.groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const isMember = await GroupMember.findOne({
      where: { groupId: req.params.groupId, userId: req.user.id },
    });
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const invitedUser = await getUserByUsername(username);
    if (!invitedUser) {
      return res.status(400).json({ error: 'No user found with that username' });
    }

    const isAlreadyMember = await GroupMember.findOne({
      where: { groupId: req.params.groupId, userId: invitedUser.id },
    });
    if (isAlreadyMember) {
      return res.status(400).json({ error: 'User is already a member of this group' });
    }

    const existingInvite = await GroupInvite.findOne({
      where: { groupId: req.params.groupId, username: invitedUser.username },
    });
    if (existingInvite) {
      return res.status(400).json({ error: 'User has already been invited to this group' });
    }

    await GroupInvite.create({ groupId: req.params.groupId, username: invitedUser.username });
    notify(
      invitedUser.id,
      'invite',
      `You were invited to "${group.name}"`,
      `Open the Groups tab to accept or decline.`,
    ).catch(() => {});
    const updatedGroup = await getGroupById(req.params.groupId);
    res.json({ success: true, group: updatedGroup });
  } catch (error) {
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

router.post('/groups/:groupId/invite/:inviteId/accept', authMiddleware, async (req, res) => {
  try {
    const invite = await GroupInvite.findByPk(req.params.inviteId);
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    const user = await getUserById(req.user.id);
    if (!user || user.username !== invite.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const group = await Group.findByPk(req.params.groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const isAlreadyMember = await GroupMember.findOne({
      where: { groupId: req.params.groupId, userId: req.user.id },
    });
    if (!isAlreadyMember) {
      await GroupMember.create({ groupId: req.params.groupId, userId: req.user.id });
    }

    await GroupInvite.destroy({ where: { id: req.params.inviteId } });
    if (group.ownerId && group.ownerId !== req.user.id) {
      notify(group.ownerId, 'group-join', `${user.username} joined "${group.name}"`).catch(
        () => {},
      );
    }
    leaderboardCache.invalidate(`group:${req.params.groupId}`);
    const updatedGroup = await getGroupById(req.params.groupId);
    res.json({ success: true, group: updatedGroup });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

router.post('/groups/:groupId/invite/:inviteId/decline', authMiddleware, async (req, res) => {
  try {
    const invite = await GroupInvite.findByPk(req.params.inviteId);
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    const user = await getUserById(req.user.id);
    if (!user || user.username !== invite.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await GroupInvite.destroy({ where: { id: req.params.inviteId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to decline invite' });
  }
});

router.post('/groups/:groupId/join', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.visibility !== 'public')
      return res.status(403).json({ error: 'This group is private' });

    const existing = await GroupMember.findOne({
      where: { groupId: group.id, userId: req.user.id },
    });
    if (existing) return res.status(400).json({ error: 'Already a member' });

    await GroupMember.create({ groupId: group.id, userId: req.user.id });
    leaderboardCache.invalidate(`group:${group.id}`);
    const joiner = await getUserById(req.user.id);
    if (group.ownerId !== req.user.id) {
      notify(group.ownerId, 'group-join', `${joiner.username} joined "${group.name}"`).catch(
        () => {},
      );
    }
    const updated = await getGroupById(group.id);
    res.json({ success: true, group: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join group' });
  }
});

router.post('/groups/:groupId/leave', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.ownerId === req.user.id) {
      return res.status(400).json({ error: 'Transfer ownership before leaving' });
    }
    const membership = await GroupMember.findOne({
      where: { groupId: group.id, userId: req.user.id },
    });
    if (!membership) return res.status(400).json({ error: 'Not a member of this group' });

    await membership.destroy();
    leaderboardCache.invalidate(`group:${group.id}`);
    const leaver = await getUserById(req.user.id);
    notify(group.ownerId, 'group-join', `${leaver.username} left "${group.name}"`).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave group' });
  }
});

router.post(
  '/groups/:groupId/transfer',
  authMiddleware,
  validate(transferOwnerSchema),
  async (req, res) => {
    try {
      const group = await Group.findByPk(req.params.groupId);
      if (!group) return res.status(404).json({ error: 'Group not found' });
      if (group.ownerId !== req.user.id)
        return res.status(403).json({ error: 'Only the owner can transfer ownership' });
      if (req.body.newOwnerId === req.user.id) {
        return res.status(400).json({ error: 'You are already the owner' });
      }
      const newOwnerMembership = await GroupMember.findOne({
        where: { groupId: group.id, userId: req.body.newOwnerId },
      });
      if (!newOwnerMembership)
        return res.status(400).json({ error: 'New owner must be a member of the group' });
      const newOwner = await getUserById(req.body.newOwnerId);
      if (!newOwner) return res.status(404).json({ error: 'New owner user not found' });

      group.ownerId = newOwner.id;
      await group.save();
      notify(newOwner.id, 'group-join', `You are now the owner of "${group.name}"`).catch(() => {});
      const updated = await getGroupById(group.id);
      res.json({ success: true, group: updated });
    } catch (error) {
      res.status(500).json({ error: 'Failed to transfer ownership' });
    }
  },
);

router.delete('/groups/:groupId', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.ownerId !== req.user.id)
      return res.status(403).json({ error: 'Only the owner can delete the group' });

    const members = await GroupMember.findAll({ where: { groupId: group.id } });
    const memberIds = members.map((m) => m.userId).filter((id) => id !== req.user.id);
    const groupName = group.name;

    await sequelize.transaction(async (t) => {
      await cascadeDeleteGroup(group, { transaction: t });
    });
    leaderboardCache.invalidate(`group:${group.id}`);

    for (const memberId of memberIds) {
      notify(memberId, 'group-join', `Group "${groupName}" was deleted by the owner`).catch(
        () => {},
      );
    }
    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, 'handler error');
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

router.post(
  '/groups/:groupId/visibility',
  authMiddleware,
  validate(visibilitySchema),
  async (req, res) => {
    try {
      const group = await Group.findByPk(req.params.groupId);
      if (!group) return res.status(404).json({ error: 'Group not found' });
      if (group.ownerId !== req.user.id)
        return res.status(403).json({ error: 'Only the owner can change visibility' });
      group.visibility = req.body.visibility;
      await group.save();
      res.json({ success: true, visibility: group.visibility });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update visibility' });
    }
  },
);

module.exports = router;
