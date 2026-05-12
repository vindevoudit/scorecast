'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_unique
       ON friendships (LEAST("requesterId", "addresseeId"), GREATEST("requesterId", "addresseeId"))`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS friendships_pair_unique`);
  },
};
