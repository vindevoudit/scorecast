const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Game = sequelize.define(
    'Game',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      homeTeam: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      awayTeam: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      homeProbability: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: false,
      },
      awayProbability: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: false,
      },
      result: {
        type: DataTypes.ENUM('home', 'away'),
        allowNull: true,
      },
      // Tier 4b Chunk 1 — league/season/source attribution. leagueId stays
      // nullable until Chunk 3 backfills legacy rows and tightens it.
      leagueId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      seasonId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      sourceId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      // Tier 4b Chunk 1 — live-score columns + lifecycle status. The
      // live-score sync writes status transitions; result writes still go
      // through the existing scoring path.
      status: {
        type: DataTypes.ENUM('scheduled', 'in-progress', 'finished', 'postponed', 'cancelled'),
        allowNull: false,
        defaultValue: 'scheduled',
      },
      homeScore: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      awayScore: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      kickoffTz: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
    },
    {
      tableName: 'games',
      timestamps: false,
    },
  );

  return Game;
};
