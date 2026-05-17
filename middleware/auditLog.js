'use strict';

// Tier 4b Chunk 3 — auditMutation middleware factory.
//
//   router.post('/admin/games', authMiddleware, requireAdmin,
//     auditMutation('admin.game.create', 'game'), validate(...),
//     asyncHandler(...));
//
// Records one audit_log row per request via res.on('finish'), so the
// status code reflects the real outcome (200, 400, 409, 500…). Failures
// in the audit-write are swallowed inside AuditLogService.record — they
// must never block the real response.
//
// Payload heuristics:
//   - CREATE / UPDATE: req.body → `after`. `before` stays null because
//     middleware doesn't have entity-fetching wired through.
//   - DELETE:          req.body → `before` (usually empty), `after` null.
//   - Other (POST):    req.body → `after`.
//
// Entity id is read from the first matching req.params slot the
// admin routes use (id / gameId / groupId / leagueId). Bulk endpoints
// have no single id; the payload (ids[]) lands in `after`.

const AuditLogService = require('../services/AuditLogService');

function extractEntityId(req) {
  const p = req.params || {};
  return p.id || p.gameId || p.groupId || p.leagueId || p.userId || null;
}

function auditMutation(action, entityType) {
  return function auditMutationMiddleware(req, res, next) {
    // Stash the body/params at request time — handlers may mutate
    // req.body downstream (e.g., validate() replaces it) but the values
    // captured here are what the admin actually sent.
    const capturedBody = req.body ? { ...req.body } : null;
    const capturedEntityId = extractEntityId(req);

    res.on('finish', () => {
      const isDelete = req.method === 'DELETE';
      AuditLogService.record({
        actorUserId: req.user?.id,
        action,
        entityType,
        entityId: capturedEntityId,
        before: isDelete ? capturedBody : null,
        after: isDelete ? null : capturedBody,
        requestId: req.id,
        statusCode: res.statusCode,
      });
    });
    next();
  };
}

module.exports = { auditMutation };
