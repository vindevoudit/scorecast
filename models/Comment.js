const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Comment = sequelize.define(
    'Comment',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Tier 18 Chunk 5 — gameId is now nullable; comments are EITHER
      // game-scoped (gameId set) OR group-scoped (groupId set). A DB
      // CHECK constraint enforces "exactly one" so the model can't get
      // into an invalid state regardless of caller bugs.
      gameId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      groupId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      editedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'comments',
      timestamps: false,
      indexes: [{ name: 'comments_game_idx', fields: ['gameId'] }],
    },
  );

  return Comment;
};
