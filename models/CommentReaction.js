const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CommentReaction = sequelize.define('CommentReaction', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    commentId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    emoji: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  }, {
    tableName: 'comment_reactions',
    timestamps: false,
    indexes: [
      { name: 'comment_reactions_unique', unique: true, fields: ['commentId', 'userId', 'emoji'] },
      { name: 'comment_reactions_comment_idx', fields: ['commentId'] },
    ],
  });

  return CommentReaction;
};
