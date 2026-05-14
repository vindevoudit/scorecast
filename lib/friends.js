'use strict';

// Tier 13 Chunk 1 — friendship helpers extracted from server.js.
const { Op } = require('sequelize');
const { Friendship } = require('../models');

async function getFriendshipBetween(userAId, userBId) {
  if (!userAId || !userBId || userAId === userBId) return null;
  return Friendship.findOne({
    where: {
      [Op.or]: [
        { requesterId: userAId, addresseeId: userBId },
        { requesterId: userBId, addresseeId: userAId },
      ],
    },
  });
}

function friendStatusFrom(friendship, viewerId, targetId) {
  if (viewerId === targetId) return 'self';
  if (!friendship) return 'none';
  if (friendship.status === 'accepted') return 'friends';
  if (friendship.requesterId === viewerId) return 'pending-out';
  return 'pending-in';
}

module.exports = { getFriendshipBetween, friendStatusFrom };
