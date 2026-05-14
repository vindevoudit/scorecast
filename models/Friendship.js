const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Friendship = sequelize.define(
    'Friendship',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      requesterId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      addresseeId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('pending', 'accepted'),
        allowNull: false,
        defaultValue: 'pending',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      acceptedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'friendships',
      timestamps: false,
    },
  );

  return Friendship;
};
