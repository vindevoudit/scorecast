'use strict';

// International model support — per-game neutral-venue flag + Elo K-factor
// multiplier. Both columns default to "PL-compatible" values:
//
//  - neutralVenue BOOLEAN NOT NULL DEFAULT FALSE — PL fixtures and every
//    other existing fixture keep treating home as home. The fixture-sync
//    branch in services/LeagueService.js stamps TRUE for fixtures syncing
//    under sourceLeagueId='WC' (which is the meta-pool for international
//    matches in V1 — see CLAUDE.md "Critical considerations" once the
//    international model ships).
//
//  - eloKMultiplier NUMERIC(4,2) NULL — null means "treat as 1.0" at apply
//    time so PL rows are never silently rewritten and the cascade can detect
//    "this game predates the column". Fixture sync stamps 3.0 for WC.
//
// Both columns are orthogonal to the Tier 17 snapshot matrix
// (homeEloPre / awayEloPre / appliedResult). The cascade reads the live
// game.eloKMultiplier for BOTH the reverse and re-apply legs of a result
// change, so as long as the column isn't mutated between captures, the
// Tier 17 reversal invariant holds. Operator convention: treat
// eloKMultiplier as FROZEN once appliedResult is non-null.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        ADD COLUMN IF NOT EXISTS "neutralVenue"   BOOLEAN       NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS "eloKMultiplier" NUMERIC(4, 2) NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        DROP COLUMN IF EXISTS "neutralVenue",
        DROP COLUMN IF EXISTS "eloKMultiplier"
    `);
  },
};
