'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE users
         SET "totpSecret" = NULL,
             "totpEnabledAt" = NULL,
             "totpRecoveryCodes" = NULL
       WHERE "totpSecret" IS NOT NULL
          OR "totpEnabledAt" IS NOT NULL
          OR "totpRecoveryCodes" IS NOT NULL`,
    );
  },

  async down() {},
};
