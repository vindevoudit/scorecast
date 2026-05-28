const { DataTypes } = require('sequelize');

// Tier 24 — Materialized per-userId overall leaderboard row. Same shape
// as user_scores minus the league/season axes; separate table so the
// unfiltered overall read is a single primary-key lookup (no synthetic-
// UUID hack on user_scores). UserScoreService.applyDelta writes to both
// tables in the same transaction.

module.exports = (sequelize) => {
  const UserScoreOverall = sequelize.define(
    'UserScoreOverall',
    {
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
      },
      points: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      picksScored: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      picksWon: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'user_scores_overall',
      timestamps: false,
    },
  );

  return UserScoreOverall;
};
