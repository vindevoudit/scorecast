'use strict';

// Tier 30 Phase 3 A1 Revision — Win-streak rework.
//
// Replaces the four daily-streak columns from migration
// 20260530000003-users-add-streak-columns.js with three new columns that
// drive the per-result win streak:
//
//   currentWinStreak       — current run of consecutive winning picks
//                            (W = pick.choice matches game.result for a
//                             non-draw result). D = no-op. L = reset to 0.
//   longestWinStreak       — monotonic high-water mark. Never decreases,
//                            even when result corrections trim the
//                            computed history.
//   lastMilestoneFired     — the highest milestone (5/10/15/20/30/50)
//                            the user has been notified about. Drops back
//                            to the largest M ≤ currentWinStreak whenever
//                            the current drops, so a future re-crossing
//                            fires again.
//
// The old columns are removed in the same migration — clean replacement,
// no backwards-compatibility shim (CLAUDE.md "Don't add backwards-
// compatibility hacks"). Pre-existing prod values are all 0 anyway after
// the 2026-05-28 beta reset wiped all picks.
//
// Defensive cleanup: DELETE any row in `badges` carrying the legacy
// `streakmaster` slug. The badge catalog ships three new tiered slugs
// (streakmaster-1/-2/-3); a stray legacy row would render as an unknown
// badge in BadgeWall.
//
// Raw SQL with explicit IF NOT EXISTS / IF EXISTS per the CLAUDE.md CI
// invariant (the migrations-smoke job runs sync({alter: false}) first, so
// queryInterface.addColumn would fail because the columns already exist
// post-sync).

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS "currentWinStreak" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "longestWinStreak" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "lastMilestoneFired" INTEGER NOT NULL DEFAULT 0;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS "currentDailyStreak",
        DROP COLUMN IF EXISTS "longestDailyStreak",
        DROP COLUMN IF EXISTS "lastStreakDayKey",
        DROP COLUMN IF EXISTS "lastStreakFreezeMonth";
    `);

    await queryInterface.sequelize.query(`
      DELETE FROM badges WHERE slug = 'streakmaster';
    `);
  },

  async down(queryInterface) {
    // Down direction is for local rollback only — production CD never
    // runs this. Restores the four old columns at their DEFAULT 0/NULL.
    // Any data accumulated under the new columns is dropped; that's
    // intentional (the new model can't be expressed in the old shape).
    await queryInterface.sequelize.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS "currentDailyStreak" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "longestDailyStreak" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "lastStreakDayKey" VARCHAR(10),
        ADD COLUMN IF NOT EXISTS "lastStreakFreezeMonth" VARCHAR(7);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS "currentWinStreak",
        DROP COLUMN IF EXISTS "longestWinStreak",
        DROP COLUMN IF EXISTS "lastMilestoneFired";
    `);
  },
};
