'use strict';

// Tier 13 Chunk 1 — user-facing read routes extracted from server.js. Covers
// /search and /users/:username/profile.
//
// Tier 8.6 — /users/:username/profile delegates to UserService which gates
// the payload on users.profileVisibility. Search keeps returning every match
// + a `profileVisibility` flag so the client can mask display; friend
// requests still need the username so the field stays in the response.
const express = require('express');
const { Op } = require('sequelize');
const { optionalAuth } = require('../middleware/optionalAuth');
const { publicReadLimiter } = require('../middleware/rateLimit');
const { getJoinedGroupIds } = require('../lib/groups');
const { friendStatusFrom } = require('../lib/friends');
const { User, Group, Game, Friendship } = require('../models');
const UserService = require('../services/UserService');
const errors = require('../lib/errors');

const router = express.Router();

router.get('/search', publicReadLimiter, optionalAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const type = req.query.type || 'all';
    if (q.length < 2) return res.json({ users: [], groups: [], games: [] });

    const like = `%${q}%`;
    const viewerId = req.user?.id ?? null;
    const results = { users: [], groups: [], games: [] };

    if (type === 'all' || type === 'users') {
      const users = await User.findAll({
        where: {
          [Op.or]: [{ username: { [Op.iLike]: like } }, { displayName: { [Op.iLike]: like } }],
        },
        limit: 5,
      });
      // Tier 19 Chunk 2 — attach per-row `friendStatus` + `friendshipId`
      // for the authed viewer in ONE batched Friendship query (no N+1).
      // Values mirror `lib/friends.js friendStatusFrom`: 'self' / 'friends'
      // / 'pending-out' / 'pending-in' / 'none'. Anon viewers get `null`
      // for both — FriendsList is anon-hidden anyway, so the fields are
      // pure UX hints for the dropdown's per-row CTA.
      const userIds = users.map((u) => u.id);
      let friendshipByOtherId = new Map();
      if (viewerId && userIds.length > 0) {
        const otherIds = userIds.filter((id) => id !== viewerId);
        if (otherIds.length > 0) {
          const rows = await Friendship.findAll({
            where: {
              [Op.or]: [
                { requesterId: viewerId, addresseeId: { [Op.in]: otherIds } },
                { requesterId: { [Op.in]: otherIds }, addresseeId: viewerId },
              ],
            },
          });
          for (const f of rows) {
            const other = f.requesterId === viewerId ? f.addresseeId : f.requesterId;
            friendshipByOtherId.set(other, f);
          }
        }
      }
      results.users = users.map((u) => {
        const friendship = friendshipByOtherId.get(u.id) || null;
        const friendStatus = viewerId ? friendStatusFrom(friendship, viewerId, u.id) : null;
        // Only surface friendshipId on `pending-in` so the dropdown's
        // Accept button can call POST /api/friends/:id/accept. Other
        // states either don't need it (none/friends/self) or shouldn't
        // expose it as an action (pending-out is render-only).
        const friendshipId = friendStatus === 'pending-in' && friendship ? friendship.id : null;
        return {
          id: u.id,
          username: u.username,
          displayName: u.displayName || null,
          profileVisibility: u.profileVisibility,
          friendStatus,
          friendshipId,
        };
      });
    }

    if (type === 'all' || type === 'groups') {
      // Anonymous viewers see only public groups (joinedIds is empty).
      const joinedIds = viewerId ? await getJoinedGroupIds(viewerId) : [];
      const groups = await Group.findAll({
        where: {
          name: { [Op.iLike]: like },
          [Op.or]: [
            {
              id: {
                [Op.in]: joinedIds.length ? joinedIds : ['00000000-0000-0000-0000-000000000000'],
              },
            },
            { visibility: 'public' },
          ],
        },
        limit: 5,
      });
      results.groups = groups.map((g) => ({
        id: g.id,
        name: g.name,
        visibility: g.visibility,
        isMember: joinedIds.includes(g.id),
      }));
    }

    if (type === 'all' || type === 'games') {
      const games = await Game.findAll({
        where: {
          [Op.or]: [{ homeTeam: { [Op.iLike]: like } }, { awayTeam: { [Op.iLike]: like } }],
        },
        order: [['date', 'DESC']],
        limit: 5,
      });
      results.games = games.map((g) => ({
        id: g.id,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        date: g.date,
        result: g.result,
      }));
    }

    res.json(results);
  } catch (error) {
    req.log.error({ err: error }, 'handler error');
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/users/:username/profile', publicReadLimiter, optionalAuth, async (req, res) => {
  try {
    const profile = await UserService.getProfileByUsername({
      username: req.params.username,
      viewer: req.user ?? null,
    });
    res.json(profile);
  } catch (error) {
    if (error instanceof errors.AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    req.log.error({ err: error }, 'handler error');
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;
