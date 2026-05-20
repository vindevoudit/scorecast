'use strict';

// PWA Chunk 6 — Kickoff reminder de-dup.
//
// The 15-min cron in lib/jobs/sendKickoffReminders.js targets games kicking
// off in the next 15-30 minutes. Without an idempotency flag, a tick that
// fires twice (process restart, clock drift, multi-replica race outside the
// advisory lock window) would notify users twice. Setting
// kickoffReminderSentAt on the game row after dispatch caps each game at one
// reminder regardless of how many ticks see it.
//
// Nullable: legacy rows + future games before the cron runs both stay NULL.

module.exports = {
  async up(queryInterface) {
    const [cols] = await queryInterface.sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'games' AND column_name = 'kickoffReminderSentAt';
    `);
    if (cols.length === 0) {
      await queryInterface.sequelize.query(`
        ALTER TABLE games
        ADD COLUMN "kickoffReminderSentAt" TIMESTAMP WITH TIME ZONE;
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games DROP COLUMN IF EXISTS "kickoffReminderSentAt";
    `);
  },
};
