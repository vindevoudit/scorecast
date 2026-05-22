'use strict';

// Tier 17 — teams table. Stores per-(team, league) Elo rating that the
// reactive cascade in PredictionService updates every time a result is
// captured. The companion seeder 20260522000001-seed-teams-from-elo-history
// bootstraps these rows by replaying the committed PL CSV history.
//
// Schema notes:
//  - NUMERIC(8, 2) for `elo` so years of K=20 updates can't drift through
//    binary-float rounding (Sequelize returns DECIMAL as STRING — services
//    must parseFloat() before doing math).
//  - Compound unique index on (name, leagueId) lets the same canonical
//    name appear in multiple leagues (CL + PL) without collision.
//  - leagueId FK CASCADE matches the League.hasMany association declared
//    in models/index.js so a league delete doesn't strand orphan teams.
//  - IF NOT EXISTS / CREATE INDEX IF NOT EXISTS so re-running against an
//    already-migrated DB is a no-op (CLAUDE.md migrations-framework rule).

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(128) NOT NULL,
        "leagueId" UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        elo NUMERIC(8, 2) NOT NULL DEFAULT 1500.00,
        "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
        "lastMatchDate" DATE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS teams_name_league_unique
       ON teams (name, "leagueId")`,
    );
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS teams_league_idx ON teams ("leagueId")`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS teams CASCADE`);
  },
};
