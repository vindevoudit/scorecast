'use strict';

// Tier 13 Chunk 2 — notification routes delegate to NotificationService.
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { lightWriteLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../middleware/asyncHandler');
const errors = require('../lib/errors');
const NotificationService = require('../services/NotificationService');

const router = express.Router();

router.get(
  '/notifications',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await NotificationService.listForUser(req.user.id, {
      unreadOnly: req.query.unreadOnly === 'true',
    });
    res.json(result);
  }),
);

router.post(
  '/notifications/:id/read',
  lightWriteLimiter,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { status } = await NotificationService.markRead(req.params.id, req.user.id);
    if (status === 'not_found') throw errors.notFound('Notification not found');
    if (status === 'forbidden') throw errors.forbidden();
    res.json({ success: true });
  }),
);

router.post(
  '/notifications/read-all',
  lightWriteLimiter,
  authMiddleware,
  asyncHandler(async (req, res) => {
    await NotificationService.markAllRead(req.user.id);
    res.json({ success: true });
  }),
);

module.exports = router;
