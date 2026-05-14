'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_role') THEN
          CREATE TYPE "public"."enum_users_role" AS ENUM ('user', 'admin');
        END IF;
      END $$;
    `);
    await queryInterface.sequelize.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS role "public"."enum_users_role" NOT NULL DEFAULT 'user'`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS role`);
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "public"."enum_users_role"`);
  },
};
