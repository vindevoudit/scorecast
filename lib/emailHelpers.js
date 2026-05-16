'use strict';

// Tier 13 Chunk 1 — sendVerificationEmail extracted from server.js. Uses the
// pluggable transport in lib/email.js (Resend or log-only fallback).
const email = require('./email');
const { generateRawToken, hashToken } = require('./auth');
const { EmailVerificationToken } = require('../models');

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

  if (reason === 'password-reset') {
    await email.send({
      to: user.email,
      subject: 'Verify your Bantryx email to reset your password',
      text: `Hi ${user.username},\n\nYou requested a password reset, but your email isn't verified yet. Please verify your email first by opening this link:\n${link}\n\nThe link expires in 24 hours.\n\nOnce verified, return to Bantryx and request the password reset again — we'll then send the reset link.`,
      html: `<p>Hi ${user.username},</p><p>You requested a password reset, but your email isn't verified yet. Please verify your email first by opening this link:</p><p><a href="${link}">${link}</a></p><p>The link expires in 24 hours.</p><p><strong>Once verified, return to Bantryx and request the password reset again</strong> — we'll then send the reset link.</p>`,
    });
    return;
  }

  await email.send({
    to: user.email,
    subject: 'Verify your Bantryx email',
    text: `Welcome to Bantryx, ${user.username}.\n\nConfirm your email by opening this link:\n${link}\n\nThe link expires in 24 hours.`,
    html: `<p>Welcome to Bantryx, ${user.username}.</p><p>Confirm your email by opening this link:</p><p><a href="${link}">${link}</a></p><p>The link expires in 24 hours.</p>`,
  });
}

module.exports = { sendVerificationEmail, PUBLIC_APP_URL };
