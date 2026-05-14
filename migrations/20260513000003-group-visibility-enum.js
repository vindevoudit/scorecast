'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_groups_visibility') THEN
          CREATE TYPE "public"."enum_groups_visibility" AS ENUM ('private', 'public');
        END IF;
      END $$;
    `);
    await queryInterface.sequelize.query(
      `ALTER TABLE groups ADD COLUMN IF NOT EXISTS visibility "public"."enum_groups_visibility" NOT NULL DEFAULT 'private'`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE groups DROP COLUMN IF EXISTS visibility`);
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "public"."enum_groups_visibility"`);
  },
};
