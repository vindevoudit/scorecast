const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Pick = sequelize.define('Pick', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    gameId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    choice: {
      type: DataTypes.ENUM('home', 'away'),
      allowNull: false,
    },
    submittedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  }, {
    tableName: 'picks',
    timestamps: false,
  });

  return Pick;
};
