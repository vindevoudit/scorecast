'use strict';

// Tier 4b Chunk 3 — AuditLogService. Records admin mutations + serves the
// /api/admin/audit-log page. The middleware (middleware/auditLog.js) calls
// record() fire-and-forget on every wrapped admin route; this service
// must never throw back into the request lifecycle — failures are logged
// and swallowed so an audit-log outage can never block a real mutation.

const { AuditLog, User } = require('../models');
const logger = require('../lib/logger');

const MAX_PAYLOAD_BYTES = 4 * 1024; // 4KB cap per plan (truncate, don't reject)
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function truncatePayload(value) {
  if (value === null || value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') <= MAX_PAYLOAD_BYTES) return value;
    // Replace with a sentinel so the row still records "something happened"
    // without blowing the column up. Stores the byte size for diagnostics.
    return {
      _truncated: true,
      _bytes: Buffer.byteLength(serialized, 'utf8'),
      preview: serialized.slice(0, 512),
    };
  } catch {
    return { _unserializable: true };
  }
}

async function record({
  actorUserId,
  action,
  entityType,
  entityId = null,
  before = null,
  after = null,
  requestId = null,
  statusCode = null,
}) {
  try {
    await AuditLog.create({
      actorUserId: actorUserId || null,
      action,
      entityType,
      entityId: entityId ? String(entityId) : null,
      before: truncatePayload(before),
      after: truncatePayload(after),
      requestId,
      statusCode,
    });
  } catch (err) {
    // Never throw into the caller — middleware fires this from
    // res.on('finish'), which has no error path back to the client.
    logger.error({ err, action, entityType, entityId }, 'audit log write failed');
  }
}

async function list({ limit = DEFAULT_PAGE_SIZE, offset = 0 } = {}) {
  const cappedLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(limit) || DEFAULT_PAGE_SIZE));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const { rows, count } = await AuditLog.findAndCountAll({
    order: [['createdAt', 'DESC']],
    limit: cappedLimit,
    offset: safeOffset,
    include: [{ model: User, as: 'actor', attributes: ['id', 'username'] }],
  });
  return {
    entries: rows.map((r) => ({
      id: r.id,
      actor: r.actor ? { id: r.actor.id, username: r.actor.username } : null,
      actorUserId: r.actorUserId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      requestId: r.requestId,
      statusCode: r.statusCode,
      createdAt: r.createdAt,
    })),
    total: count,
    limit: cappedLimit,
    offset: safeOffset,
  };
}

module.exports = { record, list, MAX_PAYLOAD_BYTES };
