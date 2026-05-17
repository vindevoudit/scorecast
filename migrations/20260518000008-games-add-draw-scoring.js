'use strict';

// Draw-scoring tier — adds drawProbability and the 'draw' result enum value.
//
//   drawProbability — DECIMAL(3,2) NOT NULL DEFAULT 0. Default lets every
//                     existing row pass the sum-to-1 validator with no
//                     ceremony (homeProbability + 0 + awayProbability still
//                     sums to 1). Picks on legacy rows score 0 on a draw
//                     because the formula multiplies by P_d.
//   result enum     — extends ('home','away') → ('home','away','draw').
//                     Postgres ≥ 12 supports ALTER TYPE ADD VALUE inside a
//                     transaction (prod runs PG 16 on Azure Flexible Server,
//                     local docker-compose runs PG 16). Idempotent via
//                     IF NOT EXISTS.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TYPE "public"."enum_games_result" ADD VALUE IF NOT EXISTS 'draw'`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE games ADD COLUMN IF NOT EXISTS "drawProbability" DECIMAL(3,2) NOT NULL DEFAULT 0`,
    );
  },

  async down(queryInterface) {
    // Postgres can't drop an ENUM value without rebuilding the type. Drop
    // the column; leave 'draw' in the enum on rollback (harmless — code
    // won't emit it once the model is rolled back too).
    await queryInterface.sequelize.query(
      `ALTER TABLE games DROP COLUMN IF EXISTS "drawProbability"`,
    );
  },
};
