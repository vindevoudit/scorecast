// Operator broadcast mailer — send one campaign to one address, or to every
// user with an email on file.
//
// There is no standing "email all users" path in the app (lib/email.js sends one
// message at a time; the Tier 31 marketing automation only emails the operator),
// so broadcasts are deliberately a manually-run script with no implicit blast:
// exactly one of --test / --all / --all-unverified is required.
//
// CONTENT LIVES IN A CAMPAIGN FILE, not in here. Campaigns are plain ESM data
// modules under scripts/campaigns/ (that dir is COPYd into the runtime image by
// the Dockerfile, so `az containerapp exec` can reach them; marketing/ is NOT).
// See scripts/campaigns/knockout-reminder.mjs for a fully-populated example.
//
//   export default {
//     subject:    'Line that lands in the inbox',   // required
//     heading:    'Big line at the top of the card', // required
//     paragraphs: ['First para.', 'Second para.'],   // required, >= 1
//     preheader:  'Hidden inbox-preview line',       // optional
//     highlight:  'Amber callout under the body',    // optional
//     cta:        { label: 'Make my picks', path: '/?view=games' },  // optional
//     footnote:   'Overrides the default footer line',               // optional
//   }
//
// Content is plain text — it gets HTML-escaped, so write real characters
// ("don't", "—", "⚽"), not entities. The matching plaintext part is generated
// from the same fields, so you write each campaign once.
//
// Escape hatch: a campaign may instead (or additionally) export `html` and/or
// `text` strings, which are used verbatim and skip the renderer entirely.
//
// cp1252 safety (the documented "Azure CLI cp1252 crash" invariant): we set
// LOG_LEVEL=silent + DOTENV_CONFIG_QUIET BEFORE importing anything that loads
// pino, and every line this script prints is forced to ASCII. Campaign content
// is free to contain unicode — it only ever goes onto the wire to Resend, never
// to stdout. models/ + lib/ are pulled in via dynamic import() AFTER the env
// vars are set, because ESM hoists static imports above top-level code.
//
// Usage (inside the container, or locally with RESEND_API_KEY [+ DATABASE_URL
// for the broadcast modes] set):
//
//   node scripts/broadcast-email.mjs -c knockout-reminder --test you@example.com
//   node scripts/broadcast-email.mjs -c knockout-reminder --all --dry-run
//   node scripts/broadcast-email.mjs -c knockout-reminder --all --limit 10
//   node scripts/broadcast-email.mjs -c knockout-reminder --all
//   node scripts/broadcast-email.mjs -c knockout-reminder --all-unverified
//
//   -c, --campaign <name|path>  campaign to send; a bare name resolves to
//                               scripts/campaigns/<name>.mjs           (required)
//   --test <email>     send a single copy to <email> and exit (no DB needed)
//   --all              send to every user with a VERIFIED email
//   --all-unverified   send to every user with any email (verified or not)
//   --dry-run          report what would happen, send nothing
//   --limit <n>        cap the recipient list at n (staged rollout)
//   --preview          print the rendered plaintext part and exit (no send)
//   --out <file>       with --preview, also write the rendered HTML to <file>
//                      (UTF-8, so open it in a browser to eyeball the real thing)
//
// KNOWN GAP: there is no unsubscribe mechanism. lib/email.js has no header
// passthrough, so we cannot set List-Unsubscribe, and there is no email
// preference column on users. Bulk-sender rules at Gmail/Yahoo expect one-click
// unsubscribe above a few thousand messages a day. Fine at current volume;
// wire up a preference column + public unsubscribe route before scaling up.

process.env.LOG_LEVEL = 'silent';
process.env.DOTENV_CONFIG_QUIET = 'true';

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);

function flagValue(...names) {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i !== -1) {
      const v = args[i + 1];
      if (!v || v.startsWith('--')) return { present: true, value: null };
      return { present: true, value: v };
    }
  }
  return { present: false, value: null };
}

const dryRun = args.includes('--dry-run');
const preview = args.includes('--preview');
const isAll = args.includes('--all');
const isAllUnverified = args.includes('--all-unverified');
const test = flagValue('--test');
const campaignArg = flagValue('--campaign', '-c');
const limitArg = flagValue('--limit');
const outArg = flagValue('--out');

const isTest = test.present;

// --- stdout hygiene -------------------------------------------------------
// Every line this script prints goes through here. Non-ASCII is transliterated
// where there's an obvious equivalent and dropped otherwise, so the Azure CLI's
// hardcoded cp1252 decoder can never crash mid-run and kill the container work.
const ASCII_MAP = {
  '\u2014': '--',
  '\u2013': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2026': '...',
  '\u2192': '->',
  '\u00a0': ' ',
};
function toAscii(value) {
  let s = String(value == null ? '' : value);
  for (const [from, to] of Object.entries(ASCII_MAP)) s = s.split(from).join(to);
  // eslint-disable-next-line no-control-regex -- stripping the non-ASCII range is the point
  return s.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}
