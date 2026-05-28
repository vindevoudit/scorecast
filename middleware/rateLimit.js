'use strict';

// Tier 13 Chunk 1 — rate limiters extracted from server.js. Each limiter
// retains its window, max, and message from the original Tier 6.x rollout.
//
// The `skipInTest` predicate disables limiting when NODE_ENV=test so the
// Playwright suite (5.5) doesn't 429 itself from a single 127.0.0.1 source.
const rateLimit = require('express-rate-limit');

const skipInTest = () => process.env.NODE_ENV === 'test';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many login attempts, try again later' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many registrations from this IP, try again later' },
});

const clientErrorLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many error reports' },
});

const commentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Slow down — too many comments' },
});

const friendRequestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many friend requests' },
});

const pickLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many pick changes — slow down' },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many password reset requests' },
});

// publicReadLimiter — applied to the optional-auth GETs (games / leaderboard
// / public groups / search / public profiles) so anonymous browse traffic is
// capped. Generous limit since legitimate browsing makes a handful of reads
// per page. Per IP since these requests may be cookie-less.
const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many requests — slow down' },
});

// Tier 19 Chunk 1 — password-protected group join. Tighter than the friend-
// request budget because the surface here is an actual secret (the group
// password). 10 attempts/min/user is plenty for a fat-fingered legitimate
// user and aggressively throttles brute-force probing.
const groupJoinPasswordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many join attempts — please wait a minute and retry' },
});

// Tier 22 — high-cost / high-impact account-modification routes. CPU-bound
// bcrypt on every call (/me/password) or an outbound email send (/me/email);
// 10/hour/IP is comfortably above any legitimate human cadence but
// aggressively throttles credential-stuffing pivots that ride a stolen
// session cookie.
const sensitiveAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many account changes — slow down' },
});

// Tier 22 — light DB writes that aren't expensive per-call but should still
// have a backstop against scripted abuse. 60/min/IP — legitimate use is
// under 5/min even for power users.
const lightWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many requests' },
});

// Tier 22 — per-IP throttle on group invites. Every invite fans out a bell +
// push notification, so without a limit one member can spam thousands of
// notifications to one user (or one group). The 5/min/IP cap pairs with the
// per-group pending-invite cap in GroupService.invite.
const inviteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many invites — slow down' },
});

module.exports = {
  skipInTest,
  loginLimiter,
  registerLimiter,
  clientErrorLimiter,
  commentLimiter,
  friendRequestLimiter,
  pickLimiter,
  forgotPasswordLimiter,
  publicReadLimiter,
  groupJoinPasswordLimiter,
  sensitiveAccountLimiter,
  lightWriteLimiter,
  inviteLimiter,
};
