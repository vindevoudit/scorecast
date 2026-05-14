const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Group = sequelize.define(
    'Group',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      ownerId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      visibility: {
        type: DataTypes.ENUM('private', 'public'),
        allowNull: false,
        defaultValue: 'private',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'groups',
      timestamps: false,
    },
  );

  return Group;
};
