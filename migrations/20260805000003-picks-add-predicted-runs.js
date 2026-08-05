'use strict';

// Tier 34.1 — optional per-side runs predictions for the T20 cricket market.
//
// Both nullable: the winner leg is required (picks.choice stays NOT NULL, so
// no football path is destabilised) while the runs legs are opt-in. NULL means
// "not predicted" and scores 0 for that leg — distinct from a prediction of 0
// runs, which would score `max(0, 100 - actual)`.
//
// Football picks leave both NULL forever; PickService only writes them when
// the target game is cricket.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE picks
        ADD COLUMN IF NOT EXISTS "predictedHomeRuns" INTEGER NULL,
        ADD COLUMN IF NOT EXISTS "predictedAwayRuns" INTEGER NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE picks
        DROP COLUMN IF EXISTS "predictedHomeRuns",
        DROP COLUMN IF EXISTS "predictedAwayRuns"
    `);
  },
};
