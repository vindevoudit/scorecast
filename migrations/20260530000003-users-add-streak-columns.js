'use strict';

// Tier 30 Phase 3 (Tier 27 Phase A — A1) — Streak state.
//
// Adds four columns on `users` that drive the pick-streak feature:
//   currentDailyStreak       — consecutive calendar days with at least one pick.
//   longestDailyStreak       — high-water mark across the user's lifetime.
//   lastStreakDayKey         — YYYY-MM-DD (UTC) of the most recent pick day.
//                              Anchor used to compute "is today already counted",
//                              "missed one day (freeze candidate)", "clean miss".
//   lastStreakFreezeMonth    — YYYY-MM (UTC) of the most recent calendar month
//                              in which the auto-grant streak-freeze was consumed.
//                              One freeze per calendar month covers a single
//                              missed day, then the user is back on the clock.
//
// Raw SQL with explicit IF NOT EXISTS per the CLAUDE.md CI invariant
// (the migrations-smoke job runs sync({alter: false}) first, so
// queryInterface.addColumn would fail because the columns already
// exist post-sync).

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS "currentDailyStreak" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "longestDailyStreak" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "lastStreakDayKey" VARCHAR(10),
        ADD COLUMN IF NOT EXISTS "lastStreakFreezeMonth" VARCHAR(7);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS "currentDailyStreak",
        DROP COLUMN IF EXISTS "longestDailyStreak",
        DROP COLUMN IF EXISTS "lastStreakDayKey",
        DROP COLUMN IF EXISTS "lastStreakFreezeMonth";
    `);
  },
};
