'use strict';

// Tier 4b Chunk 1 — games gain leagueId / seasonId / sourceId so synced
// fixtures can be upserted by their upstream id without colliding across
// leagues. leagueId stays nullable here; Chunk 3 will tighten it to NOT
// NULL after backfilling legacy rows.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE games ADD COLUMN IF NOT EXISTS "leagueId" UUID REFERENCES leagues(id) ON DELETE SET NULL`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE games ADD COLUMN IF NOT EXISTS "seasonId" UUID REFERENCES seasons(id) ON DELETE SET NULL`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE games ADD COLUMN IF NOT EXISTS "sourceId" VARCHAR(128)`,
    );
    // Partial unique index — only enforced when sourceId is present, so
    // hand-entered fixtures (sourceId IS NULL) don't all collide on NULL.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS games_league_source_unique
       ON games ("leagueId", "sourceId")
       WHERE "sourceId" IS NOT NULL`,
    );
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS games_league_idx ON games ("leagueId")`,
    );
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS games_season_idx ON games ("seasonId")`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS games_league_source_unique`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS games_league_idx`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS games_season_idx`);
    await queryInterface.sequelize.query(`ALTER TABLE games DROP COLUMN IF EXISTS "sourceId"`);
    await queryInterface.sequelize.query(`ALTER TABLE games DROP COLUMN IF EXISTS "seasonId"`);
    await queryInterface.sequelize.query(`ALTER TABLE games DROP COLUMN IF EXISTS "leagueId"`);
  },
};
