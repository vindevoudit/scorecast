'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS comment_reactions (
        id UUID PRIMARY KEY,
        "commentId" UUID NOT NULL,
        "userId" UUID NOT NULL,
        emoji VARCHAR(255) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS comment_reactions_unique
       ON comment_reactions ("commentId", "userId", emoji)`,
    );
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS comment_reactions_comment_idx
       ON comment_reactions ("commentId")`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS comment_reactions`);
  },
};
