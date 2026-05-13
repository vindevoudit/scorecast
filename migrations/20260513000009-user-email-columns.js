'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254)`);
    await queryInterface.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email)) WHERE email IS NOT NULL`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP WITH TIME ZONE`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS users_email_lower_unique`);
    await queryInterface.sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS email`);
    await queryInterface.sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS "emailVerifiedAt"`);
  },
};
