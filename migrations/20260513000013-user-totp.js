'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "totpSecret" TEXT`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "totpEnabledAt" TIMESTAMP WITH TIME ZONE`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "totpRecoveryCodes" JSONB`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS "totpSecret"`);
    await queryInterface.sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS "totpEnabledAt"`);
    await queryInterface.sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS "totpRecoveryCodes"`);
  },
};
