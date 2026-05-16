const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Season = sequelize.define(
    'Season',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      leagueId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      year: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      startsAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      endsAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      current: {
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
      tableName: 'seasons',
      timestamps: true,
    },
  );

  return Season;
};
