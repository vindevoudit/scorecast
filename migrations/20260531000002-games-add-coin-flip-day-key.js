'use strict';

// Tier 30 Phase 3 A6 — Pick of the Day / Coin Flip Master badge.
//
// Adds `games.coinFlipDayKey VARCHAR(10) NULLABLE` — YYYY-MM-DD (UTC) of
// the calendar day the game was selected as that day's "coin flip"
// (the most uncertain upcoming match within active leagues). Stamped
// by lib/jobs/selectCoinFlip.js and never cleared — historical games
// retain their flag so BadgeService can audit which past picks earned
// coin-flip-master progress.
//
// Partial unique index enforces at most ONE coin-flip per UTC day. A
// day with zero scheduled active-league fixtures simply has no row
// with that day's key, which is the desired no-op semantic.
//
// Raw SQL with explicit IF NOT EXISTS / IF EXISTS per the CLAUDE.md CI
// invariant.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        ADD COLUMN IF NOT EXISTS "coinFlipDayKey" VARCHAR(10);
    `);
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS games_coin_flip_day_key_unique
        ON games ("coinFlipDayKey")
        WHERE "coinFlipDayKey" IS NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS games_coin_flip_day_key_unique;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        DROP COLUMN IF EXISTS "coinFlipDayKey";
    `);
  },
};
