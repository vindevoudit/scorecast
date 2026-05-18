'use strict';

// Tier 4b Chunk 3 — tighten games.leagueId to NOT NULL.
//
// Backfill safety: any games with leagueId IS NULL (legacy admin-entered
// fixtures from before Tier 4b) are reassigned to a synthetic "Legacy"
// league + its current-year season. The league is created here with
// sourceProvider='legacy' so it doesn't clash with football-data.org
// rows and so admins can easily distinguish synced from imported.
//
// Idempotent: if no NULL rows exist, the Legacy league is still created
// (or upserted), the ALTER COLUMN no-ops on a column that's already NOT
// NULL on rerun.

module.exports = {
  async up(queryInterface) {
    // 1. Ensure a "Legacy" league exists. Composite-unique on
    //    (sourceProvider, sourceLeagueId) means a re-run inserts nothing.
    //    createdAt/updatedAt supplied explicitly so the INSERT works whether
    //    the table was created by sequelize.sync (no DDL-level DEFAULTs) or
    //    by the leagues migration (with DEFAULT NOW()).
    await queryInterface.sequelize.query(`
      INSERT INTO leagues (id, name, "sourceProvider", "sourceLeagueId", country, active, "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'Legacy / Imported', 'legacy', 'LEGACY', NULL, FALSE, NOW(), NOW())
      ON CONFLICT ("sourceProvider", "sourceLeagueId") DO NOTHING
    `);

    // 2. Ensure a Legacy season for the current year exists. The
    //    (leagueId, year) unique index keeps re-runs idempotent. Same
    //    timestamp-defaults caveat as the leagues INSERT above.
    await queryInterface.sequelize.query(`
      INSERT INTO seasons (id, "leagueId", year, current, "createdAt", "updatedAt")
      SELECT gen_random_uuid(), l.id, EXTRACT(YEAR FROM NOW())::INT, TRUE, NOW(), NOW()
      FROM leagues l
      WHERE l."sourceProvider" = 'legacy' AND l."sourceLeagueId" = 'LEGACY'
      ON CONFLICT ("leagueId", year) DO NOTHING
    `);

    // 3. Backfill any orphan games into the Legacy league + season.
    await queryInterface.sequelize.query(`
      UPDATE games
      SET "leagueId" = legacy.id,
          "seasonId" = legacy_season.id
      FROM leagues legacy
      JOIN seasons legacy_season
        ON legacy_season."leagueId" = legacy.id
       AND legacy_season.year = EXTRACT(YEAR FROM NOW())::INT
      WHERE legacy."sourceProvider" = 'legacy'
        AND legacy."sourceLeagueId" = 'LEGACY'
        AND games."leagueId" IS NULL
    `);

    // 4. Tighten the column. ALTER ... SET NOT NULL is idempotent on a
    //    column that's already non-null.
    await queryInterface.sequelize.query(`ALTER TABLE games ALTER COLUMN "leagueId" SET NOT NULL`);
  },

  async down(queryInterface) {
    // Loosen first; do NOT remove the Legacy league/season — backfilled
    // rows still reference it. If you want to drop it, do so manually
    // after reassigning or deleting those rows.
    await queryInterface.sequelize.query(`ALTER TABLE games ALTER COLUMN "leagueId" DROP NOT NULL`);
  },
};
