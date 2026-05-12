const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Badge = sequelize.define('Badge', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    awardedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  }, {
    tableName: 'badges',
    timestamps: false,
    indexes: [
      { name: 'badges_user_slug_unique', unique: true, fields: ['userId', 'slug'] },
    ],
  });

  return Badge;
};
