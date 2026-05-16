'use strict';

// Tier 4b Chunk 1 — seasons table. One season per (league, year). The
// fixture sync upserts a season row at sync time so newly-published
// schedules land in the right bucket without a separate admin step.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS seasons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "leagueId" UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        year INTEGER NOT NULL,
        "startsAt" TIMESTAMP WITH TIME ZONE,
        "endsAt" TIMESTAMP WITH TIME ZONE,
        current BOOLEAN NOT NULL DEFAULT FALSE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS seasons_league_year_unique
       ON seasons ("leagueId", year)`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS seasons CASCADE`);
  },
};
