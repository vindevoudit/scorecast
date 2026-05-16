'use strict';

// Tier 4b Chunk 1 — games gain a status enum + live-score columns. The
// live-score sync writes status transitions ('scheduled' → 'in-progress' →
// 'finished'); the existing `result` enum stays for backward compatibility.
// `status='finished' AND result IS NOT NULL` is the new combined "settled"
// state.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_games_status') THEN
          CREATE TYPE "public"."enum_games_status" AS ENUM (
            'scheduled', 'in-progress', 'finished', 'postponed', 'cancelled'
          );
        END IF;
      END $$;
    `);
    await queryInterface.sequelize.query(
      `ALTER TABLE games ADD COLUMN IF NOT EXISTS status "public"."enum_games_status" NOT NULL DEFAULT 'scheduled'`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE games ADD COLUMN IF NOT EXISTS "homeScore" INTEGER`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE games ADD COLUMN IF NOT EXISTS "awayScore" INTEGER`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE games ADD COLUMN IF NOT EXISTS "kickoffTz" VARCHAR(64)`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE games DROP COLUMN IF EXISTS "kickoffTz"`);
    await queryInterface.sequelize.query(`ALTER TABLE games DROP COLUMN IF EXISTS "awayScore"`);
    await queryInterface.sequelize.query(`ALTER TABLE games DROP COLUMN IF EXISTS "homeScore"`);
    await queryInterface.sequelize.query(`ALTER TABLE games DROP COLUMN IF EXISTS status`);
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "public"."enum_games_status"`);
  },
};
