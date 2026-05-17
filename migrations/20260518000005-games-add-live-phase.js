'use strict';

// Tier 4b Chunk 2 follow-up — adds two columns that let the client show a
// better live-match label without paying for a paid football-data.org
// plan that exposes `minute` directly.
//
//   halfTimeReached  — flips to true once upstream populates score.halfTime;
//                      lets the UI clamp its kickoff-elapsed estimate to
//                      ≥ 46' instead of underreporting through halftime.
//   phase            — 'regular' / 'extra-time' / 'penalty-shootout',
//                      mirroring upstream's score.duration. UI shows "ET"
//                      or "PEN" instead of an inflated minute counter.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE games ADD COLUMN IF NOT EXISTS "halfTimeReached" BOOLEAN NOT NULL DEFAULT FALSE`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE games ADD COLUMN IF NOT EXISTS "phase" VARCHAR(20)`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE games DROP COLUMN IF EXISTS "phase"`);
    await queryInterface.sequelize.query(
      `ALTER TABLE games DROP COLUMN IF EXISTS "halfTimeReached"`,
    );
  },
};
