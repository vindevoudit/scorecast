// Notify beta testers about their Beta Tester badge — in-app bell + Web Push.
//
// Reuses the production NotificationService.notify path (DB insert + the
// fire-and-forget PushService fan-out) so every recipient gets exactly the
// same notification a normal badge award would produce:
//
//   type  = 'badge'
//   title = 'Badge earned: Beta Tester'
//   body  = 'Was here before launch. Thank you for helping test Bantryx.'
//   link  = '/?view=profile'
//
// Idempotent: only users WITHOUT an existing 'Badge earned: Beta Tester'
// notification are targeted, so a re-run sends nothing. Pair with the
// grant-beta-badge.mjs run (the badge rows must exist first; this just
// announces them).
//
// cp1252 safety (the documented "Azure CLI cp1252 crash" invariant): we set
// LOG_LEVEL=silent BEFORE importing anything that loads pino, and emit only
// ASCII to stdout. With logging silenced, no non-ASCII log byte can reach the
// az containerapp exec decoder and kill the connection. Because ESM hoists
// static imports above top-level code, models/services are pulled in via
// dynamic import() AFTER the env var is set.
//
// Web Push is fire-and-forget inside notify(); we drain for a few seconds
// after the loop so in-flight sends complete before the process exits.
//
// Usage (inside the container, or locally with DATABASE_URL set):
//
//   node scripts/notify-beta-badge.mjs [--dry-run]
//
//   --dry-run   report recipients + push-subscription count, send nothing.

process.env.LOG_LEVEL = 'silent';
// dotenv v17 prints a unicode tip banner (contains U+25C7 / U+2318) on config();
// quiet it so no non-ASCII byte reaches the az exec cp1252 decoder. (In prod the
// container has no .env file so it usually stays silent anyway — belt + braces.)
process.env.DOTENV_CONFIG_QUIET = 'true';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set in env');
  process.exit(1);
}

const TITLE = 'Badge earned: Beta Tester';
const BODY = 'Was here before launch. Thank you for helping test Bantryx.';
const LINK = '/?view=profile';

// Dynamic import AFTER LOG_LEVEL is set so pino initializes silent. models/
// index.js is CommonJS, so module.exports lands on `.default`. Requiring it
// does NOT auto-run sync/migrations/seed (initDatabase is only called by the
// server), so this is a side-effect-free load.
const db = (await import('../models/index.js')).default;
// Sequelize defaults to console.log query logging; silence it on the instance
// so the per-query "Executing (default): ..." noise (and any unicode in a
// logged value) never reaches stdout.
db.sequelize.options.logging = false;
const NotificationService = (await import('../services/NotificationService.js')).default;

try {
  const users = await db.User.findAll({ attributes: ['id', 'username'] });

  // Idempotency: skip anyone who already has the beta-tester notification.
  const [alreadyRows] = await db.sequelize.query(
    'SELECT DISTINCT "userId" AS id FROM notifications WHERE type = :type AND title = :title',
    { replacements: { type: 'badge', title: TITLE } },
  );
  const alreadyNotified = new Set(alreadyRows.map((r) => r.id));

  const [[pushSubs]] = await db.sequelize.query(
    'SELECT count(*)::int AS n FROM push_subscriptions',
  );

  const recipients = users.filter((u) => !alreadyNotified.has(u.id));

  console.log('--- notify beta testers ---');
  console.log('users total:              ' + users.length);
  console.log('already notified (skip):  ' + alreadyNotified.size);
  console.log('to notify:                ' + recipients.length);
  console.log('push subscriptions in db: ' + pushSubs.n);

  if (dryRun) {
    console.log('\nDRY RUN -- nothing sent.');
    await db.sequelize.close();
    process.exit(0);
  }

  let sent = 0;
  for (const u of recipients) {
    // notify() inserts the bell row (awaited) + fires PushService.sendToUser
    // fire-and-forget. Never throws.
    await NotificationService.notify(u.id, 'badge', TITLE, BODY, LINK);
    sent += 1;
  }
  console.log('bell notifications inserted: ' + sent);

  // Drain: let the fire-and-forget Web Push sends finish before exit. Only
  // worth waiting if any subscriptions exist.
  if (pushSubs.n > 0 && sent > 0) {
    console.log('draining push sends (10s)...');
    await new Promise((r) => setTimeout(r, 10000));
  }

  console.log('\nDone.');
  await db.sequelize.close();
} catch (err) {
  // ASCII-only error surface.
  console.error('ERROR: ' + (err && err.message ? err.message : String(err)));
  try {
    await db.sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
}
