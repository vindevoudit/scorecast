const logger = require('./logger');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.EMAIL_FROM || 'ScoreCast <onboarding@resend.dev>';

let resendClient = null;
if (RESEND_API_KEY) {
  try {
    const { Resend } = require('resend');
    resendClient = new Resend(RESEND_API_KEY);
    logger.info('Resend email transport configured.');
  } catch (err) {
    logger.warn({ err: err.message }, 'RESEND_API_KEY set but resend package failed to load — falling back to log-only');
  }
} else {
  logger.info('No RESEND_API_KEY set — email send() will log payloads instead of dispatching.');
}

async function send({ to, subject, html, text }) {
  if (!to || !subject) {
    logger.warn({ to, subject }, 'email send() missing to/subject — skipping');
    return { delivered: false, reason: 'invalid payload' };
  }
  if (!resendClient) {
    logger.info({ to, subject, text }, 'email (dev log mode — no transport configured)');
    return { delivered: false, reason: 'no transport' };
  }
  try {
    const result = await resendClient.emails.send({ from: FROM_ADDRESS, to, subject, html, text });
    logger.info({ to, subject, id: result?.data?.id }, 'email sent');
    return { delivered: true, id: result?.data?.id };
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'email send failed');
    return { delivered: false, reason: 'send failed' };
  }
}

module.exports = { send };
