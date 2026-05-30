'use strict';

// Phase 0 P0-4 — track when we last attempted to send a verification
// email. UI surfaces "Sent N min ago" + a [Resend] button so users whose
// initial mail got eaten by spam filters have a visible path back, and
// operators have a queryable column when triaging "I never got the email"
// support tickets.

module.exports = {
  async up(queryInterface) {
    const [cols] = await queryInterface.sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'lastVerificationSentAt';
    `);
    if (cols.length === 0) {
      await queryInterface.sequelize.query(`
        ALTER TABLE users
        ADD COLUMN "lastVerificationSentAt" TIMESTAMP WITH TIME ZONE;
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS "lastVerificationSentAt";
    `);
  },
};
