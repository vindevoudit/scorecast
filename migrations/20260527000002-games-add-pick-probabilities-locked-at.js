'use strict';

// Tier 19 Chunk 5 — kickoff-time pick scoring lock.
//
// `games.pickProbabilitiesLockedAt TIMESTAMPTZ NULL` — stamped at the
// moment every pick on this game has its `pickedHomeProbability` /
// `pickedDrawProbability` / `pickedAwayProbability` snapshot rewritten to
// match the game's current probabilities. After this stamp, every pick on
// the game scores against identical numbers — the "pick early at long
// odds" gameplay loop is gone; same-team picks pay the same regardless of
// pick time.
//
// Two writers fire the stamp (defense in depth):
//  1. The `lockPickProbabilities` cron — 1-min cadence, sweeps any
//     scheduled game whose kickoff has passed and isn't locked yet.
//  2. `GameService.applyLiveUpdate` — when upstream transitions a game
//     from scheduled → in-progress, locks inside the same FOR UPDATE
//     transaction so the status flip and the snapshot rewrite are atomic.
//
// The partial index on `(status, date) WHERE "pickProbabilitiesLockedAt"
// IS NULL` keeps the cron's hot query cheap on a growing games table —
// only the small set of unlocked-and-scheduled rows need to be scanned.
//
// Existing rows: stays NULL. The cron filters by `status='scheduled'`, so
// already-finished games are skipped — their picks already carry their
// historical snapshots (the now-obsolete pick-time write path). The
// "don't retroactively reshuffle" invariant from the draw-scoring tier
// applies: we DON'T re-equalize finished games.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        ADD COLUMN IF NOT EXISTS "pickProbabilitiesLockedAt" TIMESTAMPTZ NULL
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS games_unlocked_scheduled_idx
        ON games (status, date)
        WHERE "pickProbabilitiesLockedAt" IS NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS games_unlocked_scheduled_idx
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        DROP COLUMN IF EXISTS "pickProbabilitiesLockedAt"
    `);
  },
};
