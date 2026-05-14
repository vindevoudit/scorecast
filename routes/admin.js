'use strict';

// Tier 13 Chunk 1 — admin routes extracted from server.js. Covers admin
// game CRUD, admin user listing + role flip + delete, the two bulk endpoints,
// and the cache-stats inspection route.
//
// Bulk endpoints run ONE transaction per entity so a single bad row doesn't
// undo the rest (Tier 5.3 invariant). The bulk-user endpoint filters the
// caller's own id and returns it in `skipped:[{id, reason:'self'}]` instead
// of erroring the batch (CLAUDE.md invariant).
const express = require('express');
const { validate } = require('../validation/middleware');
const {
  createGameSchema,
  updateGameSchema,
  roleSchema,
  bulkGameSchema,
  bulkUserSchema,
} = require('../validation/schemas');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { scorePick } = require('../lib/scoring');
const { notify, evaluateBadges } = require('../lib/badges');
const { cascadeDeleteGame, cascadeDeleteUser } = require('../lib/cascade');
const leaderboardCache = require('../lib/leaderboardCache');
const { User, Game, Pick, GroupMember, sequelize } = require('../models');

const router = express.Router();

router.post(
  '/admin/games',
  authMiddleware,
  requireAdmin,
  validate(createGameSchema),
  async (req, res) => {
    try {
      const game = await Game.create(req.body);
      res.json(game);
    } catch (error) {
      req.log.error({ err: error }, 'handler error');
      res.status(500).json({ error: 'Failed to create game' });
    }
  },
);

router.put(
  '/admin/games/:id',
  authMiddleware,
  requireAdmin,
  validate(updateGameSchema),
  async (req, res) => {
    try {
      const game = await Game.findByPk(req.params.id);
      if (!game) return res.status(404).json({ error: 'Game not found' });
      Object.assign(game, req.body);
      await game.save();
      res.json(game);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update game' });
    }
  },
);

router.delete('/admin/games/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const game = await Game.findByPk(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    await sequelize.transaction(async (t) => {
      await cascadeDeleteGame(game, { transaction: t });
    });
    leaderboardCache.invalidate('all');
    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, 'handler error');
    res.status(500).json({ error: 'Failed to delete game' });
  }
});

router.get('/admin/users', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const users = await User.findAll({ order: [['createdAt', 'ASC']] });
    const userIds = users.map((u) => u.id);
    const picks = await Pick.findAll({ where: { userId: userIds } });
    const memberships = await GroupMember.findAll({ where: { userId: userIds } });
    const picksByUser = new Map();
    for (const p of picks) picksByUser.set(p.userId, (picksByUser.get(p.userId) || 0) + 1);
    const groupsByUser = new Map();
    for (const m of memberships) groupsByUser.set(m.userId, (groupsByUser.get(m.userId) || 0) + 1);
    res.json(
      users.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        createdAt: u.createdAt,
        picksCount: picksByUser.get(u.id) || 0,
        groupsCount: groupsByUser.get(u.id) || 0,
      })),
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post(
  '/admin/users/:id/role',
  authMiddleware,
  requireAdmin,
  validate(roleSchema),
  async (req, res) => {
    try {
      if (req.params.id === req.user.id && req.body.role !== 'admin') {
        return res.status(400).json({ error: 'You cannot demote yourself' });
      }
      const target = await User.findByPk(req.params.id);
      if (!target) return res.status(404).json({ error: 'User not found' });
      target.role = req.body.role;
      await target.save({ hooks: false });
      res.json({ success: true, role: target.role });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update role' });
    }
  },
);

router.delete('/admin/users/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete yourself' });
    }
    const target = await User.findByPk(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    await sequelize.transaction(async (t) => {
      await cascadeDeleteUser(target, { transaction: t });
    });
    leaderboardCache.invalidate('all');
    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, 'handler error');
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

router.post(
  '/admin/games/bulk',
  authMiddleware,
  requireAdmin,
  validate(bulkGameSchema),
  async (req, res) => {
    const { ids, action, result } = req.body;
    if (action === 'setResult' && !(result === 'home' || result === 'away' || result === null)) {
      return res.status(400).json({ error: 'setResult requires result of home, away, or null' });
    }
    try {
      const games = await Game.findAll({ where: { id: ids } });
      const affected = [];
      if (action === 'delete') {
        for (const game of games) {
          await sequelize.transaction(async (t) => {
            await cascadeDeleteGame(game, { transaction: t });
          });
          affected.push(game.id);
        }
      } else if (action === 'setResult') {
        for (const game of games) {
          game.result = result;
          await game.save();
          if (result) {
            const picksForGame = await Pick.findAll({ where: { gameId: game.id } });
            for (const pick of picksForGame) {
              const points = scorePick(pick, game);
              const isWin = pick.choice === result;
              const title = isWin
                ? `Your pick on ${game.homeTeam} vs ${game.awayTeam}: ✓ Correct +${points} pts`
                : `Your pick on ${game.homeTeam} vs ${game.awayTeam}: ✗ Missed`;
              notify(pick.userId, 'pick-scored', title).catch(() => {});
              evaluateBadges(pick.userId).catch(() => {});
            }
          }
          affected.push(game.id);
        }
      }
      if (affected.length > 0) leaderboardCache.invalidate('all');
      res.json({ success: true, affected });
    } catch (error) {
      req.log.error({ err: error }, 'handler error');
      res.status(500).json({ error: 'Bulk game action failed' });
    }
  },
);

router.post(
  '/admin/users/bulk',
  authMiddleware,
  requireAdmin,
  validate(bulkUserSchema),
  async (req, res) => {
    const { ids, action } = req.body;
    const skipped = [];
    const affected = [];
    try {
      const filteredIds = ids.filter((id) => {
        if (id === req.user.id) {
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
            await cascadeDeleteUser(target, { transaction: t });
          });
          affected.push(target.id);
        }
      }
      if (affected.length > 0 && action === 'delete') leaderboardCache.invalidate('all');
      res.json({ success: true, affected, skipped });
    } catch (error) {
      req.log.error({ err: error }, 'handler error');
      res.status(500).json({ error: 'Bulk user action failed' });
    }
  },
);

router.get('/admin/cache-stats', authMiddleware, requireAdmin, (req, res) => {
  res.json(leaderboardCache.stats());
});

module.exports = router;
