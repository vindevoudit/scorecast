'use strict';

// Tier 13 Chunk 2 — admin routes delegate to GameService + UserService +
// LeaderboardService. Bulk endpoints run one transaction per entity inside
// the services (Tier 5.3 invariant). The bulk-user endpoint returns
// `skipped:[{id,reason:'self'}]` for the caller's own id (CLAUDE.md
// invariant — preserved inside UserService.bulkAction).
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
const asyncHandler = require('../middleware/asyncHandler');
const GameService = require('../services/GameService');
const UserService = require('../services/UserService');
const LeaderboardService = require('../services/LeaderboardService');

const router = express.Router();

router.post(
  '/admin/games',
  authMiddleware,
  requireAdmin,
  validate(createGameSchema),
  asyncHandler(async (req, res) => {
    const game = await GameService.createGame(req.body);
    res.json(game);
  }),
);

router.put(
  '/admin/games/:id',
  authMiddleware,
  requireAdmin,
  validate(updateGameSchema),
  asyncHandler(async (req, res) => {
    const game = await GameService.updateGame(req.params.id, req.body);
    res.json(game);
  }),
);

router.delete(
  '/admin/games/:id',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await GameService.deleteGame(req.params.id);
    res.json({ success: true });
  }),
);

router.get(
  '/admin/users',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await UserService.listAdminSummary());
  }),
);

router.post(
  '/admin/users/:id/role',
  authMiddleware,
  requireAdmin,
  validate(roleSchema),
  asyncHandler(async (req, res) => {
    const role = await UserService.setRole({
      targetId: req.params.id,
      requesterId: req.user.id,
      role: req.body.role,
    });
    res.json({ success: true, role });
  }),
);

router.delete(
  '/admin/users/:id',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await UserService.deleteUserById({ targetId: req.params.id, requesterId: req.user.id });
    res.json({ success: true });
  }),
);

router.post(
  '/admin/games/bulk',
  authMiddleware,
  requireAdmin,
  validate(bulkGameSchema),
  asyncHandler(async (req, res) => {
    const { ids, action, result } = req.body;
    let affected = [];
    if (action === 'delete') {
      affected = await GameService.bulkDelete(ids);
    } else if (action === 'setResult') {
      affected = await GameService.bulkSetResult(ids, result);
    }
    res.json({ success: true, affected });
  }),
);

router.post(
  '/admin/users/bulk',
  authMiddleware,
  requireAdmin,
  validate(bulkUserSchema),
  asyncHandler(async (req, res) => {
    const { affected, skipped } = await UserService.bulkAction({
      ids: req.body.ids,
      action: req.body.action,
      requesterId: req.user.id,
    });
    res.json({ success: true, affected, skipped });
  }),
);

router.get('/admin/cache-stats', authMiddleware, requireAdmin, (req, res) => {
  res.json(LeaderboardService.stats());
});

module.exports = router;
