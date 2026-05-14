'use strict';

// Tier 13 Chunk 1 — sendVerificationEmail extracted from server.js. Uses the
// pluggable transport in lib/email.js (Resend or log-only fallback).
const email = require('./email');
const { generateRawToken, hashToken } = require('./auth');
const { EmailVerificationToken } = require('../models');

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;

async function sendVerificationEmail(user) {
  if (!user?.email) return;
  const raw = generateRawToken();
  await EmailVerificationToken.create({
    userId: user.id,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const link = `${PUBLIC_APP_URL}/?verifyToken=${raw}`;
  await email.send({
    to: user.email,
    subject: 'Verify your Bantryx email',
    text: `Welcome to Bantryx, ${user.username}.\n\nConfirm your email by opening this link:\n${link}\n\nThe link expires in 24 hours.`,
    html: `<p>Welcome to Bantryx, ${user.username}.</p><p>Confirm your email by opening this link:</p><p><a href="${link}">${link}</a></p><p>The link expires in 24 hours.</p>`,
  });
}

module.exports = { sendVerificationEmail, PUBLIC_APP_URL };
