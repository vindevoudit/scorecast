'use strict';

// CPL auto-results — the two columns that make automatic result capture safe.
//
// WHY providerMatchId EXISTS AT ALL
// ---------------------------------
// Cricket fixtures come from a committed JSON file, not from the provider, so
// games."sourceId" is a SYNTHETIC key ("CPL2026-M01") that the provider has
// never heard of. Something has to hold the join. Resolving it fresh on every
// tick (by date window + team names) would work but re-does fuzzy matching
// forever and leaves no audit trail; stamping it once is cheap, inspectable,
// and lets a bad match be corrected by hand with one UPDATE.
//
// WHY resultSource IS THE WHOLE OVERRIDE STORY
// --------------------------------------------
// Three values, and the automation only ever touches the first:
//   NULL    - nobody has written a result. Claimable.
//   'auto'  - the cron captured it.
//   'admin' - a human wrote or corrected it. PERMANENTLY excluded.
// The exclusion is enforced in the SQL WHERE of the claim UPDATE, not in JS,
// so the admin-vs-cron race is settled by the database. An admin correcting a
// mis-derived scorecard must never be silently re-overwritten on the next tick,
// and CricketResultService stamps 'admin' by default precisely so the existing
// admin route needs no change to get that protection.
//
// THE BACKFILL IS NOT OPTIONAL
// ----------------------------
// The 2026 CPL started 2026-08-07 and this ships mid-season, so cricket games
// with hand-entered results already exist. Without the backfill they would read
// as resultSource IS NULL, i.e. claimable, and the job would re-derive them
// from the provider — burning hits and risking overwriting a correct manual
// entry with a mis-derivation. Stamping them 'admin' freezes them.
//
// No "updatedAt" anywhere below: models/Game.js is timestamps:false and the
// games table genuinely has no such column.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        ADD COLUMN IF NOT EXISTS "providerMatchId"         VARCHAR(64)              NULL,
        ADD COLUMN IF NOT EXISTS "providerMatchResolvedAt" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "resultSource"            VARCHAR(16)              NULL
    `);

    // Partial unique index — the last line of defence against a mis-resolution
    // binding two local games to the same provider match. The resolver already
    // refuses ambiguous candidates; this makes the failure a caught constraint
    // violation rather than two games sharing one scorecard.
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS games_league_provider_match_unique
        ON games ("leagueId", "providerMatchId")
        WHERE "providerMatchId" IS NOT NULL
    `);

    // Lookup index for the resolve job's "which cricket games are unresolved"
    // scan and the sync job's eligibility count.
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS games_result_source_idx
        ON games ("resultSource")
        WHERE "sport" = 'cricket'
    `);

    // Idempotent: only fills NULLs, so re-running (or running after some rows
    // have already been captured as 'auto') never rewrites an existing value.
    await queryInterface.sequelize.query(`
      UPDATE games
         SET "resultSource" = 'admin'
       WHERE "sport" = 'cricket'
         AND "resultSource" IS NULL
         AND ("result" IS NOT NULL
              OR "appliedResult" IS NOT NULL
              OR "status" IN ('finished', 'cancelled'))
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS games_result_source_idx`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS games_league_provider_match_unique`);
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        DROP COLUMN IF EXISTS "providerMatchId",
        DROP COLUMN IF EXISTS "providerMatchResolvedAt",
        DROP COLUMN IF EXISTS "resultSource"
    `);
  },
};
