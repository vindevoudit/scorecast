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
