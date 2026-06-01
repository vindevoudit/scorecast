'use strict';

// Branded HTML + plaintext email templates for the verify-email and
// password-reset flows. All three emails share `renderBrandedEmail` so the
// chrome (wordmark, accent stripe, CTA shape, footer) stays in sync.
//
// Design choices that aren't obvious from reading the markup:
//
// - Dark navy background matches the Bantryx app shell, so the email reads as
//   "from the same product" rather than a generic transactional template.
//   Email clients that auto-darken (Gmail mobile, Outlook) leave already-dark
//   emails alone — the inversion bug that mangles light templates doesn't fire.
// - Layout is table-based for Outlook compatibility. Outlook's word engine
//   ignores flex/grid; tables render consistently from Outlook 2007 → 365 web.
// - 600px content width. Anything wider triggers horizontal scroll in Outlook
//   desktop and most mobile preview panes.
// - Inline styles only. <style> blocks survive Gmail web but are stripped by
//   Outlook desktop + Yahoo. Inlining is the lowest-common-denominator.
// - CTA is an <a> styled as a button inside a colored <td>; the bg-color on
//   the td covers Outlook 2007-2010 which strips background on <a>.
// - Raw URL is printed below the button as visible text. Two reasons:
//     (1) Anti-phishing trust signal — users can verify the link before
//         clicking. The previous "click here" pattern looked spammy.
//     (2) Some corporate mail filters strip <a href> entirely; the raw URL
//         is the only path to action for those recipients.
// - Preheader span pushes Gmail's snippet-from-body fallback off the first
//   couple of words of the lead paragraph. Without it, Gmail shows
//   "If you didn't request this, ignore" as the inbox preview.
// - The username is HTML-escaped defensively even though noProfanity + the
//   username regex constrain it to ~[A-Za-z0-9_]. Cheap insurance.

const APP_NAME = 'Bantryx';
const APP_HOST = 'bantryx.com';
const SUPPORT_LINE = `If you didn't request this, you can safely ignore this email.`;

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBrandedEmail({
  preheader,
  heading,
  greeting,
  leadHtml,
  leadText,
  ctaLabel,
  ctaUrl,
  expiresIn,
}) {
  const safeHeading = escapeHtml(heading);
  const safeGreeting = greeting ? escapeHtml(greeting) : '';
  const safeCtaLabel = escapeHtml(ctaLabel);
  const safeUrl = escapeHtml(ctaUrl);
  const safePreheader = escapeHtml(preheader);
  const expiresLine = expiresIn
    ? `<p style="margin: 0 0 8px; font-size: 13px; line-height: 1.6; color: #94a3b8;">This link expires in <strong style="color: #cbd5e1;">${escapeHtml(expiresIn)}</strong>.</p>`
    : '';
  const expiresText = expiresIn ? `\nThis link expires in ${expiresIn}.\n` : '';

  const html = `<!DOCTYPE html>
<html lang="en" style="margin:0; padding:0;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>${safeHeading}</title>
</head>
<body style="margin:0; padding:0; background-color:#020617; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#e2e8f0;">
  <span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all;">
    ${safePreheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
  </span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#020617;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%; background-color:#0f172a; border:1px solid #1e293b; border-radius:16px; overflow:hidden;">
          <tr>
            <td style="height:4px; background-color:#06b6d4; line-height:4px; font-size:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 36px 8px 36px;">
              <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; font-weight:700; letter-spacing:0.25em; color:#67e8f9; text-transform:uppercase;">
                ${APP_NAME}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 36px 0 36px;">
              <h1 style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:24px; line-height:1.3; font-weight:700; color:#f8fafc;">
                ${safeHeading}
              </h1>
            </td>
          </tr>
          ${safeGreeting ? `<tr><td style="padding:16px 36px 0 36px; font-size:15px; line-height:1.6; color:#e2e8f0;">Hi ${safeGreeting},</td></tr>` : ''}
          <tr>
            <td style="padding:16px 36px 0 36px; font-size:15px; line-height:1.6; color:#cbd5e1;">
              ${leadHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 36px 8px 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#06b6d4; border-radius:10px;">
                    <a href="${safeUrl}" style="display:inline-block; padding:14px 32px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; font-weight:700; color:#020617; text-decoration:none; border-radius:10px; letter-spacing:0.02em;">
                      ${safeCtaLabel}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px 0 36px;">
              ${expiresLine}
              <p style="margin:0 0 8px; font-size:13px; line-height:1.6; color:#94a3b8;">
                Button not working? Paste this link into your browser:
              </p>
              <p style="margin:0; font-size:13px; line-height:1.6; word-break:break-all;">
                <a href="${safeUrl}" style="color:#67e8f9; text-decoration:underline;">${safeUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 36px 32px 36px;">
              <p style="margin:0; font-size:12px; line-height:1.6; color:#64748b;">
                ${escapeHtml(SUPPORT_LINE)}
              </p>
            </td>
          </tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%;">
          <tr>
            <td align="center" style="padding:20px 16px 8px 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.6; color:#475569;">
              <a href="https://${APP_HOST}" style="color:#64748b; text-decoration:none;">${APP_HOST}</a>
              &nbsp;&middot;&nbsp;
              Predict football. Climb the leaderboard.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    APP_NAME.toUpperCase(),
    '',
    heading,
    '',
    greeting ? `Hi ${greeting},` : null,
    greeting ? '' : null,
    leadText,
    '',
    `${ctaLabel}:`,
    ctaUrl,
    expiresText.trim() || null,
    '',
    SUPPORT_LINE,
    '',
    `— Bantryx · https://${APP_HOST}`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  return { html, text };
}

