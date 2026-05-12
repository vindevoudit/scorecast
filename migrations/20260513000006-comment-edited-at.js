'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE comments ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP WITH TIME ZONE`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE comments DROP COLUMN IF EXISTS "editedAt"`);
  },
};
