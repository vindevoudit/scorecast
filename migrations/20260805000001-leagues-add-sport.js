'use strict';

// Tier 34.1 — multi-sport taxonomy. `leagues.sport` is the single new axis;
// everything else about a sport derives from it (which market a game uses,
// which cron jobs may touch it, which leaderboard tab it lands on).
//
// DEFAULT 'football' is load-bearing: every existing league row is football,
// so the backfill is implicit and the four football cron jobs can tighten
// their `where: { active: true }` to `where: { active: true, sport: 'football' }`
// with a provably identical result set.
//
// Deliberately a plain VARCHAR rather than an ENUM — adding a third sport
// should be a data change, not an `ALTER TYPE` (which cannot run inside a
// transaction block and therefore fights umzug).

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE leagues
        ADD COLUMN IF NOT EXISTS "sport" VARCHAR(20) NOT NULL DEFAULT 'football'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE leagues
        DROP COLUMN IF EXISTS "sport"
    `);
  },
};
