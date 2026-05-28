'use strict';

// Tier 13 Chunk 1 — auth + session routes extracted from server.js. Covers
// register, login, email verification, password reset, refresh-token
// rotation, and logout.
//
// CSRF exempt list in middleware/csrf.js already covers /api/login,
// /api/register, /api/auth/refresh, /api/auth/verify-email,
// /api/auth/forgot-password, /api/auth/reset-password.
//
// Tier 6.6 lockout + Tier 6.8 rotating refresh invariants preserved.
//
// Tier 22 — 2FA was parked for the marketing launch window. The user model
// fields (totpSecret / totpEnabledAt / totpRecoveryCodes), the
// CHALLENGE_COOKIE constants in lib/auth.js, and the migration history are
// all intact so a future `git revert` of the removal commit restores 2FA
// end-to-end without a schema change. Audit `users.totpEnabledAt != null`
// before revival to decide whether to enforce 2FA for those users
// immediately or wipe the columns and treat everyone as opt-in. (Note: the
// earlier `20260514000001-disable-all-2fa.js` migration already cleared the
// columns for every existing user, so a fresh revival starts from a clean
// slate today.)
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');

const { validate } = require('../validation/middleware');
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require('../validation/schemas');
const { loginLimiter, registerLimiter, forgotPasswordLimiter } = require('../middleware/rateLimit');
const {
  REFRESH_COOKIE,
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

// Pre-computed bcrypt hash used as a dummy when the requested username
// doesn't exist. Without this, bcrypt.compare would be skipped for unknown
// users — making login response time enumerable (~5ms vs ~50ms for an
// existing-but-wrong-password). Generated at boot from a random secret so
// the hash itself is never of interest to attackers.
const LOGIN_DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);

router.post('/register', registerLimiter, validate(registerSchema), async (req, res) => {
  const { username, password, email: emailAddress, acceptedTermsVersion } = req.body;

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
    // Tier 18 Chunk 6 — stamp terms acceptance at create so new users
    // never see the blocking TermsAcceptanceModal on first dashboard load.
    // Schema already gated on the literal `true` + current version.
    const newUser = await User.create({
      username,
      password,
      email: emailAddress,
      termsAcceptedAt: new Date(),
      termsAcceptedVersion: acceptedTermsVersion,
    });
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

  // Always run bcrypt.compare against either the real hash or LOGIN_DUMMY_HASH
  // so response time is constant regardless of whether the username exists.
  // Otherwise an attacker can enumerate the user base via timing.
  const passwordValid = await bcrypt.compare(password, user?.password ?? LOGIN_DUMMY_HASH);

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user || !passwordValid) {
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
    let user = null;
    try {
      user = await User.findOne({
        where: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), emailAddress),
      });
    } catch (error) {
      req.log.error({ err: error.message }, 'forgot-password lookup failed');
    }

    // Always 204 immediately. Token creation + email send + verification
    // re-send all happen asynchronously so the response timing is dominated
    // only by the email lookup (which runs in all three branches) — without
    // this, the verified branch's PasswordResetToken.create gives away a
    // timing oracle for "exists + verified" vs the other two cases, defeating
    // the 204-everywhere anti-enumeration property.
    res.status(204).end();

    if (!user) return;

    setImmediate(async () => {
      try {
        if (user.emailVerifiedAt) {
          const raw = generateRawToken();
          await PasswordResetToken.create({
            userId: user.id,
            tokenHash: hashToken(raw),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          });
          const link = `${PUBLIC_APP_URL}/?resetToken=${raw}`;
          await email.send({
            to: user.email,
            subject: 'Reset your Bantryx password',
            text: `Open this link to reset your password:\n${link}\n\nThe link expires in 15 minutes. If you didn't request this, ignore this email.`,
            html: `<p>Open this link to reset your password:</p><p><a href="${link}">${link}</a></p><p>The link expires in 15 minutes. If you didn't request this, ignore this email.</p>`,
          });
        } else {
          // Unverified user hit forgot-password — resend the verify email
          // with password-reset copy so they aren't stuck in a dead-end.
          await sendVerificationEmail(user, { reason: 'password-reset' });
        }
      } catch (err) {
        req.log.warn(
          { err: err.message, userId: user.id },
          'forgot-password background work failed',
        );
      }
    });
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

module.exports = router;
