'use strict';

// Tier 13 Chunk 1 — auth constants + cookie helpers extracted from server.js.
// Keeps Tier 6.8 invariants intact: HttpOnly cookies, rotating refresh, no
// bearer header. Cookie paths are deliberate (refresh + challenge restrict
// themselves to /api/auth so they aren't sent on every request).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('./logger');
const { RefreshToken } = require('../models');

const RAW_JWT_SECRET = process.env.JWT_SECRET;
if (!RAW_JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET env var is required in production');
  }
  logger.warn('JWT_SECRET not set — using insecure dev fallback');
}
const JWT_SECRET = RAW_JWT_SECRET || 'scorecast-dev-only-do-not-use';

const ACCESS_COOKIE = 'sc_access';
const REFRESH_COOKIE = 'sc_refresh';
const CHALLENGE_COOKIE = 'sc_challenge';
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const COOKIE_SECURE = process.env.NODE_ENV === 'production';

function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function createAccessToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
  });
}

async function setAuthCookies(res, user, { userAgent, transaction } = {}) {
  const accessJwt = createAccessToken(user);
  const rawRefresh = crypto.randomBytes(32).toString('hex');
  // Phase 0 P0-8 — accept an optional transaction so /auth/refresh can
  // run "revoke old + create new" atomically under the row-level lock.
  // No-op when transaction is undefined (every other caller path).
  await RefreshToken.create(
    {
      userId: user.id,
      tokenHash: crypto.createHash('sha256').update(rawRefresh).digest('hex'),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
    },
    transaction ? { transaction } : {},
  );
  res.cookie(ACCESS_COOKIE, accessJwt, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_MS,
  });
  res.cookie(REFRESH_COOKIE, rawRefresh, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: REFRESH_TTL_MS,
  });
}

function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

async function revokeAllUserRefreshTokens(userId) {
  await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { userId, revokedAt: null }, hooks: false },
  );
}

module.exports = {
  JWT_SECRET,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CHALLENGE_COOKIE,
  ACCESS_TTL_MS,
  REFRESH_TTL_MS,
  CHALLENGE_TTL_MS,
  COOKIE_SECURE,
  generateRawToken,
  hashToken,
  createAccessToken,
  setAuthCookies,
  clearAuthCookies,
  revokeAllUserRefreshTokens,
};
