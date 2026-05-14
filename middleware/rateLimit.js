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

module.exports = {
  skipInTest,
  loginLimiter,
  registerLimiter,
  clientErrorLimiter,
  commentLimiter,
  friendRequestLimiter,
  pickLimiter,
  forgotPasswordLimiter,
};
