'use strict';

// Tier 17 PR F — per-game pre-match Elo snapshot + applied-result marker.
// Makes the reactive cascade in PredictionService idempotent (re-capturing
// the same result is a no-op) and reversible (changing a previously-
// captured result reverses the prior Elo delta against the snapshot, then
// applies the new delta).
//
// Schema columns:
//  - homeEloPre / awayEloPre DECIMAL(8,2) NULL — both teams' Elo as of
//    the FIRST time this game's result was Elo-applied. Stays fixed for
//    the life of the game even if the result is later changed; the
//    snapshot represents pre-match strength, not post-revision strength.
//  - appliedResult VARCHAR(10) NULL — the result value that's been
//    Elo-applied (mirrors the game.result enum: 'home' | 'away' | 'draw'
//    | NULL). When result === appliedResult, the cascade is a no-op.
//    When they differ, the cascade reverses the old delta and applies
//    the new one against the (unchanged) snapshot.
//
// All columns default NULL. Existing rows have appliedResult=NULL which
// the new code treats as "Elo never applied" — so on the FIRST result-
// change after this migration deploys, the cascade snapshots the
// current team Elo and applies a delta exactly as before. That means
// the few rows that drifted before PR F shipped (the test toggles)
// don't get retroactively corrected here; they need manual cleanup.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        ADD COLUMN IF NOT EXISTS "homeEloPre"    NUMERIC(8, 2) NULL,
        ADD COLUMN IF NOT EXISTS "awayEloPre"    NUMERIC(8, 2) NULL,
        ADD COLUMN IF NOT EXISTS "appliedResult" VARCHAR(10)   NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        DROP COLUMN IF EXISTS "homeEloPre",
        DROP COLUMN IF EXISTS "awayEloPre",
        DROP COLUMN IF EXISTS "appliedResult"
    `);
  },
};
