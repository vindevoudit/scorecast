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
const { getUserByUsername } = require('../lib/users');
const { friendStatusFrom } = require('../lib/friends');
const { User, Group, Game, Friendship, GroupJoinRequest } = require('../models');
const UserService = require('../services/UserService');
const TrophyService = require('../services/TrophyService');
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
      // Tier 19 — visibility rules:
      //   anon → only 'public' groups
      //   authed → 'public' + 'private' + any 'secret' they're a member of
      // 'secret' is hidden from non-members by design (search would leak
      // existence otherwise). joinedIds captures group memberships so an
      // authed user always sees their own group in search.
      const joinedIds = viewerId ? await getJoinedGroupIds(viewerId) : [];
      const visibilityClause = viewerId
        ? {
            [Op.or]: [
              {
                id: {
                  [Op.in]: joinedIds.length ? joinedIds : ['00000000-0000-0000-0000-000000000000'],
                },
              },
              { visibility: { [Op.in]: ['public', 'private'] } },
            ],
          }
        : { visibility: 'public' };
      const groups = await Group.findAll({
        where: { name: { [Op.iLike]: like }, ...visibilityClause },
        limit: 5,
      });

      // Tier 19 Chunks 1+3 — per-row CTA flags. Five mutually-informative
      // flags drive the frontend dropdown's button choice:
      //   isMember        → "Joined" (disabled, success)
      //   canJoin         → "Join" (public free join)
      //   canJoinWithPassword → "Enter password" (private + hasPassword)
      //   canRequestJoin  → "Request to join" (private, no pending request)
      //   hasPendingRequest → "Request sent" (disabled)
      // Multiple flags can be true for the same row (e.g. a private group
      // with a password also accepts requests-to-join — the UI prefers the
      // password CTA but offers the request as a secondary action).
      const groupIds = groups.map((g) => g.id);
      let pendingByGroup = new Set();
      if (viewerId && groupIds.length > 0) {
        const pending = await GroupJoinRequest.findAll({
          where: { groupId: { [Op.in]: groupIds }, requesterId: viewerId, declinedAt: null },
          attributes: ['groupId'],
        });
        pendingByGroup = new Set(pending.map((p) => p.groupId));
      }

      results.groups = groups.map((g) => {
        const isMember = joinedIds.includes(g.id);
        const hasPassword = Boolean(g.passwordHash);
        const hasPending = pendingByGroup.has(g.id);
        return {
          id: g.id,
          name: g.name,
          // Phase 0 T29-1 — surface discriminator so SearchBar can render
          // the disambiguated label inline.
          discriminator: g.discriminator,
          visibility: g.visibility,
          isMember,
          hasPassword,
          canJoin: !isMember && g.visibility === 'public',
          canJoinWithPassword: !isMember && g.visibility === 'private' && hasPassword,
          canRequestJoin: !isMember && g.visibility === 'private' && !hasPending,
          hasPendingRequest: hasPending,
        };
      });
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

// Trophy Cabinet — per-stage World Cup placements for a user. Reuses the
// EXACT profile-visibility gate (UserService.canViewProfile) so a
// friends-gated / private target returns the same-shape 404 as the profile
// route — the friend graph stays un-probeable. The payload only ever reveals
// the subject's own rank numbers, so no per-row masking is needed; the group
// section respects the viewer inside TrophyService (self/admin → all groups,
// otherwise shared groups only).
router.get('/users/:username/trophy-cabinet', publicReadLimiter, optionalAuth, async (req, res) => {
  try {
    const target = await getUserByUsername(req.params.username);
    if (!target || !(await UserService.canViewProfile(target, req.user ?? null))) {
      // Same-shape 404 for missing + gated-out, matching getProfileByUsername.
      return res.status(404).json({ error: 'User not found' });
    }
    const cabinet = await TrophyService.getCabinet(target, req.user ?? null);
    res.json(cabinet);
  } catch (error) {
    if (error instanceof errors.AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    req.log.error({ err: error }, 'handler error');
    res.status(500).json({ error: 'Failed to fetch trophy cabinet' });
  }
});

module.exports = router;
