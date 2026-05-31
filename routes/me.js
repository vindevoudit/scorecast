'use strict';

// Tier 13 Chunk 1 — current-user routes extracted from server.js. Covers
// /me, /me/email, /me/password. All require auth.
//
// Tier 22 — 2FA setup/confirm/disable handlers were removed. See routes/auth.js
// header for the revival recipe.
const express = require('express');
const bcrypt = require('bcryptjs');

const { validate } = require('../validation/middleware');
const {
  setEmailSchema,
  setPasswordSchema,
  editProfileSchema,
  pushPreferencesSchema,
  acceptTermsSchema,
  CURRENT_TERMS_VERSION,
} = require('../validation/schemas');
const { authMiddleware } = require('../middleware/auth');
const { sensitiveAccountLimiter, lightWriteLimiter } = require('../middleware/rateLimit');
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
    // Phase 0 P0-4 — verification-email observability. Frontend renders
    // "Sent N min ago" + a [Resend] CTA when emailVerifiedAt is null.
    lastVerificationSentAt: user.lastVerificationSentAt || null,
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
    // Tier 30 Phase 3 A1 — Pick-streak state. Frontend renders a flame
    // chip next to the user identity in the top bar; brightness tiers at
    // 7 / 14 / 30. `longest` powers the "Personal best" copy in the
    // Profile view.
    streak: {
      current: user.currentDailyStreak || 0,
      longest: user.longestDailyStreak || 0,
    },
    joinedGroups,
    pendingInvites,
  });
});

// Phase 0 P0-4 — user-initiated verification email resend. Rate-limited
// (sensitiveAccountLimiter — 10/hr/IP, matches /me/password + /me/email)
// so a stuck UI loop can't drown the email transport. No-op silently when
// the user is already verified (don't reveal verification state via
// response code variation — the front end gates the button on the same
// emailVerifiedAt that GET /me returns).
router.post(
  '/me/resend-verification',
  sensitiveAccountLimiter,
  authMiddleware,
  async (req, res) => {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.emailVerifiedAt) {
      // Idempotent + intentionally silent — verified users can't trigger
      // a fresh token; surface a 200 so the UI doesn't blow up on a stale
      // tab whose state lags behind a verify that just happened.
      return res.status(200).json({ sent: false, alreadyVerified: true });
    }
    try {
      await sendVerificationEmail(user);
      const refreshed = await getUserById(user.id);
      return res.status(200).json({
        sent: true,
        lastVerificationSentAt: refreshed.lastVerificationSentAt || null,
      });
    } catch (err) {
      req.log.error(
        { err: err.message, userId: user.id },
        'resend-verification: failed to send verification email',
      );
      return res.status(502).json({ error: 'Failed to send verification email' });
    }
  },
);

// PWA Chunk 4 — partial update to users.pushPreferences. The PushService
// merges with existing JSONB rather than replacing, so a PUT { prefs:
// { 'odds-shifted': false } } only flips that one type without clobbering
// the others.
router.put(
  '/me/push-preferences',
  lightWriteLimiter,
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
router.post('/me/onboarding-completed', lightWriteLimiter, authMiddleware, async (req, res) => {
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
router.post(
  '/me/accept-terms',
  lightWriteLimiter,
  authMiddleware,
  validate(acceptTermsSchema),
  async (req, res) => {
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
  },
);

router.put(
  '/me',
  lightWriteLimiter,
  authMiddleware,
  validate(editProfileSchema),
  async (req, res) => {
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
  },
);

router.post(
  '/me/password',
  sensitiveAccountLimiter,
  authMiddleware,
  validate(setPasswordSchema),
  async (req, res) => {
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
  },
);

router.patch(
  '/me/email',
  sensitiveAccountLimiter,
  authMiddleware,
  validate(setEmailSchema),
  async (req, res) => {
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
  },
);

module.exports = router;
