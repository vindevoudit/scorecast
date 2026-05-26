'use strict';

// Tier 13 Chunk 1 — current-user routes extracted from server.js. Covers
// /me, /me/2fa/{setup,confirm,disable}, and /me/email. All require auth.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

const { validate } = require('../validation/middleware');
const {
  setEmailSchema,
  setPasswordSchema,
  totpSetupSchema,
  totpConfirmSchema,
  totpVerifySchema,
  editProfileSchema,
  pushPreferencesSchema,
  acceptTermsSchema,
  CURRENT_TERMS_VERSION,
} = require('../validation/schemas');
const { authMiddleware } = require('../middleware/auth');
const { getUserById } = require('../lib/users');
const { getJoinedGroupIds, getPendingInvites } = require('../lib/groups');
const { sendVerificationEmail, PUBLIC_APP_URL } = require('../lib/emailHelpers');
const { setAuthCookies, revokeAllUserRefreshTokens } = require('../lib/auth');
const email = require('../lib/email');
const { User, sequelize } = require('../models');
const LeaderboardService = require('../services/LeaderboardService');
const PushService = require('../services/PushService');

const router = express.Router();

router.get('/me', authMiddleware, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const joinedGroups = await getJoinedGroupIds(user.id);
  const pendingInvites = await getPendingInvites(user.id);
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName || null,
    bio: user.bio || null,
    email: user.email || null,
    emailVerifiedAt: user.emailVerifiedAt || null,
    twoFactorEnabled: Boolean(user.totpEnabledAt),
    // Tier 11 Chunk 4 — null on first sign-in, set when the user finishes
    // or skips the onboarding tour. Frontend reads this to decide whether
    // to mount <OnboardingTour />.
    onboardingCompletedAt: user.onboardingCompletedAt || null,
    // Tier 18 Chunk 6 — terms acceptance. Frontend mounts a blocking
    // <TermsAcceptanceModal /> when termsAcceptedVersion is missing or
    // lower than the current version baked into the bundle.
    termsAcceptedAt: user.termsAcceptedAt || null,
    termsAcceptedVersion: user.termsAcceptedVersion || null,
    // Tier 8.6 — Settings tab renders a radio bound to this value.
    profileVisibility: user.profileVisibility,
    // PWA Chunk 4 — JSONB map of notification-type → boolean. Absent or
    // true = deliver; only false opts out. PushSettingsPanel (Chunk 5)
    // renders one checkbox per known type seeded against this object.
    pushPreferences: user.pushPreferences || {},
    joinedGroups,
    pendingInvites,
  });
});

// PWA Chunk 4 — partial update to users.pushPreferences. The PushService
// merges with existing JSONB rather than replacing, so a PUT { prefs:
// { 'odds-shifted': false } } only flips that one type without clobbering
// the others.
router.put(
  '/me/push-preferences',
  authMiddleware,
  validate(pushPreferencesSchema),
  async (req, res) => {
    try {
      const next = await PushService.updatePreferences(req.user.id, req.body.prefs);
      if (!next) return res.status(404).json({ error: 'User not found' });
      res.json({ pushPreferences: next });
    } catch (error) {
      req.log.error({ err: error.message }, 'push-preferences update failed');
      res.status(500).json({ error: 'Failed to update push preferences' });
    }
  },
);

// Tier 11 Chunk 4 — Marks the onboarding tour as completed (either finished
// or skipped). Idempotent: if already set, the existing timestamp is
// preserved. No body — the timestamp is server-generated.
router.post('/me/onboarding-completed', authMiddleware, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.onboardingCompletedAt) {
      user.onboardingCompletedAt = new Date();
      await user.save({ hooks: false });
    }
    res.json({ onboardingCompletedAt: user.onboardingCompletedAt });
  } catch (error) {
    req.log.error({ err: error.message }, 'onboarding-completed failed');
    res.status(500).json({ error: 'Failed to update onboarding state' });
  }
});

