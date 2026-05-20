'use strict';

// Reset the configured database to a known fixture state. Safe to run
// repeatedly. Invoked from `tests/e2e/fixtures/global-setup.js` and also
// available as a standalone CLI (`npm run test:e2e:seed`).

const { DATABASE_URL } = require('./env');

process.env.DATABASE_URL = DATABASE_URL;
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
// Silence the server-side pino logger during the seed phase — its boot
// messages leak into the Playwright runner output otherwise.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const bcrypt = require('bcryptjs');
const { sequelize, User, Game, League, Season } = require('../../../models');
const { FIXTURE_USERS, FIXTURE_GAMES, LEAGUE_ID, SEASON_ID } = require('./data');

async function truncateAll() {
  const [tables] = await sequelize.query(`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> 'SequelizeMeta'
  `);
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await sequelize.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function seedFixtures() {
  await truncateAll();

  const now = new Date();

  // Tier 4b Chunk 3 tightened games.leagueId to NOT NULL. truncateAll wipes
  // the migration-seeded leagues, so reinstate one (plus its season) with the
  // stable IDs from data.js so the game fixtures can reference them. Also
  // reinstate the Legacy / Imported league with the same shape migration
  // 20260518000007 creates so GameService.createGame's leagueId default works
  // (admin-panel.spec.js's game-CRUD test creates games without a league).
  await League.create({
    id: LEAGUE_ID,
    name: 'E2E Test League',
    sourceProvider: 'legacy',
    sourceLeagueId: 'E2E',
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  await League.create({
    name: 'Legacy / Imported',
    sourceProvider: 'legacy',
    sourceLeagueId: 'LEGACY',
    active: false,
    createdAt: now,
    updatedAt: now,
  });
  await Season.create({
    id: SEASON_ID,
    leagueId: LEAGUE_ID,
    year: now.getUTCFullYear(),
    current: true,
    createdAt: now,
    updatedAt: now,
  });

  // Pre-hash so we can bulkCreate without per-row hooks (faster + avoids
  // the rehash-already-hashed guard path).
  const userRows = await Promise.all(
    FIXTURE_USERS.map(async (u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      emailVerifiedAt: now,
      password: await bcrypt.hash(u.password, 10),
      role: u.role,
      loginAttempts: 0,
      // Tier 11 Chunk 4 — pre-complete onboarding for seed users so the
      // first-run tour modal doesn't block the existing E2E flows (only
      // the dedicated onboarding spec cares about the tour). UI-registered
      // users in tests (e.g. pick-and-result.spec.js) still hit the tour
      // because they're created at runtime without this flag.
      onboardingCompletedAt: now,
      // PWA Chunk 6 — explicit empty object so the column matches the
      // post-migration default and api/push.spec.js can rely on "no key =
      // implicitly enabled" semantics from a clean baseline.
      pushPreferences: {},
      createdAt: now,
    })),
  );
  await User.bulkCreate(userRows);

  await Game.bulkCreate(FIXTURE_GAMES);
}

module.exports = { seedFixtures, truncateAll };

if (require.main === module) {
  seedFixtures()
    .then(() => sequelize.close())
    .then(() => {
      process.stdout.write('e2e fixtures seeded\n');
    })
    .catch((err) => {
      process.stderr.write(`seed failed: ${err.message}\n${err.stack}\n`);
      process.exit(1);
    });
}
