'use strict';

// Tier 13 Chunk 1 — user-facing read routes extracted from server.js. Covers
// /search and /users/:username/profile (with friend-aware head-to-head).
const express = require('express');
const { Op } = require('sequelize');
const { authMiddleware } = require('../middleware/auth');
const { scorePick } = require('../lib/scoring');
const { getUserByUsername } = require('../lib/users');
const { getJoinedGroupIds } = require('../lib/groups');
const { getFriendshipBetween, friendStatusFrom } = require('../lib/friends');
const { BADGE_CATALOG } = require('../badges/catalog');
const { User, Group, Game, Pick, Badge } = require('../models');

const router = express.Router();

router.get('/search', authMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const type = req.query.type || 'all';
    if (q.length < 2) return res.json({ users: [], groups: [], games: [] });

    const like = `%${q}%`;
    const results = { users: [], groups: [], games: [] };

    if (type === 'all' || type === 'users') {
      const users = await User.findAll({
        where: {
          [Op.or]: [{ username: { [Op.iLike]: like } }, { displayName: { [Op.iLike]: like } }],
        },
        limit: 5,
      });
      results.users = users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName || null,
      }));
    }

    if (type === 'all' || type === 'groups') {
      const joinedIds = await getJoinedGroupIds(req.user.id);
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

router.get('/users/:username/profile', authMiddleware, async (req, res) => {
  try {
    const targetUser = await getUserByUsername(req.params.username);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [userPicks, allGames, badges] = await Promise.all([
      Pick.findAll({ where: { userId: targetUser.id } }),
      Game.findAll(),
      Badge.findAll({ where: { userId: targetUser.id } }),
    ]);

    const gameById = new Map(allGames.map((g) => [g.id, g]));
    let totalPoints = 0;
    let picksWon = 0;
    let picksScored = 0;
    for (const pick of userPicks) {
      const game = gameById.get(pick.gameId);
      if (!game) continue;
      if (game.result) {
        picksScored += 1;
        const pts = scorePick(pick, game);
        totalPoints += pts;
        if (pick.choice === game.result) picksWon += 1;
      }
    }
    const picksMade = userPicks.length;
    const winRate = picksScored > 0 ? picksWon / picksScored : 0;

    const recentPicks = [...userPicks]
      .map((pick) => ({ pick, game: gameById.get(pick.gameId) }))
      .filter((row) => row.game)
      .sort((a, b) => new Date(b.game.date) - new Date(a.game.date))
      .slice(0, 10)
      .map(({ pick, game }) => ({
        gameId: game.id,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        date: game.date,
        result: game.result,
        choice: pick.choice,
        points: scorePick(pick, game),
      }));

    const friendship = await getFriendshipBetween(req.user.id, targetUser.id);
    const friendStatus = friendStatusFrom(friendship, req.user.id, targetUser.id);

    let headToHead = null;
    if (friendStatus === 'friends') {
      const viewerPicks = await Pick.findAll({ where: { userId: req.user.id } });
      const viewerByGame = new Map(viewerPicks.map((p) => [p.gameId, p]));
      let viewerWins = 0;
      let targetWins = 0;
      let ties = 0;
      for (const pick of userPicks) {
        const game = gameById.get(pick.gameId);
        if (!game || !game.result) continue;
        const viewerPick = viewerByGame.get(pick.gameId);
        if (!viewerPick) continue;
        const viewerPts = scorePick(viewerPick, game);
        const targetPts = scorePick(pick, game);
        if (viewerPts > targetPts) viewerWins += 1;
        else if (targetPts > viewerPts) targetWins += 1;
        else ties += 1;
      }
      headToHead = { viewerWins, targetWins, ties };
    }

    res.json({
      id: targetUser.id,
      username: targetUser.username,
      role: targetUser.role,
      displayName: targetUser.displayName || null,
      bio: targetUser.bio || null,
      joinedAt: targetUser.createdAt,
      totalPoints,
      picksMade,
      picksWon,
      picksScored,
      winRate,
      badges: badges.map((b) => ({ slug: b.slug, awardedAt: b.awardedAt })),
      catalog: BADGE_CATALOG,
      recentPicks,
      friendship: friendship ? { id: friendship.id, status: friendship.status } : null,
      friendStatus,
      headToHead,
    });
  } catch (error) {
    req.log.error({ err: error }, 'handler error');
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;
