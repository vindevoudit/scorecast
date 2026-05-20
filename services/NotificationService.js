'use strict';

// Tier 13 Chunk 2 — NotificationService. Pure functions over the Notification
// model. notify() never throws (CLAUDE.md invariant — a failed notification
// must not break the surrounding flow). Tier 5.3 invariant: callers fire
// notify() OUTSIDE the surrounding transaction so a rollback never produces
// ghost messages.
//
// PWA Chunk 4 — notify() ALSO fan-outs to Web Push via PushService. The push
// call is fire-and-forget (its own try/catch + never-throw contract) so a
// push transport outage can't break the in-app bell.
const { Notification } = require('../models');
const logger = require('../lib/logger');
const PushService = require('./PushService');

async function notify(userId, type, title, body = null, link = null) {
  try {
    await Notification.create({ userId, type, title, body, link });
  } catch (error) {
    logger.warn({ err: error, userId, notificationType: type }, 'failed to create notification');
  }
  // Web Push delivery — never blocks, never throws. PushService.sendToUser is
  // safe to call without VAPID keys configured (no-op + logged once at boot).
  PushService.sendToUser(userId, type, { title, body, link }).catch((err) => {
    logger.warn(
      { err: err.message, userId, notificationType: type },
      'PushService.sendToUser rejected after its own catch — should not happen',
    );
  });
}

async function listForUser(userId, { unreadOnly = false, limit = 50 } = {}) {
  const where = { userId };
  if (unreadOnly) where.read = false;
  const items = await Notification.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
  });
  const unreadCount = await Notification.count({ where: { userId, read: false } });
  return { items, unreadCount };
}

async function markRead(notificationId, userId) {
  const notification = await Notification.findByPk(notificationId);
  if (!notification) return { status: 'not_found' };
  if (notification.userId !== userId) return { status: 'forbidden' };
  notification.read = true;
  await notification.save();
  return { status: 'ok' };
}

async function markAllRead(userId) {
  await Notification.update({ read: true }, { where: { userId, read: false } });
}

module.exports = { notify, listForUser, markRead, markAllRead };
