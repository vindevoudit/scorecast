// LOCAL-ONLY dev seeder for the Trophy Cabinet. Creates a demo user + a fleet
// of "fans" and generates realistic (probability-weighted) picks across the
// synced World Cup games, plus two groups, so the per-stage cabinet has a real
// placement/percentile distribution to render.
//
// Pairs with the WC sync (which populates games.stage + real results). Run AFTER
// syncing the WC league. Idempotent — re-running tops up missing users/picks
// without duplicating (findOrCreate on username + (userId, gameId)).
//
// After seeding, run `node scripts/backfill-user-scores.mjs` so the regular
// leaderboards (Tier 24 materialized tables) reflect these picks too — the
// Trophy Cabinet itself computes on the fly and needs no backfill.
//
// Usage (repo root):
//   node scripts/seed-local-wc-cabinet.mjs            # seed
//   node scripts/seed-local-wc-cabinet.mjs --clear    # remove all seeded rows
//
// Demo login: wc_demo / password123
//
// SAFETY: refuses to run unless DATABASE_URL points at localhost — this must
// never touch a remote/prod database.

import { createRequire } from 'module';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
require('dotenv').config();

const url = process.env.DATABASE_URL || '';
const host = (url.match(/@([^/:]+)/) || [])[1] || (url.includes('localhost') ? 'localhost' : '');
if (!/^(localhost|127\.0\.0\.1)$/.test(host)) {
  console.error(`Refusing to run: DATABASE_URL host is "${host || '(unknown)'}", not localhost.`);
  console.error('This is a LOCAL-ONLY dev seeder and must never touch a remote database.');
  process.exit(1);
}

const bcrypt = require('bcryptjs');
const { sequelize, User, Game, Pick, League, Group, GroupMember } = require('../models');

const NUM_FANS = 50;
const PARTICIPATION = 0.85; // chance a given fan picked a given scored game
const UPSET_NOISE = 0.25; // chance a fan flips off the favourite (spread)
const DEMO_USERNAME = 'wc_demo';
const DEMO_PASSWORD = 'password123';
const GROUP_NAMES = ['World Cup Office Pool', 'The Pundits'];

const clear = process.argv.slice(2).includes('--clear');

function fanNames() {
  return Array.from({ length: NUM_FANS }, (_, i) => `wc_fan_${String(i + 1).padStart(2, '0')}`);
}

async function doClear() {
  const usernames = [DEMO_USERNAME, ...fanNames()];
  const users = await User.findAll({ where: { username: usernames }, attributes: ['id'] });
  const ids = users.map((u) => u.id);
  const groups = await Group.findAll({ where: { name: GROUP_NAMES }, attributes: ['id'] });
  const groupIds = groups.map((g) => g.id);
  if (ids.length) {
    await Pick.destroy({ where: { userId: ids } });
    await GroupMember.destroy({ where: { userId: ids } });
    await sequelize.query('DELETE FROM user_scores WHERE "userId" IN (:ids)', {
      replacements: { ids: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] },
    });
    await sequelize.query('DELETE FROM user_scores_overall WHERE "userId" IN (:ids)', {
      replacements: { ids: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] },
    });
  }
  if (groupIds.length) await GroupMember.destroy({ where: { groupId: groupIds } });
  await Group.destroy({ where: { name: GROUP_NAMES } });
  if (ids.length) await User.destroy({ where: { id: ids } });
  console.log(`cleared: ${ids.length} users, ${groupIds.length} groups (+ their picks/members/scores)`);
}

async function main() {
  if (clear) {
    await doClear();
    return;
  }

  const wc = await League.findOne({ where: { sourceLeagueId: 'WC' } });
  if (!wc) throw new Error('No WC league found — sync it first (admin League Manager → Sync).');
  const games = await Game.findAll({ where: { leagueId: wc.id } });
  const scored = games.filter((g) => g.result);
  console.log(`WC games: ${games.length} total, ${scored.length} scored (picks seeded on scored games).`);
  if (scored.length === 0) throw new Error('No scored WC games — nothing to build a cabinet from yet.');

  const now = new Date();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // Users: demo first, then fans.
  const usernames = [DEMO_USERNAME, ...fanNames()];
  const users = [];
  for (const username of usernames) {
    const [u] = await User.findOrCreate({
      where: { username },
      defaults: {
        username,
        email: `${username}@example.test`,
        password: hash,
        emailVerifiedAt: now,
        role: 'user',
        onboardingCompletedAt: now,
        termsAcceptedAt: now,
        termsAcceptedVersion: 2,
        pushPreferences: {},
        profileVisibility: 'public',
        referralCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
      },
    });
    users.push(u);
  }
  const demo = users[0];
  const fans = users.slice(1);
  console.log(`users ensured: ${users.length} (demo="${DEMO_USERNAME}", ${fans.length} fans)`);

  // Groups owned by demo; demo + overlapping fan subsets as members.
  const groups = [];
  for (let i = 0; i < GROUP_NAMES.length; i++) {
    const [g] = await Group.findOrCreate({
      where: { name: GROUP_NAMES[i] },
      defaults: {
        name: GROUP_NAMES[i],
        discriminator: crypto.randomBytes(3).toString('hex').toUpperCase(),
        ownerId: demo.id,
        visibility: 'public',
        createdAt: now,
      },
    });
    groups.push(g);
    // demo is always a member of their own group
    await GroupMember.findOrCreate({ where: { groupId: g.id, userId: demo.id } });
    // 25 fans per group, staggered so the two groups overlap partially
    const members = fans.slice(i * 15, i * 15 + 25);
    for (const m of members) {
      await GroupMember.findOrCreate({ where: { groupId: g.id, userId: m.id } });
    }
  }
  console.log(`groups ensured: ${groups.map((g) => g.name).join(', ')}`);

  // Picks — probability-weighted with upset noise. Demo participates in every
  // scored game; fans participate PARTICIPATION of the time so per-stage
  // participant counts vary (realistic).
  let created = 0;
  for (const u of users) {
    const isDemo = u.id === demo.id;
    for (const game of scored) {
      if (!isDemo && Math.random() > PARTICIPATION) continue;
      const ph = parseFloat(game.homeProbability) || 0.5;
      const pa = parseFloat(game.awayProbability) || 0.5;
      const denom = ph + pa || 1;
      let choice = Math.random() < ph / denom ? 'home' : 'away';
      if (Math.random() < UPSET_NOISE) choice = choice === 'home' ? 'away' : 'home';
      const [, wasCreated] = await Pick.findOrCreate({
        where: { userId: u.id, gameId: game.id },
        defaults: { userId: u.id, gameId: game.id, choice, submittedAt: now },
      });
      if (wasCreated) created += 1;
    }
  }
  console.log(`picks created: ${created}`);
  console.log('\nDone. Next: `node scripts/backfill-user-scores.mjs` to materialize leaderboards.');
  console.log(`Log in as ${DEMO_USERNAME} / ${DEMO_PASSWORD} → open the Trophy Cabinet.`);
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error('seed failed:', err.message);
    await sequelize.close();
    process.exit(1);
  });
