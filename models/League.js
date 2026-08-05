const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const League = sequelize.define(
    'League',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      // Tier 34 — multi-sport axis. 'football' | 'cricket'. Drives which
      // market a game uses (lib/scoring.js dispatches on games.sport, which is
      // denormalised from here), which cron jobs may touch the league, and
      // which leaderboard tab its points land on. Plain VARCHAR not ENUM so a
      // third sport is a data change. See lib/sports.js for the canonical list.
      sport: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'football',
      },
      sourceProvider: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: 'football-data.org',
      },
      sourceLeagueId: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      country: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      logoUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'leagues',
      timestamps: true,
    },
  );

  return League;
};
