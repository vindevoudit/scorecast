'use strict';

// Trophy Cabinet — per-match tournament stage. football-data.org returns a
// `stage` token on every match (GROUP_STAGE / LAST_32 / LAST_16 /
// QUARTER_FINALS / SEMI_FINALS / THIRD_PLACE / FINAL for the World Cup). We
// store it verbatim so services/TrophyService.js can segment a user's picks
// by tournament round.
//
// Nullable: legacy games + any league whose upstream omits `stage` keep NULL.
// lib/footballApi.js `normalizeFixture` + services/LeagueService.js
// `upsertFixture` populate it; a single WC re-sync backfills every existing
// row (the update path Object.assign's baseAttrs onto the game).
//
// Raw SQL with IF NOT EXISTS per the CLAUDE.md migrations invariant — the CI
// smoke job runs sequelize.sync() before db:migrate, so addColumn (no
// IF-NOT-EXISTS semantic) would fail against the already-synced table.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        ADD COLUMN IF NOT EXISTS "stage" VARCHAR(32) NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        DROP COLUMN IF EXISTS "stage"
    `);
  },
};
