'use strict';

// Pick-time probability snapshot — three nullable DECIMAL(3,2) columns that
// freeze the game's probabilities at the moment a pick is made. lib/scoring.js
// reads them in preference to game.{home,draw,away}Probability when present,
// so the daily ML cron's --overwrite-existing rewrite can't shift a user's
// locked-in payout after they've committed.
//
// All three are nullable: legacy picks (pre-deploy) keep NULL snapshots and
// fall back to current game.* (preserves the pre-tier behavior). New picks
// always write the trio together (PickService.createPick is atomic).
//
// No new index — picks are looked up by the existing (userId, gameId) unique
// index or by primary key, never by a snapshot value.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('picks', 'pickedHomeProbability', {
      type: Sequelize.DECIMAL(3, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('picks', 'pickedDrawProbability', {
      type: Sequelize.DECIMAL(3, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('picks', 'pickedAwayProbability', {
      type: Sequelize.DECIMAL(3, 2),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('picks', 'pickedAwayProbability');
    await queryInterface.removeColumn('picks', 'pickedDrawProbability');
    await queryInterface.removeColumn('picks', 'pickedHomeProbability');
  },
};
