'use strict';

// Tier 31 — Matchday graphics automation idempotency ledger.
//
// One row per (game, graphic-type) the matchday cron job has already rendered
// + emailed (lib/jobs/postMatchdayGraphics.js). Keeping the "already sent"
// record OFF the hot `games` table (which is mutated every 30 s by live-score
// sync) avoids write amplification; the compound PK (gameId, type) makes the
// "have we posted this yet?" check a single index probe and the post-send
// stamp a single INSERT ... ON CONFLICT DO NOTHING.
//
// CASCADE invariant (CLAUDE.md): the gameId FK declares ON DELETE CASCADE so a
// retro game delete (admin bulk-delete, GameService.cascadeDelete) drops the
// ledger rows atomically. Idempotent via IF NOT EXISTS so re-runs are safe —
// raw SQL with explicit guards per the migrations-framework invariant (the
// CI smoke runs sync() before db:migrate, so queryInterface.createTable has no
// IF NOT EXISTS semantic and would collide).

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS marketing_posts (
        "gameId" UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        type VARCHAR(32) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("gameId", type)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS marketing_posts CASCADE;`);
  },
};
