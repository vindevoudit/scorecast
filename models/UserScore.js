const { DataTypes } = require('sequelize');

// Tier 24 — Materialized per-(userId, leagueId, seasonId) leaderboard
// row. Maintained incrementally by UserScoreService.applyDelta on every
// score-affecting write (pick create/delete, result set/change/clear,
// game cascade-delete). Mirrors the migration 20260528000001-tier24-
// create-user-scores; the compound PRIMARY KEY is declared both in the
// migration (canonical) and here so a fresh sequelize.sync() lands the
// same shape.

module.exports = (sequelize) => {
  const UserScore = sequelize.define(
    'UserScore',
    {
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
      },
      leagueId: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
      },
      seasonId: {
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
      tableName: 'user_scores',
      timestamps: false,
    },
  );

  return UserScore;
};
