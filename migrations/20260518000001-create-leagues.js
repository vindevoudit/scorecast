'use strict';

// Tier 4b Chunk 1 — leagues table. Top-level entity. Seeded with Premier
// League (PL, active=true) and World Cup (WC, active=false) so the admin
// panel lands on a populated League Manager. Adding more competitions
// later is a one-row insert via the admin UI; no code change required.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS leagues (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(120) NOT NULL,
        "sourceProvider" VARCHAR(40) NOT NULL DEFAULT 'football-data.org',
        "sourceLeagueId" VARCHAR(40) NOT NULL,
        country VARCHAR(80),
        "logoUrl" VARCHAR(500),
        active BOOLEAN NOT NULL DEFAULT FALSE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS leagues_source_unique
       ON leagues ("sourceProvider", "sourceLeagueId")`,
    );
    // Seed Premier League + World Cup. id is supplied via gen_random_uuid()
    // and createdAt/updatedAt via NOW() so the INSERT works whether
    // sequelize.sync() pre-created the table (no DDL-level DEFAULTs because
    // DataTypes.NOW only fills timestamps in JS at insert time) or this
    // migration did (with DEFAULT NOW()). ON CONFLICT keeps the migration
    // idempotent against re-runs.
    await queryInterface.sequelize.query(`
      INSERT INTO leagues (id, name, "sourceProvider", "sourceLeagueId", country, active, "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), 'Premier League', 'football-data.org', 'PL', 'England', TRUE, NOW(), NOW()),
        (gen_random_uuid(), 'FIFA World Cup', 'football-data.org', 'WC', 'World', FALSE, NOW(), NOW())
      ON CONFLICT ("sourceProvider", "sourceLeagueId") DO NOTHING
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS leagues CASCADE`);
  },
};
