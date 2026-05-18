const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Pick = sequelize.define(
    'Pick',
    {
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
      // Pick-time probability snapshot. PickService.createPick writes the
      // three together; lib/scoring.js prefers them over game.* when
      // pickedHomeProbability is non-null (all-or-nothing read). Legacy
      // pre-tier picks have NULL → fallback to live game.* values.
      pickedHomeProbability: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
      },
      pickedDrawProbability: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
      },
      pickedAwayProbability: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
      },
      submittedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'picks',
      timestamps: false,
      indexes: [{ name: 'picks_user_game_unique', unique: true, fields: ['userId', 'gameId'] }],
    },
  );

  return Pick;
};
