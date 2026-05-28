'use strict';

// PWA Chunk 4 — Web Push delivery service.
//
// Mirrors lib/email.js's "never throw, gracefully degrade when transport is
// not configured" pattern: boot succeeds without VAPID keys, every call
// becomes a no-op, prod logs one warn line. This lets us ship the backend
// before the KV-seeded `vapid-private-key` is in place, then flip on by
// reapplying Bicep — no code change.
//
// Tier 5.3 invariant: callers (NotificationService.notify, route handlers)
// fire sendToUser OUTSIDE any surrounding transaction so a rollback can't
// leave a ghost push delivered for an aborted DB change.
const webpush = require('web-push');
const { PushSubscription, User } = require('../models');
const logger = require('../lib/logger');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

// Auto-purge a subscription after this many consecutive non-410 failures.
// 410 Gone deletes immediately because the push service is telling us the
// subscription is dead; everything else might be transient (5xx, network).
const MAX_CONSECUTIVE_FAILURES = 5;

// Default TTL on the push provider — if a device is offline for >24h, drop
// the notification rather than queueing forever.
const PUSH_TTL_SECONDS = 60 * 60 * 24;

let initialized = false;

function init() {
  if (initialized) return;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    logger.warn(
      { hasPublic: Boolean(VAPID_PUBLIC_KEY), hasPrivate: Boolean(VAPID_PRIVATE_KEY) },
      'Web Push disabled — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT not all set. PushService.sendToUser() will no-op.',
    );
    return;
  }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    initialized = true;
    logger.info('Web Push transport configured (VAPID).');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to configure VAPID — PushService disabled');
  }
}

function isReady() {
  return initialized;
}

function getPublicKey() {
  return VAPID_PUBLIC_KEY || null;
}

async function upsertSubscription({ userId, endpoint, p256dh, auth, userAgent }) {
  const [sub, created] = await PushSubscription.findOrCreate({
    where: { userId, endpoint },
    defaults: { userId, endpoint, p256dh, auth, userAgent, lastUsedAt: new Date() },
  });
  if (!created) {
    // Re-subscribe from the same device — keys may have rotated; reset the
    // failure counter so a previously-flaky endpoint gets another chance.
    sub.p256dh = p256dh;
    sub.auth = auth;
    sub.userAgent = userAgent;
    sub.lastUsedAt = new Date();
    sub.failureCount = 0;
    await sub.save();
  }
  return { id: sub.id, created };
}

async function removeSubscription({ userId, endpoint }) {
  const removed = await PushSubscription.destroy({ where: { userId, endpoint } });
  return { removed };
}

// Tier 22 H4 — block sends to private/loopback/link-local addresses. The
// pushSubscribeSchema's host allowlist (validation/schemas.js) already
// rejects these at write time, but a row could have been inserted before
// that landed OR a future provider's hostname could resolve via DNS rebind
// to an internal IP. Belt-and-braces: drop the subscription on the spot if
// the hostname is a literal private/loopback address. Hostname-based check
// — we don't resolve DNS here (sync), so dynamic-DNS attacks still need
// the webpush library's own SSRF posture; this catches the literal-IP case.
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./, // 127.0.0.0/8 loopback
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // RFC1918 172.16/12
  /^169\.254\./, // link-local incl. Azure IMDS 169.254.169.254
  /^0\./, // 0.0.0.0/8
  /^::1$/, // IPv6 loopback
  /^fc/i, // IPv6 unique-local (fc00::/7)
  /^fe80/i, // IPv6 link-local
];
function isBlockedHost(hostname) {
  return BLOCKED_HOST_PATTERNS.some((re) => re.test(hostname));
}

// Send a payload to a single subscription, handling Gone (410/404) by
// dropping the row and other errors by incrementing failureCount.
async function sendToSubscription(sub, body) {
  try {
    const { hostname } = new URL(sub.endpoint);
    if (isBlockedHost(hostname)) {
      logger.warn(
        { subscriptionId: sub.id, userId: sub.userId, hostname },
        'PushService: refusing to send to private/loopback host — dropping subscription',
      );
      await sub.destroy();
      return { ok: false, pruned: true };
    }
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      body,
      { TTL: PUSH_TTL_SECONDS },
    );
    sub.lastUsedAt = new Date();
    if (sub.failureCount > 0) sub.failureCount = 0;
    await sub.save();
    return { ok: true };
  } catch (err) {
    const statusCode = err?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await sub.destroy();
      logger.info(
        { subscriptionId: sub.id, userId: sub.userId, statusCode },
        'pruned dead push subscription',
      );
      return { ok: false, pruned: true };
    }
    sub.failureCount = (sub.failureCount || 0) + 1;
    if (sub.failureCount >= MAX_CONSECUTIVE_FAILURES) {
      await sub.destroy();
      logger.warn(
        { subscriptionId: sub.id, userId: sub.userId, statusCode },
        'pruned push subscription after consecutive failures',
      );
      return { ok: false, pruned: true };
    }
    await sub.save();
    logger.warn(
      { err: err.message, statusCode, subscriptionId: sub.id, failureCount: sub.failureCount },
      'push send failed',
    );
    return { ok: false };
  }
}

// Fan out a notification to every subscription the user has registered,
// honoring users.pushPreferences[type]. Never throws — callers fire-and-
// forget. NotificationService.notify is the primary caller.
async function sendToUser(userId, type, payload) {
  if (!initialized) return { sent: 0, skipped: 'transport not configured' };
  try {
    const user = await User.findByPk(userId, { attributes: ['id', 'pushPreferences'] });
    if (!user) return { sent: 0, skipped: 'user not found' };
    const prefs = user.pushPreferences || {};
    if (prefs[type] === false) return { sent: 0, skipped: 'user opted out of type' };

    const subs = await PushSubscription.findAll({ where: { userId } });
    if (subs.length === 0) return { sent: 0, skipped: 'no subscriptions' };

    const body = JSON.stringify({ ...payload, type });
    const results = await Promise.all(subs.map((sub) => sendToSubscription(sub, body)));
    const sent = results.filter((r) => r.ok).length;
    return { sent, total: subs.length };
  } catch (err) {
    logger.warn(
      { err: err.message, userId, notificationType: type },
      'PushService.sendToUser threw — swallowed to preserve fire-and-forget contract',
    );
    return { sent: 0, skipped: 'error' };
  }
}

async function updatePreferences(userId, prefs) {
  // Merge with the existing JSONB rather than replace, so a partial PUT
  // doesn't wipe types the client didn't mention.
  const user = await User.findByPk(userId);
  if (!user) return null;
  user.pushPreferences = { ...(user.pushPreferences || {}), ...prefs };
  await user.save({ hooks: false });
  return user.pushPreferences;
}

// Self-initialize at module load — mirrors lib/email.js. Without VAPID env
// vars this logs once and leaves the service in a no-op state. Re-callable
// init() is kept for tests that want to flip the transport on after boot.
init();

module.exports = {
  init,
  isReady,
  getPublicKey,
  upsertSubscription,
  removeSubscription,
  sendToUser,
  updatePreferences,
};
