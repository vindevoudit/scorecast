'use strict';

// Retrofits ON DELETE CASCADE onto the user-owned FKs that were created by
// `sequelize.sync()` on the original prod deploy with the default NO ACTION
// behavior. The original CREATE TABLE migrations for the token tables
// declared CASCADE, but they ran AFTER sync had already created the tables,
// so their `CREATE TABLE IF NOT EXISTS` blocks no-op'd and the wrong FK
// stuck around. This migration drops + recreates each constraint with the
// correct ON DELETE CASCADE behavior.
//
// Safe to run on a clean DB: each ALTER uses IF EXISTS for the drop, and
// the ADD CONSTRAINT name matches what sequelize.sync() produces, so on a
// virgin DB it will:
//   - either find the constraint (created by sync) and replace it
//   - or no-op the drop and re-add the same constraint (same end state)
//
// Idempotent: rerunning is a no-op because every recreated constraint is
// identical to the one we just added.

const TARGETS = [
  { table: 'email_verification_tokens', column: 'userId', refTable: 'users', refColumn: 'id' },
  { table: 'password_reset_tokens', column: 'userId', refTable: 'users', refColumn: 'id' },
  { table: 'refresh_tokens', column: 'userId', refTable: 'users', refColumn: 'id' },
  { table: 'notifications', column: 'userId', refTable: 'users', refColumn: 'id' },
  { table: 'badges', column: 'userId', refTable: 'users', refColumn: 'id' },
  { table: 'comment_reactions', column: 'commentId', refTable: 'comments', refColumn: 'id' },
];

module.exports = {
  async up(queryInterface) {
    for (const t of TARGETS) {
      const constraintName = `${t.table}_${t.column}_fkey`;
      await queryInterface.sequelize.query(
        `ALTER TABLE "${t.table}" DROP CONSTRAINT IF EXISTS "${constraintName}"`,
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "${t.table}"
           ADD CONSTRAINT "${constraintName}"
           FOREIGN KEY ("${t.column}")
           REFERENCES "${t.refTable}" ("${t.refColumn}")
           ON DELETE CASCADE`,
      );
    }
  },

  async down(queryInterface) {
    // Revert to NO ACTION (the pre-migration state). This is technically
    // lossy in that we cannot reproduce the exact original sync-generated
    // constraint name signature if it differed, but the names follow the
    // Sequelize default so they will match.
    for (const t of TARGETS) {
      const constraintName = `${t.table}_${t.column}_fkey`;
      await queryInterface.sequelize.query(
        `ALTER TABLE "${t.table}" DROP CONSTRAINT IF EXISTS "${constraintName}"`,
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "${t.table}"
           ADD CONSTRAINT "${constraintName}"
           FOREIGN KEY ("${t.column}")
           REFERENCES "${t.refTable}" ("${t.refColumn}")`,
      );
    }
  },
};
