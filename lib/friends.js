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

// Tier 8.6 — returns the set of user ids the viewer is accepted friends
// with. Used by the leaderboard masking layer (avoids a per-row friend
// check). One query per request; null viewer → empty set.
async function getViewerFriendIdSet(viewerId) {
  if (!viewerId) return new Set();
  const rows = await Friendship.findAll({
    where: {
      status: 'accepted',
      [Op.or]: [{ requesterId: viewerId }, { addresseeId: viewerId }],
    },
  });
  const ids = new Set();
  for (const f of rows) {
    ids.add(f.requesterId === viewerId ? f.addresseeId : f.requesterId);
  }
  return ids;
}

module.exports = { getFriendshipBetween, friendStatusFrom, getViewerFriendIdSet };
