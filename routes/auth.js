'use strict';

// Tier 13 Chunk 1 — auth + session routes extracted from server.js. Covers
// register, login (with optional 2FA challenge issuance), email verification,
// password reset, refresh-token rotation, logout, and 2FA verification.
//
// CSRF exempt list in middleware/csrf.js already covers /api/login,
// /api/register, /api/auth/refresh, /api/auth/verify-email,
// /api/auth/forgot-password, /api/auth/reset-password.
//
// Tier 6.6 lockout, Tier 6.8 rotating refresh, Tier 6.9 2FA challenge cookie:
// all invariants preserved.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const { Op } = require('sequelize');

const { validate } = require('../validation/middleware');
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  totpVerifySchema,
} = require('../validation/schemas');
const { loginLimiter, registerLimiter, forgotPasswordLimiter } = require('../middleware/rateLimit');
const {
  JWT_SECRET,
  REFRESH_COOKIE,
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_MS,
  COOKIE_SECURE,
  generateRawToken,
  hashToken,
  setAuthCookies,
  clearAuthCookies,
  revokeAllUserRefreshTokens,
} = require('../lib/auth');
const { sendVerificationEmail, PUBLIC_APP_URL } = require('../lib/emailHelpers');
const { getUserByUsername } = require('../lib/users');
const email = require('../lib/email');
const {
  User,
  EmailVerificationToken,
  PasswordResetToken,
  RefreshToken,
  sequelize,
} = require('../models');

const router = express.Router();

router.post('/register', registerLimiter, validate(registerSchema), async (req, res) => {
  const { username, password, email: emailAddress } = req.body;

  const existingUser = await getUserByUsername(username);
  if (existingUser) {
    return res.status(400).json({ error: 'That username is already taken' });
  }

  const existingEmail = await User.findOne({
    where: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), emailAddress),
  });
  if (existingEmail) {
    return res.status(400).json({ error: 'That email is already in use' });
  }

  try {
    const newUser = await User.create({ username, password, email: emailAddress });
    sendVerificationEmail(newUser).catch((err) => {
      req.log.warn({ err: err.message, userId: newUser.id }, 'failed to send verification email');
    });
    await setAuthCookies(res, newUser, { userAgent: req.headers['user-agent'] });
    res.json({ user: { id: newUser.id, username: newUser.username } });
  } catch (error) {
    req.log.error({ err: error.message }, 'registration failed');
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const { username, password } = req.body;
  const user = await getUserByUsername(username);

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user || !(await bcrypt.compare(password, user.password))) {
    if (user) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await user.save({ hooks: false });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.loginAttempts > 0 || user.lockedUntil) {
    user.loginAttempts = 0;
    user.lockedUntil = null;
    await user.save({ hooks: false });
  }

  if (user.totpEnabledAt) {
    const challengeJwt = jwt.sign({ id: user.id, type: '2fa-pending' }, JWT_SECRET, {
      expiresIn: Math.floor(CHALLENGE_TTL_MS / 1000),
    });
    res.cookie(CHALLENGE_COOKIE, challengeJwt, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: CHALLENGE_TTL_MS,
    });
    return res.json({ challenge: true });
  }

  await setAuthCookies(res, user, { userAgent: req.headers['user-agent'] });
  res.json({ user: { id: user.id, username: user.username } });
});

router.post('/auth/verify-email', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token || token.length < 20 || token.length > 200) {
    return res.status(400).json({ error: 'Invalid token' });
  }
  try {
    const row = await EmailVerificationToken.findOne({
      where: {
        tokenHash: hashToken(token),
        consumedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
    });
    if (!row) return res.status(400).json({ error: 'Token is invalid or expired' });
    const user = await User.findByPk(row.userId);
    if (!user) return res.status(400).json({ error: 'Token is invalid or expired' });
    user.emailVerifiedAt = new Date();
    await user.save({ hooks: false });
    row.consumedAt = new Date();
    await row.save({ hooks: false });
    res.json({ ok: true, email: user.email });
  } catch (error) {
    req.log.error({ err: error.message }, 'verify-email failed');
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post(
  '/auth/forgot-password',
  forgotPasswordLimiter,
  validate(forgotPasswordSchema),
  async (req, res) => {
    const { email: emailAddress } = req.body;
    try {
      const user = await User.findOne({
        where: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), emailAddress),
      });
      if (user && user.emailVerifiedAt) {
        const raw = generateRawToken();
        await PasswordResetToken.create({
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        });
        const link = `${PUBLIC_APP_URL}/?resetToken=${raw}`;
        email
          .send({
            to: user.email,
            subject: 'Reset your Bantryx password',
            text: `Open this link to reset your password:\n${link}\n\nThe link expires in 15 minutes. If you didn't request this, ignore this email.`,
            html: `<p>Open this link to reset your password:</p><p><a href="${link}">${link}</a></p><p>The link expires in 15 minutes. If you didn't request this, ignore this email.</p>`,
          })
          .catch((err) => {
            req.log.warn({ err: err.message, userId: user.id }, 'failed to send reset email');
          });
      }
    } catch (error) {
      req.log.error({ err: error.message }, 'forgot-password failed');
    }
    res.status(204).end();
  },
);

