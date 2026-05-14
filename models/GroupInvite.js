const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const GroupInvite = sequelize.define(
    'GroupInvite',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      groupId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      username: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'group_invites',
      timestamps: false,
    },
  );

  return GroupInvite;
};
