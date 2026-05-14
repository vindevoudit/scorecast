'use strict';

// Tier 13 Chunk 2 — NotificationService. Pure functions over the Notification
// model. notify() never throws (CLAUDE.md invariant — a failed notification
// must not break the surrounding flow). Tier 5.3 invariant: callers fire
// notify() OUTSIDE the surrounding transaction so a rollback never produces
// ghost messages.
const { Notification } = require('../models');
const logger = require('../lib/logger');

async function notify(userId, type, title, body = null, link = null) {
  try {
    await Notification.create({ userId, type, title, body, link });
  } catch (error) {
    logger.warn({ err: error, userId, notificationType: type }, 'failed to create notification');
  }
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