// Tier 18 Chunk 6 — Records that the user has accepted the current Terms +
// Privacy Policy. The client posts the version it just rendered; the server
// rejects mismatches so a stale tab can't accept a prior version. Stamps a
// fresh timestamp on every successful acceptance so we can tell when the
// user agreed to THIS version, not the previous one.
router.post('/me/accept-terms', authMiddleware, validate(acceptTermsSchema), async (req, res) => {
  if (req.body.version !== CURRENT_TERMS_VERSION) {
    return res.status(400).json({ error: 'Terms version is out of date — please reload' });
  }
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.termsAcceptedAt = new Date();
    user.termsAcceptedVersion = CURRENT_TERMS_VERSION;
    await user.save({ hooks: false });
    res.json({
      termsAcceptedAt: user.termsAcceptedAt,
      termsAcceptedVersion: user.termsAcceptedVersion,
    });
  } catch (error) {
    req.log.error({ err: error.message }, 'accept-terms failed');
    res.status(500).json({ error: 'Failed to record terms acceptance' });
  }
});

router.put('/me', authMiddleware, validate(editProfileSchema), async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Track whether a cached leaderboard field changed so we can invalidate
    // the 30-s cache. Tier 8.6 — profileVisibility joins displayName as a
    // cached field; without invalidation, the masking layer would project
    // off the stale visibility value for up to 30 s after a settings change.
    let cachedFieldChanged = false;
    if (req.body.displayName !== undefined) {
      const next = req.body.displayName === '' ? null : req.body.displayName;
      if (next !== user.displayName) cachedFieldChanged = true;
      user.displayName = next;
    }
    if (req.body.bio !== undefined) {
      user.bio = req.body.bio === '' ? null : req.body.bio;
    }
    if (req.body.profileVisibility !== undefined) {
      if (req.body.profileVisibility !== user.profileVisibility) cachedFieldChanged = true;
      user.profileVisibility = req.body.profileVisibility;
    }
    await user.save({ hooks: false });
    if (cachedFieldChanged) LeaderboardService.invalidate('all');
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      bio: user.bio,
      profileVisibility: user.profileVisibility,
    });
  } catch (error) {
    req.log.error({ err: error }, 'handler error');
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.post('/me/2fa/setup', authMiddleware, validate(totpSetupSchema), async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.totpEnabledAt) {
      return res
        .status(400)
        .json({ error: '2FA is already enabled — disable it first to regenerate' });
    }
    // Password re-auth so a stolen 15-min access JWT alone can't enable 2FA
    // and lock the victim out of their own account.
    const passwordValid = await bcrypt.compare(req.body.currentPassword, user.password);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const secret = speakeasy.generateSecret({ name: `Bantryx:${user.username}`, length: 20 });
    const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url);
    const recoveryCodes = Array.from({ length: 10 }, () => {
      const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
      return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    });
    const hashedRecoveryCodes = await Promise.all(recoveryCodes.map((c) => bcrypt.hash(c, 8)));
    user.totpSecret = secret.base32;
    user.totpEnabledAt = null;
    user.totpRecoveryCodes = hashedRecoveryCodes;
    await user.save({ hooks: false });
    res.json({ qrCodeDataUrl, secret: secret.base32, recoveryCodes });
  } catch (error) {
    req.log.error({ err: error.message }, '2fa setup failed');
    res.status(500).json({ error: '2FA setup failed' });
  }
});

router.post('/me/2fa/confirm', authMiddleware, validate(totpConfirmSchema), async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user || !user.totpSecret) {
      return res.status(400).json({ error: 'No pending 2FA setup' });
    }
    if (user.totpEnabledAt) {
      return res.status(400).json({ error: '2FA already enabled' });
    }
    const valid = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: req.body.code,
      window: 1,
    });
    if (!valid)
      return res
        .status(400)
        .json({ error: 'Code did not match — try the next one in your authenticator' });
    user.totpEnabledAt = new Date();
    await user.save({ hooks: false });
    res.json({ ok: true, totpEnabledAt: user.totpEnabledAt });
  } catch (error) {
    req.log.error({ err: error.message }, '2fa confirm failed');
    res.status(500).json({ error: '2FA confirm failed' });
  }
});

