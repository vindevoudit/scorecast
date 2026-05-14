'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "loginAttempts" INTEGER NOT NULL DEFAULT 0`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP WITH TIME ZONE`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS "loginAttempts"`);
    await queryInterface.sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS "lockedUntil"`);
  },
};
