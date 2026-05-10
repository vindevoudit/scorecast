const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const GroupMember = sequelize.define('GroupMember', {
    groupId: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
  }, {
    tableName: 'group_members',
    timestamps: false,
  });

  return GroupMember;
};