function say(line) {
  console.log(toAscii(line));
}
function fail(line) {
  console.error(toAscii(line));
  process.exit(1);
}

// --- argument validation --------------------------------------------------
const modeCount = [isTest, isAll, isAllUnverified].filter(Boolean).length;
if (modeCount !== 1 && !preview) {
  fail('Pick exactly one mode: --test <email> | --all | --all-unverified');
}
if (isTest && !test.value) {
  fail('--test requires an email address, e.g. --test you@example.com');
}
if (!campaignArg.present || !campaignArg.value) {
  fail('--campaign <name|path> is required, e.g. --campaign knockout-reminder');
}
let limit = null;
if (limitArg.present) {
  limit = Number(limitArg.value);
  if (!Number.isInteger(limit) || limit < 1) fail('--limit needs a positive integer');
}

// --- campaign loading -----------------------------------------------------
const raw = campaignArg.value;
const looksLikePath = raw.includes('/') || raw.includes('\\') || raw.endsWith('.mjs');
const campaignPath = looksLikePath
  ? path.resolve(process.cwd(), raw)
  : path.resolve(process.cwd(), 'scripts', 'campaigns', raw + '.mjs');

let campaign;
try {
  // pathToFileURL matters on Windows: bare absolute paths ("C:\...") are not
  // valid import specifiers.
  campaign = (await import(pathToFileURL(campaignPath).href)).default;
} catch (err) {
  say('Could not load campaign: ' + campaignPath);
  fail('  ' + (err && err.message ? err.message : String(err)));
}
if (!campaign || typeof campaign !== 'object') {
  fail('Campaign must default-export an object: ' + campaignPath);
}

const verbatim = typeof campaign.html === 'string' || typeof campaign.text === 'string';
const problems = [];
if (typeof campaign.subject !== 'string' || !campaign.subject.trim()) {
  problems.push('subject (non-empty string) is required');
}
if (!verbatim) {
  if (typeof campaign.heading !== 'string' || !campaign.heading.trim()) {
    problems.push('heading (non-empty string) is required');
  }
  if (!Array.isArray(campaign.paragraphs) || campaign.paragraphs.length === 0) {
    problems.push('paragraphs (non-empty array of strings) is required');
  } else if (campaign.paragraphs.some((p) => typeof p !== 'string' || !p.trim())) {
    problems.push('every entry in paragraphs must be a non-empty string');
  }
  if (campaign.cta != null) {
    if (typeof campaign.cta !== 'object') problems.push('cta must be an object');
    else {
      if (typeof campaign.cta.label !== 'string' || !campaign.cta.label.trim()) {
        problems.push('cta.label (non-empty string) is required when cta is set');
      }
      if (typeof campaign.cta.path !== 'string' || !campaign.cta.path.startsWith('/')) {
        problems.push('cta.path must be an app-relative path starting with "/"');
      }
    }
  }
}
if (problems.length) {
  say('Invalid campaign: ' + campaignPath);
  for (const p of problems) say('  - ' + p);
  process.exit(1);
}

// --- rendering ------------------------------------------------------------
const APP_URL = (process.env.PUBLIC_APP_URL || 'https://bantryx.com').replace(/\/$/, '');
const ctaUrl = campaign.cta ? APP_URL + campaign.cta.path : null;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DEFAULT_FOOTNOTE = "You're receiving this because you have a Bantryx account.";