function buildVerifyOnRegisterEmail({ username, link }) {
  const { html, text } = renderBrandedEmail({
    preheader: 'Confirm your email to start picking and climbing the leaderboard.',
    heading: 'Confirm your email',
    greeting: username,
    leadHtml: `<p style="margin:0;">Welcome to Bantryx. One quick step before you start picking: confirm this is your email so we can send you scoring updates, friend requests, and pick reminders.</p>`,
    leadText: `Welcome to Bantryx. One quick step before you start picking: confirm this is your email so we can send you scoring updates, friend requests, and pick reminders.`,
    ctaLabel: 'Confirm email',
    ctaUrl: link,
    expiresIn: '24 hours',
  });
  return { subject: 'Confirm your Bantryx email', html, text };
}

function buildVerifyForPasswordResetEmail({ username, link }) {
  const { html, text } = renderBrandedEmail({
    preheader: 'Verify your email first, then return to Bantryx to reset your password.',
    heading: 'Verify your email to reset your password',
    greeting: username,
    leadHtml: `<p style="margin:0 0 12px;">We received a password-reset request, but your email isn't verified yet — so we can't safely send the reset link.</p>
              <p style="margin:0;">Confirm your email first, then return to Bantryx and request the password reset again.</p>`,
    leadText: `We received a password-reset request, but your email isn't verified yet — so we can't safely send the reset link.\n\nConfirm your email first, then return to Bantryx and request the password reset again.`,
    ctaLabel: 'Verify email',
    ctaUrl: link,
    expiresIn: '24 hours',
  });
  return { subject: 'Verify your Bantryx email to reset your password', html, text };
}

function buildPasswordResetEmail({ username, link }) {
  const { html, text } = renderBrandedEmail({
    preheader: 'Tap the button below to set a new password. The link expires in 15 minutes.',
    heading: 'Reset your password',
    greeting: username,
    leadHtml: `<p style="margin:0;">We received a request to reset the password on your Bantryx account. Use the button below to choose a new one.</p>`,
    leadText: `We received a request to reset the password on your Bantryx account. Use the button below to choose a new one.`,
    ctaLabel: 'Reset password',
    ctaUrl: link,
    expiresIn: '15 minutes',
  });
  return { subject: 'Reset your Bantryx password', html, text };
}

module.exports = {
  escapeHtml,
  renderBrandedEmail,
  buildVerifyOnRegisterEmail,
  buildVerifyForPasswordResetEmail,
  buildPasswordResetEmail,
};
