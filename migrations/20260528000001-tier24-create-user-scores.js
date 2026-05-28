'use strict';

// Tier 24 Chunk 1 — Materialized leaderboard scores.
//
// Replaces the O(picks × games) JS aggregation in lib/users.js
// `buildUserSummary` + lib/groups.js `buildGroupLeaderboard` with two
// materialized tables maintained incrementally on every score-affecting
// write.
//
// Schema:
//
// `user_scores` keyed on (userId, leagueId, seasonId) — one row per user
// per (league, season) bucket. The per-league/season axes mirror the
// existing leaderboard filter contract (Tier 4b Chunk 3 + post-Tier-4b
// "Leaderboard filters" invariant) so a filtered read becomes a single
// indexed SELECT.
//
// `user_scores_overall` keyed on (userId) — separate table (not a
// synthetic UUID hack on user_scores) so the unfiltered overall read
// stays a single PRIMARY KEY lookup and FK CASCADE from users still
// drops both tables atomically without referential gymnastics.
//
// `picks.appliedResult` + `picks.appliedPoints` — idempotency sentinels
// mirroring Tier 17's `games.{homeEloPre, awayEloPre, appliedResult}`
// pattern. `appliedResult` records the `game.result` value last reflected
// in this pick's contribution; `appliedPoints` records the integer
// delta currently in `user_scores`. Together they let the dual-writer
// hook implement the 8-arm idempotency/reversibility matrix without
// re-reading every game row on every transition.
//
// Indexes:
//  - PRIMARY KEY (userId, leagueId, seasonId) on user_scores; (userId)
//    on user_scores_overall. These ARE the read path's hot key.
//  - Partial index (leagueId, seasonId, points DESC, userId) WHERE
//    points > 0 on user_scores — covers `ORDER BY points DESC LIMIT N`
//    for the top-N read; the tail (points = 0) is excluded so the
//    fresh-launch baseline of 90% inactive users doesn't bloat the
//    index.
//  - Backstop index (points DESC, userId) WHERE points > 0 on
//    user_scores_overall.
//
// FKs:
//  - userId → users(id) ON DELETE CASCADE — drops both tables when a
//    user is removed (no explicit cleanup in UserService.cascadeDelete
//    needed; FK does it inside the existing transaction).
//  - leagueId / seasonId → leagues/seasons ON DELETE CASCADE — same
//    rationale; a deleted league shouldn't leave dangling buckets.
//
// CLAUDE.md migrations-framework invariant: raw SQL with explicit
// `IF NOT EXISTS` guards (the `sequelize.sync({ alter: false })` boot
// path runs BEFORE umzug so any column-add helper that lacks an
// IF-NOT-EXISTS semantic would fail in CI's migrations-smoke job).

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS user_scores (
        "userId"      UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
        "leagueId"    UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        "seasonId"    UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
        points        INTEGER NOT NULL DEFAULT 0,
        "picksScored" INTEGER NOT NULL DEFAULT 0,
        "picksWon"    INTEGER NOT NULL DEFAULT 0,
        "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("userId", "leagueId", "seasonId")
      )
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS user_scores_topn_idx
        ON user_scores ("leagueId", "seasonId", points DESC, "userId")
        WHERE points > 0
    `);

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS user_scores_overall (
        "userId"      UUID NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        points        INTEGER NOT NULL DEFAULT 0,
        "picksScored" INTEGER NOT NULL DEFAULT 0,
        "picksWon"    INTEGER NOT NULL DEFAULT 0,
        "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS user_scores_overall_topn_idx
        ON user_scores_overall (points DESC, "userId")
        WHERE points > 0
    `);

    // Idempotency sentinels on picks. NULL/0 defaults are correct for
    // every existing row — `scripts/backfill-user-scores.mjs` walks the
    // already-scored picks and stamps both columns to the right values.
    await queryInterface.sequelize.query(`
      ALTER TABLE picks
        ADD COLUMN IF NOT EXISTS "appliedResult" VARCHAR(10)            NULL,
        ADD COLUMN IF NOT EXISTS "appliedPoints" INTEGER     NOT NULL   DEFAULT 0
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE picks
        DROP COLUMN IF EXISTS "appliedResult",
        DROP COLUMN IF EXISTS "appliedPoints"
    `);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS user_scores_overall_topn_idx`);
    await queryInterface.sequelize.query(`DROP TABLE  IF EXISTS user_scores_overall`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS user_scores_topn_idx`);
    await queryInterface.sequelize.query(`DROP TABLE  IF EXISTS user_scores CASCADE`);
  },
};
