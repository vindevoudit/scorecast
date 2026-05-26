'use strict';

// Tier 18 Chunk 6 — Terms of Service acceptance tracking.
//
// Both columns nullable: existing users at the time of this migration land
// on NULL/NULL and the frontend renders a blocking acceptance modal on
// their next sign-in. New users created post-migration get both fields
// stamped during registration so the modal never fires for them.
//
// `termsAcceptedVersion` is an INT that compares against an app-defined
// CURRENT_TERMS_VERSION constant. When we ever change material terms, we
// bump the constant; every user with an older recorded version re-prompts
// on next visit. Avoids us needing a second migration to do the same.

module.exports = {
  async up(queryInterface) {
    const [acceptedAtCols] = await queryInterface.sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'termsAcceptedAt';
    `);
    if (acceptedAtCols.length === 0) {
      await queryInterface.sequelize.query(`
        ALTER TABLE users
        ADD COLUMN "termsAcceptedAt" TIMESTAMP WITH TIME ZONE;
      `);
    }
    const [versionCols] = await queryInterface.sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'termsAcceptedVersion';
    `);
    if (versionCols.length === 0) {
      await queryInterface.sequelize.query(`
        ALTER TABLE users
        ADD COLUMN "termsAcceptedVersion" INTEGER;
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS "termsAcceptedVersion";
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS "termsAcceptedAt";
    `);
  },
};
