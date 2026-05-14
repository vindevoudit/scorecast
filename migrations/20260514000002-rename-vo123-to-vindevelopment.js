'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE users
         SET username = 'vindevelopment',
             email = 'vindevoudit@gmail.com',
             "emailVerifiedAt" = NOW()
       WHERE username = 'vo123'`,
    );
  },

  async down() {},
};
