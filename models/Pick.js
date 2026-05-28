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
      // Tier 24 — idempotency sentinels for the materialized user_scores
      // table. `appliedResult` records the game.result value last reflected
      // in this pick's contribution; `appliedPoints` records the integer
      // delta currently in user_scores. Together they enable the 8-arm
      // idempotency/reversibility matrix without re-reading every game row
      // on every transition. Mirrors Tier 17's
      // games.{homeEloPre, awayEloPre, appliedResult} pattern.
      appliedResult: {
        type: DataTypes.STRING(10),
        allowNull: true,
      },
      appliedPoints: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
