'use strict';

// Tier 34.1 — per-game sport + the T20 innings columns.
//
// WHY games.sport IS DENORMALISED FROM leagues.sport
// --------------------------------------------------
// lib/scoring.js `scorePick(pick, game)` must remain a PURE function of its
// two arguments with no extra query, because it is called from ~10 places
// (lib/scoring, src/utils/scoring, UserScoreService.computePoints,
// PickService.listFriendsPicks, UserService, StatsService, lib/users,
// lib/groups, and two marketing renderers). Requiring a league join to learn
// the market would mean editing every one of them. The trade is a column with
// no FK-level enforcement, so GameService.createGame and
// scripts/import-cricket-fixtures.mjs MUST stamp it from the owning league.
// A game never changes league, so the value is stable once written.
//
// WHY BALLS RATHER THAN OVERS
// ---------------------------
// Cricket overs are base-6 — "17.2" means 17 overs and 2 balls, so decimal
// arithmetic on it is simply wrong. Balls faced (0..120 in a full T20 innings)
// is the only representation you can prorate with. The UI converts at the edge.
//
// WHY BOTH wickets AND allOut
// ---------------------------
// `allOut` is USUALLY `wickets === 10`, but a side can be all out at 9 down
// with a batter absent hurt or retired out. `allOut` is authoritative for
// scoring (it suppresses proration — a bowled-out side's score is what it is);
// `wickets` is for display ("165/6"). The admin form derives one from the
// other with an override so the two cannot silently disagree.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        ADD COLUMN IF NOT EXISTS "sport"           VARCHAR(20) NOT NULL DEFAULT 'football',
        ADD COLUMN IF NOT EXISTS "homeBallsFaced"  INTEGER     NULL,
        ADD COLUMN IF NOT EXISTS "awayBallsFaced"  INTEGER     NULL,
        ADD COLUMN IF NOT EXISTS "homeWickets"     INTEGER     NULL,
        ADD COLUMN IF NOT EXISTS "awayWickets"     INTEGER     NULL,
        ADD COLUMN IF NOT EXISTS "homeAllOut"      BOOLEAN     NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS "awayAllOut"      BOOLEAN     NOT NULL DEFAULT FALSE
    `);

    // Idempotent backfill. A no-op today (every league is football and the
    // column default already covers it), but correct if a cricket league is
    // ever created before this migration runs on a lagging environment.
    // MUST live in the same migration as the ADD COLUMN — splitting them
    // would leave the pair out of step under `db:migrate:undo:all`.
    await queryInterface.sequelize.query(`
      UPDATE games g
         SET "sport" = l."sport"
        FROM leagues l
       WHERE l.id = g."leagueId"
         AND g."sport" <> l."sport"
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS games_sport_idx ON games ("sport")
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS games_sport_idx`);
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        DROP COLUMN IF EXISTS "sport",
        DROP COLUMN IF EXISTS "homeBallsFaced",
        DROP COLUMN IF EXISTS "awayBallsFaced",
        DROP COLUMN IF EXISTS "homeWickets",
        DROP COLUMN IF EXISTS "awayWickets",
        DROP COLUMN IF EXISTS "homeAllOut",
        DROP COLUMN IF EXISTS "awayAllOut"
    `);
  },
};