router.post('/auth/reset-password', validate(resetPasswordSchema), async (req, res) => {
  const { token, password } = req.body;
  try {
    const row = await PasswordResetToken.findOne({
      where: {
        tokenHash: hashToken(token),
        consumedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
    });
    if (!row) return res.status(400).json({ error: 'Token is invalid or expired' });
    const user = await User.findByPk(row.userId);
    if (!user) return res.status(400).json({ error: 'Token is invalid or expired' });
    user.password = password;
    await user.save();
    row.consumedAt = new Date();
    await row.save({ hooks: false });
    user.loginAttempts = 0;
    user.lockedUntil = null;
    await user.save({ hooks: false });
    await revokeAllUserRefreshTokens(user.id);
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error.message }, 'reset-password failed');
    res.status(500).json({ error: 'Password reset failed' });
  }
});

router.post('/auth/refresh', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'No refresh token' });
  }
  try {
    const row = await RefreshToken.findOne({
      where: {
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        revokedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
    });
    if (!row) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Refresh token invalid or expired' });
    }
    const user = await User.findByPk(row.userId);
    if (!user) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'User not found' });
    }
    row.revokedAt = new Date();
    await row.save({ hooks: false });
    await setAuthCookies(res, user, { userAgent: req.headers['user-agent'] });
    res.status(204).end();
  } catch (error) {
    req.log.error({ err: error.message }, 'refresh failed');
    clearAuthCookies(res);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

router.post('/auth/logout', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (raw) {
    try {
      const row = await RefreshToken.findOne({
        where: {
          tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
          revokedAt: null,
        },
      });
      if (row) {
        row.revokedAt = new Date();
        await row.save({ hooks: false });
      }
    } catch (error) {
      req.log.warn({ err: error.message }, 'logout refresh-revoke failed');
    }
  }
  clearAuthCookies(res);
  res.status(204).end();
});

router.post('/auth/2fa/verify', validate(totpVerifySchema), async (req, res) => {
  const challengeToken = req.cookies?.[CHALLENGE_COOKIE];
  if (!challengeToken) {
    return res.status(401).json({ error: 'No 2FA challenge in progress' });
  }
  let payload;
  try {
    payload = jwt.verify(challengeToken, JWT_SECRET);
    if (payload?.type !== '2fa-pending') throw new Error('not a challenge');
  } catch (_) {
    res.clearCookie(CHALLENGE_COOKIE, { path: '/api/auth' });
    return res.status(401).json({ error: 'Challenge invalid or expired' });
  }
  try {
    const user = await User.findByPk(payload.id);
    if (!user || !user.totpEnabledAt || !user.totpSecret) {
      res.clearCookie(CHALLENGE_COOKIE, { path: '/api/auth' });
      return res.status(400).json({ error: 'No 2FA enabled' });
    }
    const { code, recoveryCode } = req.body;
    let valid = false;
    let usedRecoveryIndex = -1;
    if (typeof code === 'string') {
      valid = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: 'base32',
        token: code,
        window: 1,
      });
    } else if (typeof recoveryCode === 'string') {
      const normalized = recoveryCode.trim().toUpperCase();
      const codes = Array.isArray(user.totpRecoveryCodes) ? user.totpRecoveryCodes : [];
      for (let i = 0; i < codes.length; i++) {
        if (await bcrypt.compare(normalized, codes[i])) {
          valid = true;
          usedRecoveryIndex = i;
          break;
        }
      }
    }
    if (!valid) return res.status(400).json({ error: 'Code did not match' });
    if (usedRecoveryIndex >= 0) {
      const codes = [...user.totpRecoveryCodes];
      codes.splice(usedRecoveryIndex, 1);
      user.totpRecoveryCodes = codes;
      await user.save({ hooks: false });
    }
    res.clearCookie(CHALLENGE_COOKIE, { path: '/api/auth' });
    await setAuthCookies(res, user, { userAgent: req.headers['user-agent'] });
    res.json({ user: { id: user.id, username: user.username } });
  } catch (error) {
    req.log.error({ err: error.message }, '2fa verify failed');
    res.status(500).json({ error: '2FA verification failed' });
  }
});

module.exports = router;
