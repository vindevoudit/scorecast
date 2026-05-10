const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Game = sequelize.define('Game', {
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
  }, {
    tableName: 'games',
    timestamps: false,
  });

  return Game;
};
