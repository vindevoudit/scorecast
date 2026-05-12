'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "displayName" VARCHAR(60)`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS "displayName"`);
    await queryInterface.sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS bio`);
  },
};
