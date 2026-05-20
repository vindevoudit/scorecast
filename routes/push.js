'use strict';

// PWA Chunk 4 — Web Push subscription routes.
//
// GET    /api/push/vapid-public-key  → anon, returns the public key the
//                                     frontend needs to call PushManager
//                                     .subscribe({ applicationServerKey })
// POST   /api/push/subscribe         → authed + CSRF, upserts subscription
// DELETE /api/push/subscribe         → authed + CSRF, drops subscription
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { publicReadLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../middleware/asyncHandler');
const { validate } = require('../validation/middleware');
const { pushSubscribeSchema, pushUnsubscribeSchema } = require('../validation/schemas');
const PushService = require('../services/PushService');

const router = express.Router();

// Anonymous-readable: the public key is, by definition, public. Rate-limited
// so a misbehaving client can't hammer it.
router.get(
  '/push/vapid-public-key',
  publicReadLimiter,
  asyncHandler(async (_req, res) => {
    const publicKey = PushService.getPublicKey();
    if (!publicKey) {
      // Transport not configured (no VAPID env vars). Return 503 so the
      // client can branch the UI to "push not available" rather than
      // attempting a subscribe that would fail downstream.
      return res
        .status(503)
        .json({ error: 'Push notifications are not configured on this server' });
    }
    res.json({ publicKey });
  }),
);

router.post(
  '/push/subscribe',
  authMiddleware,
  validate(pushSubscribeSchema),
  asyncHandler(async (req, res) => {
    const { endpoint, keys } = req.body;
    const result = await PushService.upsertSubscription({
      userId: req.user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.headers['user-agent'] || null,
    });
    res.status(result.created ? 201 : 200).json({ ok: true });
  }),
);

router.delete(
  '/push/subscribe',
  authMiddleware,
  validate(pushUnsubscribeSchema),
  asyncHandler(async (req, res) => {
    await PushService.removeSubscription({
      userId: req.user.id,
      endpoint: req.body.endpoint,
    });
    res.json({ ok: true });
  }),
);

module.exports = router;
