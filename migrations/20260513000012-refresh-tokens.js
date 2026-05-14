'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY,
        "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "tokenHash" VARCHAR(64) NOT NULL UNIQUE,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "userAgent" TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens ("userId")`,
    );
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS refresh_tokens_active_idx ON refresh_tokens ("userId") WHERE "revokedAt" IS NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS refresh_tokens`);
  },
};
