// Beta launch reset — badge half.
//
// Resets earned badges to a consistent post-pick-wipe state and grants the
// commemorative `beta-tester` badge to every current user.
//
// Context: the score reset itself is done by deleting the beta Premier League
// games via the admin panel (GameService.cascadeDelete reverses every pick's
// user_scores contribution + invalidates the leaderboard cache). That removes
// the picks but leaves the Badge rows behind — so the pick-derived badges
// (First Pick / First Win / 10|25|50 Correct / Upset Specialist) would linger
// as "unearned". This script deletes exactly those, keeps `group-founder`
// (creating a group is unaffected by a pick wipe), then grants `beta-tester`
// to all users. `beta-tester` must also exist in badges/catalog.js for the
// BadgeWall to render it — that ships as a code change, deployed first.
//
// Idempotent: re-running deletes the (already-gone) pick-derived badges again
// as a no-op and re-grants beta-tester via ON CONFLICT DO NOTHING.
//
// ASCII-only stdout: this is meant to run via `az containerapp exec`, whose
// Windows-side CLI hardcodes cp1252 and crashes on non-cp1252 bytes (the
// documented "Azure CLI cp1252 crash" invariant). No emoji / unicode here.
//
// Optional clean-slate wipe: pass --wipe-picks to ALSO delete every pick and
// clear user_scores / user_scores_overall in the same transaction (used at the
// beta->launch reset when residual picks on other live leagues, e.g. the World
// Cup fixtures, should be cleared too). Without the flag, only badges change.
//
// Usage (from repo root, or inside the container, with DATABASE_URL set):
//
//   node scripts/grant-beta-badge.mjs [--wipe-picks] [--dry-run]
//
//   --wipe-picks  delete all picks + clear user_scores tables before badge work
//   --dry-run     compute + print what WOULD change, then ROLLBACK.

import { Sequelize } from 'sequelize';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const wipePicks = args.includes('--wipe-picks');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set in env');
  process.exit(1);
}

// Mirror models/index.js: opt into SSL when the prod URL asks for it.
const opts = url.includes('sslmode=require')
  ? {
      dialect: 'postgres',
      dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
      logging: false,
    }
  : { logging: false };
const s = new Sequelize(url, opts);

// The slugs awarded by pick history in services/BadgeService.js. These are the
// ones that become unearned once picks are gone. `group-founder` and the new
// `beta-tester` are intentionally NOT here.
const PICK_DERIVED = [
  'first-pick',
  'first-win',
  'correct-10',
  'correct-25',
  'correct-50',
  'upset-specialist',
];

const BETA_SLUG = 'beta-tester';

async function scalar(sql, transaction) {
  const [rows] = await s.query(sql, { transaction });
  return Number(rows[0].n);
}

const tx = await s.transaction();
try {
  // --- Pre-state.
  const picksBefore = await scalar('SELECT count(*)::int AS n FROM picks', tx);
  const userScoresBefore = await scalar('SELECT count(*)::int AS n FROM user_scores', tx);
  const userScoresOverallBefore = await scalar(
    'SELECT count(*)::int AS n FROM user_scores_overall',
    tx,
  );
  const userCount = await scalar('SELECT count(*)::int AS n FROM users', tx);

  console.log('--- pre-state ---');
  console.log('users:                    ' + userCount);
  console.log('picks:                    ' + picksBefore);
  console.log('user_scores rows:         ' + userScoresBefore);
  console.log('user_scores_overall rows: ' + userScoresOverallBefore);

  // --- Optional clean-slate wipe (picks + materialized score tables).
  // Residual picks here are unscored (their games are future/scheduled), so
  // deleting them changes no standings; clearing user_scores removes the
  // zeroed leftover rows from earlier game deletions. After this the tables
  // are empty and the leaderboard LEFT-JOINs every user in at 0.
  if (wipePicks) {
    await s.query('DELETE FROM picks', { transaction: tx });
    await s.query('DELETE FROM user_scores', { transaction: tx });
    await s.query('DELETE FROM user_scores_overall', { transaction: tx });
    console.log('--- wiped (clean slate) ---');
    console.log('picks deleted:               ' + picksBefore);
    console.log('user_scores cleared:         ' + userScoresBefore);
    console.log('user_scores_overall cleared: ' + userScoresOverallBefore);
  } else if (picksBefore !== 0 || userScoresBefore !== 0) {
    console.log('NOTE: picks/user_scores not empty and --wipe-picks not passed; pick-derived');
    console.log('      badges may be re-awarded by evaluateBadges() while picks exist.');
  }

  // --- Badge counts before.
  const [beforeRows] = await s.query(
    'SELECT slug, count(*)::int AS n FROM badges GROUP BY slug ORDER BY slug',
    { transaction: tx },
  );
  console.log('--- badges before ---');
  for (const r of beforeRows) console.log('  ' + r.slug.padEnd(18) + r.n);

  // --- Delete pick-derived badges.
  const pickDerivedBefore = beforeRows
    .filter((r) => PICK_DERIVED.includes(r.slug))
    .reduce((sum, r) => sum + r.n, 0);
  await s.query('DELETE FROM badges WHERE slug IN (:slugs)', {
    transaction: tx,
    replacements: { slugs: PICK_DERIVED },
  });

  // --- Grant beta-tester to every user (idempotent).
  const betaBefore = await scalar(
    `SELECT count(*)::int AS n FROM badges WHERE slug = '${BETA_SLUG}'`,
    tx,
  );
  await s.query(
    `
      INSERT INTO badges (id, "userId", slug, "awardedAt")
      SELECT gen_random_uuid(), u.id, '${BETA_SLUG}', NOW()
      FROM users u
      ON CONFLICT ("userId", slug) DO NOTHING
    `,
    { transaction: tx },
  );
  const betaAfter = await scalar(
    `SELECT count(*)::int AS n FROM badges WHERE slug = '${BETA_SLUG}'`,
    tx,
  );

  console.log('--- changes ---');
  console.log('pick-derived badges deleted: ' + pickDerivedBefore);
  console.log('beta-tester granted (new):   ' + (betaAfter - betaBefore));
  console.log('beta-tester total now:       ' + betaAfter + ' / ' + userCount + ' users');

  const [afterRows] = await s.query(
    'SELECT slug, count(*)::int AS n FROM badges GROUP BY slug ORDER BY slug',
    { transaction: tx },
  );
  console.log('--- badges after ---');
  for (const r of afterRows) console.log('  ' + r.slug.padEnd(18) + r.n);

  if (dryRun) {
    await tx.rollback();
    console.log('\nDRY RUN -- rolled back, no changes written.');
  } else {
    await tx.commit();
    console.log('\nCommitted.');
  }
} catch (err) {
  await tx.rollback();
  throw err;
} finally {
  await s.close();
}
