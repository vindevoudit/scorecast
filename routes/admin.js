'use strict';

// Tier 13 Chunk 2 — admin routes delegate to GameService + UserService +
// LeaderboardService. Bulk endpoints run one transaction per entity inside
// the services (Tier 5.3 invariant). The bulk-user endpoint returns
// `skipped:[{id,reason:'self'}]` for the caller's own id (CLAUDE.md
// invariant — preserved inside UserService.bulkAction).
//
// Tier 4b Chunk 3 — every mutating endpoint here is wrapped with
// auditMutation(action, entityType) so the resulting row in audit_log
// records the actor, request body, and final status code.
const express = require('express');
const { validate } = require('../validation/middleware');
const {
  createGameSchema,
  updateGameSchema,
  roleSchema,
  bulkGameSchema,
  bulkUserSchema,
  createLeagueSchema,
  updateLeagueSchema,
} = require('../validation/schemas');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { auditMutation } = require('../middleware/auditLog');
const GameService = require('../services/GameService');
const UserService = require('../services/UserService');
const LeaderboardService = require('../services/LeaderboardService');
const LeagueService = require('../services/LeagueService');
const AuditLogService = require('../services/AuditLogService');
const footballApi = require('../lib/footballApi');

const router = express.Router();

router.post(
  '/admin/games',
  authMiddleware,
  requireAdmin,
  auditMutation('admin.game.create', 'game'),
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
  auditMutation('admin.game.update', 'game'),
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
  auditMutation('admin.game.delete', 'game'),
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
  auditMutation('admin.user.role', 'user'),
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
  auditMutation('admin.user.delete', 'user'),
  asyncHandler(async (req, res) => {
    await UserService.deleteUserById({ targetId: req.params.id, requesterId: req.user.id });
    res.json({ success: true });
  }),
);

router.post(
  '/admin/games/bulk',
  authMiddleware,
  requireAdmin,
  auditMutation('admin.game.bulk', 'game'),
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
  auditMutation('admin.user.bulk', 'user'),
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

// Tier 4b Chunk 1 — league management. Sync is admin-only and synchronous
// for now (admin sees the result count in the response). The daily cron in
// Chunk 2 will reuse LeagueService.syncFixtures for every active league.
router.get(
  '/admin/leagues',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const leagues = await LeagueService.listLeagues();
    res.json({
      leagues,
      apiConfigured: footballApi.isConfigured(),
      apiBudget: footballApi.requestsAvailable(),
    });
  }),
);

router.post(
  '/admin/leagues',
  authMiddleware,
  requireAdmin,
  auditMutation('admin.league.create', 'league'),
  validate(createLeagueSchema),
  asyncHandler(async (req, res) => {
    const league = await LeagueService.createLeague(req.body);
    res.status(201).json(league);
  }),
);

router.put(
  '/admin/leagues/:id',
  authMiddleware,
  requireAdmin,
  auditMutation('admin.league.update', 'league'),
  validate(updateLeagueSchema),
  asyncHandler(async (req, res) => {
    const league = await LeagueService.updateLeague(req.params.id, req.body);
    res.json(league);
  }),
);

router.delete(
  '/admin/leagues/:id',
  authMiddleware,
  requireAdmin,
  auditMutation('admin.league.delete', 'league'),
  asyncHandler(async (req, res) => {
    await LeagueService.deleteLeague(req.params.id);
    res.json({ success: true });
  }),
);

router.post(
  '/admin/leagues/:id/sync',
  authMiddleware,
  requireAdmin,
  auditMutation('admin.league.sync', 'league'),
  asyncHandler(async (req, res) => {
    const summary = await LeagueService.syncFixtures(req.params.id);
    res.json({ success: true, ...summary });
  }),
);

// Tier 4b Chunk 3 — audit log read endpoint. Paginated; capped at 200
// per page inside the service. Read-only, admin-only.
router.get(
  '/admin/audit-log',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const page = await AuditLogService.list({
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(page);
  }),
);

module.exports = router;
