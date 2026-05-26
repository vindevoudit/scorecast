'use strict';

// Tier 13 Chunk 1 — friend routes extracted from server.js. Tier 6 rate-limit
// invariant preserved on /friends/request.
const express = require('express');
const { Op } = require('sequelize');
const { validate } = require('../validation/middleware');
const { friendRequestSchema } = require('../validation/schemas');
const { authMiddleware } = require('../middleware/auth');
const { friendRequestLimiter } = require('../middleware/rateLimit');
const { notify } = require('../services/NotificationService');
const { getUserById, getUserByUsername } = require('../lib/users');
const { getFriendshipBetween } = require('../lib/friends');
const { Friendship, User } = require('../models');

const router = express.Router();

router.post(
  '/friends/request',
  friendRequestLimiter,
  authMiddleware,
  validate(friendRequestSchema),
  async (req, res) => {
    try {
      const target = await getUserByUsername(req.body.username);
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (target.id === req.user.id)
        return res.status(400).json({ error: 'You cannot friend yourself' });

      const existing = await getFriendshipBetween(req.user.id, target.id);
      if (existing) {
        if (existing.status === 'accepted')
          return res.status(400).json({ error: 'Already friends' });
        return res.status(400).json({ error: 'Friend request already pending' });
      }

      const friendship = await Friendship.create({
        requesterId: req.user.id,
        addresseeId: target.id,
        status: 'pending',
      });
      const requester = await getUserById(req.user.id);
      notify(
        target.id,
        'friend-request',
        `${requester.username} sent you a friend request`,
        'Open Groups → Friends to accept or decline.',
        '/?view=groups',
      ).catch(() => {});
      res.json({ success: true, friendship });
    } catch (error) {
      res.status(500).json({ error: 'Failed to send friend request' });
    }
  },
);

router.post('/friends/:id/accept', authMiddleware, async (req, res) => {
  try {
    const friendship = await Friendship.findByPk(req.params.id);
    if (!friendship) return res.status(404).json({ error: 'Friend request not found' });
    if (friendship.addresseeId !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });
    if (friendship.status !== 'pending') return res.status(400).json({ error: 'Already accepted' });

    friendship.status = 'accepted';
    friendship.acceptedAt = new Date();
    await friendship.save();

    const accepter = await getUserById(req.user.id);
    notify(
      friendship.requesterId,
      'friend-request',
      `${accepter.username} accepted your friend request`,
      null,
      '/?view=groups',
    ).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

router.post('/friends/:id/decline', authMiddleware, async (req, res) => {
  try {
    const friendship = await Friendship.findByPk(req.params.id);
    if (!friendship) return res.status(404).json({ error: 'Friend request not found' });
    if (friendship.addresseeId !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });
    await friendship.destroy();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to decline friend request' });
  }
});

router.delete('/friends/:id', authMiddleware, async (req, res) => {
  try {
    const friendship = await Friendship.findByPk(req.params.id);
    if (!friendship) return res.status(404).json({ error: 'Friendship not found' });
    if (friendship.requesterId !== req.user.id && friendship.addresseeId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await friendship.destroy();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

router.get('/friends', authMiddleware, async (req, res) => {
  try {
    const rows = await Friendship.findAll({
      where: {
        [Op.or]: [{ requesterId: req.user.id }, { addresseeId: req.user.id }],
      },
    });
    const userIds = new Set();
    for (const row of rows) {
      userIds.add(row.requesterId);
      userIds.add(row.addresseeId);
    }
    const users = await User.findAll({ where: { id: [...userIds] } });
    const userById = new Map(users.map((u) => [u.id, u]));

    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const row of rows) {
      const otherId = row.requesterId === req.user.id ? row.addresseeId : row.requesterId;
      const other = userById.get(otherId);
      const entry = {
        id: row.id,
        userId: otherId,
        username: other?.username || 'Unknown',
        createdAt: row.createdAt,
      };
      if (row.status === 'accepted') friends.push(entry);
      else if (row.addresseeId === req.user.id) incoming.push(entry);
      else outgoing.push(entry);
    }
    res.json({ friends, incoming, outgoing });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

module.exports = router;
