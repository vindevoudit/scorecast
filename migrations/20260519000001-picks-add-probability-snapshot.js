'use strict';

// Pick-time probability snapshot — three nullable DECIMAL(3,2) columns that
// freeze the game's probabilities at the moment a pick is made. lib/scoring.js
// reads them in preference to game.{home,draw,away}Probability when present,
// so the daily ML cron's --overwrite-existing rewrite can't shift a user's
// locked-in payout after they've committed.
//
// All three are nullable: legacy picks (pre-deploy) keep NULL snapshots and
// fall back to current game.* (preserves the pre-tier behavior). New picks
// always write the trio together (PickService.createPick is atomic).
//
// No new index — picks are looked up by the existing (userId, gameId) unique
// index or by primary key, never by a snapshot value.
//
// Uses raw SQL with IF NOT EXISTS so this is idempotent against an already-
// synced schema (sequelize.sync materialises every model column, including
// these). Matches the pattern every other migration in this directory uses.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE picks
        ADD COLUMN IF NOT EXISTS "pickedHomeProbability" DECIMAL(3, 2) NULL,
        ADD COLUMN IF NOT EXISTS "pickedDrawProbability" DECIMAL(3, 2) NULL,
        ADD COLUMN IF NOT EXISTS "pickedAwayProbability" DECIMAL(3, 2) NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE picks
        DROP COLUMN IF EXISTS "pickedAwayProbability",
        DROP COLUMN IF EXISTS "pickedDrawProbability",
        DROP COLUMN IF EXISTS "pickedHomeProbability"
    `);
  },
};
