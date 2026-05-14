'use strict';

// Tier 13 Chunk 1 — notification routes extracted from server.js.
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { Notification } = require('../models');

const router = express.Router();

router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const unreadOnly = req.query.unreadOnly === 'true';
    const where = { userId: req.user.id };
    if (unreadOnly) where.read = false;
    const items = await Notification.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    const unreadCount = await Notification.count({ where: { userId: req.user.id, read: false } });
    res.json({ items, unreadCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.post('/notifications/:id/read', authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findByPk(req.params.id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    if (notification.userId !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });
    notification.read = true;
    await notification.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notification' });
  }
});

router.post('/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    await Notification.update({ read: true }, { where: { userId: req.user.id, read: false } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notifications' });
  }
});

module.exports = router;
