'use strict';

// Tier 4b Chunk 3 — audit_log table. One row per admin mutation, written
// by middleware/auditLog.js. actorUserId is SET NULL on user delete so
// the history survives an admin getting removed.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "actorUserId" UUID REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(80) NOT NULL,
        "entityType" VARCHAR(40) NOT NULL,
        "entityId" VARCHAR(128),
        before JSONB,
        after JSONB,
        "requestId" VARCHAR(80),
        "statusCode" INTEGER,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log ("createdAt" DESC)`,
    );
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log ("actorUserId")`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS audit_log CASCADE`);
  },
};