router.post('/me/2fa/disable', authMiddleware, validate(totpVerifySchema), async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user || !user.totpEnabledAt) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }
    const { code, recoveryCode } = req.body;
    let valid = false;
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
      // Run every bcrypt.compare in parallel rather than early-exit so the
      // total latency doesn't leak whether the match was first or last in
      // the list (mirrors /auth/2fa/verify).
      const matches = await Promise.all(codes.map((hash) => bcrypt.compare(normalized, hash)));
      if (matches.some(Boolean)) valid = true;
    }
    if (!valid) return res.status(400).json({ error: 'Code did not match' });
    user.totpSecret = null;
    user.totpEnabledAt = null;
    user.totpRecoveryCodes = null;
    await user.save({ hooks: false });
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error.message }, '2fa disable failed');
    res.status(500).json({ error: '2FA disable failed' });
  }
});

router.post('/me/password', authMiddleware, validate(setPasswordSchema), async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const passwordValid = await bcrypt.compare(currentPassword, user.password);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (currentPassword === newPassword) {
      return res
        .status(400)
        .json({ error: 'New password must be different from current password' });
    }
    user.password = newPassword;
    // Save WITH hooks so beforeUpdate re-hashes — mirrors reset-password.
    await user.save();
    // Mirror reset-password's force-logout-everywhere semantics, then issue
    // fresh cookies for the current session so the calling client stays
    // signed in but every other refresh-token-bearing device is kicked out.
    await revokeAllUserRefreshTokens(user.id);
    await setAuthCookies(res, user, { userAgent: req.headers['user-agent'] });
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error.message }, 'set-password failed');
    res.status(500).json({ error: 'Failed to change password' });
  }
});

router.patch('/me/email', authMiddleware, validate(setEmailSchema), async (req, res) => {
  const { email: emailAddress, currentPassword } = req.body;
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Password re-auth so a stolen access JWT alone can't pivot a brief
    // cookie compromise into permanent account takeover (change email →
    // verify → forgot-password → reset).
    const passwordValid = await bcrypt.compare(currentPassword, user.password);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const existing = await User.findOne({
      where: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), emailAddress),
    });
    if (existing && existing.id !== user.id) {
      return res.status(400).json({ error: 'That email is already in use' });
    }
    const oldEmail = user.email;
    user.email = emailAddress;
    user.emailVerifiedAt = null;
    await user.save({ hooks: false });
    // Notify the OLD address before sending the verify-new-email so the
    // victim has a window to detect an unauthorized change. Fire-and-forget
    // — a failed notification must not block the legitimate request.
    if (oldEmail) {
      email
        .send({
          to: oldEmail,
          subject: 'Your Bantryx email address was changed',
          text: `The email address on your Bantryx account was just changed. If this was you, you can ignore this message.\n\nIf you did NOT make this change, reset your password immediately: ${PUBLIC_APP_URL}/\n\n— Bantryx`,
          html: `<p>The email address on your Bantryx account was just changed. If this was you, you can ignore this message.</p><p>If you did <b>not</b> make this change, <a href="${PUBLIC_APP_URL}/">reset your password immediately</a>.</p><p>— Bantryx</p>`,
        })
        .catch((err) => {
          req.log.warn(
            { err: err.message, userId: user.id },
            'failed to send email-change notification to old address',
          );
        });
    }
    sendVerificationEmail(user).catch((err) => {
      req.log.warn({ err: err.message, userId: user.id }, 'failed to send verification email');
    });
    res.json({ email: user.email, emailVerifiedAt: null });
  } catch (error) {
    req.log.error({ err: error.message }, 'set-email failed');
    res.status(500).json({ error: 'Failed to set email' });
  }
});

module.exports = router;
