const logger = require('./logger');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.EMAIL_FROM || 'Bantryx <onboarding@resend.dev>';

let resendClient = null;
if (RESEND_API_KEY) {
  try {
    const { Resend } = require('resend');
    resendClient = new Resend(RESEND_API_KEY);
    logger.info('Resend email transport configured.');
  } catch (err) {
    logger.warn(
      { err: err.message },
      'RESEND_API_KEY set but resend package failed to load — falling back to log-only',
    );
  }
} else {
  logger.info('No RESEND_API_KEY set — email send() will log payloads instead of dispatching.');
}

async function send({ to, subject, html, text, attachments }) {
  if (!to || !subject) {
    logger.warn({ to, subject }, 'email send() missing to/subject — skipping');
    return { delivered: false, reason: 'invalid payload' };
  }
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (!resendClient) {
    // Log filenames only — never the (potentially large, base64/Buffer)
    // attachment content.
    logger.info(
      {
        to,
        subject,
        text,
        attachments: hasAttachments ? attachments.map((a) => a.filename) : undefined,
      },
      'email (dev log mode — no transport configured)',
    );
    return { delivered: false, reason: 'no transport' };
  }
  try {
    const payload = { from: FROM_ADDRESS, to, subject, html, text };
    // Resend accepts attachments: [{ filename, content }] where content is a
    // Buffer or base64 string. Only set the key when present so existing
    // non-attachment sends are unchanged on the wire.
    if (hasAttachments) payload.attachments = attachments;
    const result = await resendClient.emails.send(payload);
    // Resend SDK v4+ returns { data, error } — it does NOT throw on API
    // errors. Without this check, a 4xx (wrong domain, wrong key scope,
    // recipient blocked, etc.) silently logs as 'email sent' with no id.
    if (result?.error) {
      logger.error(
        { err: result.error, to, subject, from: FROM_ADDRESS },
        'email send rejected by Resend',
      );
      return { delivered: false, reason: result.error?.message || 'resend rejected' };
    }
    if (!result?.data?.id) {
      logger.warn({ result, to, subject }, 'email send returned no id — treating as failure');
      return { delivered: false, reason: 'no id returned' };
    }
    logger.info({ to, subject, id: result.data.id }, 'email sent');
    return { delivered: true, id: result.data.id };
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'email send failed');
    return { delivered: false, reason: 'send failed' };
  }
}

module.exports = { send };
