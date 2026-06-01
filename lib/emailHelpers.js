'use strict';

// Tier 13 Chunk 1 — sendVerificationEmail extracted from server.js. Uses the
// pluggable transport in lib/email.js (Resend or log-only fallback). Branded
// HTML + plaintext rendering lives in lib/emailTemplates.js so the verify
// and password-reset emails stay visually consistent.
const email = require('./email');
const logger = require('./logger');
const { generateRawToken, hashToken } = require('./auth');
const {
  buildVerifyOnRegisterEmail,
  buildVerifyForPasswordResetEmail,
} = require('./emailTemplates');
const { EmailVerificationToken, User } = require('../models');

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;

async function sendVerificationEmail(user, { reason = 'register' } = {}) {
  if (!user?.email) return;
  const raw = generateRawToken();
  await EmailVerificationToken.create({
    userId: user.id,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const link = `${PUBLIC_APP_URL}/?verifyToken=${raw}`;

  const payload =
    reason === 'password-reset'
      ? buildVerifyForPasswordResetEmail({ username: user.username, link })
      : buildVerifyOnRegisterEmail({ username: user.username, link });

  await email.send({ to: user.email, ...payload });

  // Phase 0 P0-4 — stamp lastVerificationSentAt so UI can surface
  // observability. Failure here is non-fatal — the email itself already
  // sent (or, in dev with no transport, was logged); the timestamp is
  // diagnostic metadata, not consent state.
  try {
    await User.update(
      { lastVerificationSentAt: new Date() },
      { where: { id: user.id }, hooks: false },
    );
  } catch (err) {
    logger.warn(
      { err, userId: user.id },
      'failed to stamp lastVerificationSentAt after sendVerificationEmail',
    );
  }
}

module.exports = { sendVerificationEmail, PUBLIC_APP_URL };
