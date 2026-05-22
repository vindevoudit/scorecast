const { DataTypes } = require('sequelize');

// Tier 17 — Team. Per-(name, leagueId) Elo state. Mirrors the migration
// 20260522000001-create-teams. The compound unique index is declared both
// in the migration (canonical) and here so a fresh sequelize.sync() lands
// the same shape. `elo` is DECIMAL(8,2) — Sequelize returns it as a STRING,
// so service code that does math on it must parseFloat() first.

module.exports = (sequelize) => {
  const Team = sequelize.define(
    'Team',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      leagueId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'leagues', key: 'id' },
        onDelete: 'CASCADE',
      },
      elo: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: false,
        defaultValue: 1500.0,
      },
      gamesPlayed: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lastMatchDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
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
      tableName: 'teams',
      timestamps: true,
      indexes: [
        { unique: true, fields: ['name', 'leagueId'], name: 'teams_name_league_unique' },
        { fields: ['leagueId'], name: 'teams_league_idx' },
      ],
    },
  );

  return Team;
};