function renderHtml() {
  const bodyParas = campaign.paragraphs
    .map(
      (p) =>
        `                <p style="margin:0 0 16px;">\n                  ${esc(p)}\n                </p>`,
    )
    .join('\n');

  const highlightBlock = campaign.highlight
    ? `\n                <p style="margin:0 0 8px;color:#fbbf24;font-weight:600;">\n                  ${esc(campaign.highlight)}\n                </p>`
    : '';

  const ctaBlock = ctaUrl
    ? `
            <tr>
              <td align="center" style="padding:20px 32px 28px;">
                <a href="${esc(ctaUrl)}" style="display:inline-block;background-color:#22d3ee;color:#0b1220;font-size:16px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:9999px;">
                  ${esc(campaign.cta.label)} &rarr;
                </a>
              </td>
            </tr>`
    : '';

  const preheaderBlock = campaign.preheader
    ? `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(campaign.preheader)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(campaign.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#0b1220;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${preheaderBlock}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b1220;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#111a2e;border:1px solid #1e293b;border-radius:20px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:36px 32px 16px;">
                <div style="font-size:28px;font-weight:800;letter-spacing:0.12em;color:#22d3ee;text-transform:uppercase;">BANTRYX</div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 4px;">
                <div style="font-size:24px;font-weight:700;color:#f8fafc;line-height:1.3;">
                  ${esc(campaign.heading)}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 8px;color:#cbd5e1;font-size:16px;line-height:1.6;">
${bodyParas}${highlightBlock}
              </td>
            </tr>${ctaBlock}
            <tr>
              <td style="padding:0 32px;">
                <div style="border-top:1px solid #1e293b;"></div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 32px 32px;color:#64748b;font-size:13px;line-height:1.5;">
                <div style="font-weight:600;color:#94a3b8;margin-bottom:6px;">No betting. Just Bantryx.</div>
                <div>${esc(campaign.footnote || DEFAULT_FOOTNOTE)}</div>
                <div style="margin-top:8px;">
                  <a href="${esc(APP_URL)}" style="color:#22d3ee;text-decoration:none;">bantryx.com</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function wrap(text, width = 72) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (!word) continue;
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line) out.push(line);
  return out.join('\n');
}

function renderText() {
  const parts = [campaign.heading.toUpperCase(), ''];
  for (const p of campaign.paragraphs) parts.push(wrap(p), '');
  if (campaign.highlight) parts.push(wrap(campaign.highlight), '');
  if (ctaUrl) parts.push(campaign.cta.label + ' -> ' + ctaUrl, '');
  parts.push('--', 'No betting. Just Bantryx.', campaign.footnote || DEFAULT_FOOTNOTE, APP_URL);
  return parts.join('\n');
}

const SUBJECT = campaign.subject;
const HTML = typeof campaign.html === 'string' ? campaign.html : renderHtml();
const TEXT = typeof campaign.text === 'string' ? campaign.text : renderText();

// --- preview --------------------------------------------------------------
say('campaign:    ' + campaignPath);
say('subject:     ' + SUBJECT);
if (ctaUrl) say('cta url:     ' + ctaUrl);

if (preview) {
  if (outArg.present) {
    if (!outArg.value) fail('--out needs a file path, e.g. --out preview.html');
    const outPath = path.resolve(process.cwd(), outArg.value);
    // UTF-8 on disk: the file keeps the real unicode, unlike stdout.
    fs.writeFileSync(outPath, HTML, 'utf8');
    say('wrote html:  ' + outPath);
  }
  say('');
  say('--- plaintext part (ASCII-folded for this terminal) ---');
  say(TEXT);
  say('--- end preview; nothing sent ---');
  process.exit(0);
}

// lib/email.js is CommonJS (module.exports = { send }); the whole exports object
// lands on .default under ESM interop.
const { send } = (await import('../lib/email.js')).default;

function maskEmail(addr) {
  // Partially-masked address for stdout -- avoids dumping the full recipient
  // list into operator logs.
  const at = addr.indexOf('@');
  if (at < 1) return '***';
  const name = addr.slice(0, at);
  const head = name.slice(0, Math.min(2, name.length));
  return head + '***' + addr.slice(at);
}

async function sendOne(to) {
  const res = await send({ to, subject: SUBJECT, html: HTML, text: TEXT });
  return res && res.delivered === true;
}

// --- single-address mode --------------------------------------------------
if (isTest) {
  say('mode:        TEST');
  say('to:          ' + maskEmail(test.value));
  if (dryRun) {
    say('DRY RUN -- nothing sent.');
    process.exit(0);
  }
  const ok = await sendOne(test.value);
  say(ok ? 'delivered:   yes' : 'delivered:   NO (check RESEND_API_KEY / EMAIL_FROM domain)');
  process.exit(ok ? 0 : 1);
}

// --- broadcast modes ------------------------------------------------------
if (!process.env.DATABASE_URL) fail('DATABASE_URL not set in env');

const db = (await import('../models/index.js')).default;
db.sequelize.options.logging = false;
const { Op } = (await import('sequelize')).default;

try {
  const where = { email: { [Op.ne]: null } };
  if (isAll) where.emailVerifiedAt = { [Op.ne]: null };

  const users = await db.User.findAll({ attributes: ['id', 'email'], where });

  // Defensive de-dup by lowercased address.
  const seen = new Set();
  let recipients = [];
  for (const u of users) {
    const addr = (u.email || '').trim();
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(addr);
  }

  const matched = recipients.length;
  if (limit != null && recipients.length > limit) recipients = recipients.slice(0, limit);

  say('mode:        BROADCAST (' + (isAll ? 'verified only' : 'verified or not') + ')');
  say('matched:     ' + matched);
  if (limit != null) say('limited to:  ' + recipients.length + ' (--limit ' + limit + ')');

  if (dryRun) {
    say('DRY RUN -- nothing sent.');
    await db.sequelize.close();
    process.exit(0);
  }

  let delivered = 0;
  let failed = 0;
  for (const addr of recipients) {
    const ok = await sendOne(addr);
    if (ok) delivered += 1;
    else {
      failed += 1;
      say('  failed: ' + maskEmail(addr));
    }
    // Gentle pacing to stay well under Resend rate limits.
    await new Promise((r) => setTimeout(r, 600));
  }

  say('delivered:   ' + delivered);
  say('failed:      ' + failed);
  say('Done.');
  await db.sequelize.close();
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error(toAscii('ERROR: ' + (err && err.message ? err.message : String(err))));
  try {
    await db.sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
}
