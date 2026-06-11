const { DataTypes } = require('sequelize');

// Tier 31 — Matchday graphics automation idempotency ledger. One row per
// (game, graphic-type) the cron job has already rendered + emailed. Compound
// PK (gameId, type), no surrogate id — the pair IS the identity.
module.exports = (sequelize) => {
  const MarketingPost = sequelize.define(
    'MarketingPost',
    {
      gameId: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
      },
      // The graphic type rendered + emailed: 'countdown' | 'picks-vs-model'
      // | 'halftime' | 'fulltime'. VARCHAR(32) leaves headroom for future
      // types without a schema change.
      type: {
        type: DataTypes.STRING(32),
        allowNull: false,
        primaryKey: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'marketing_posts',
      timestamps: false,
    },
  );

  return MarketingPost;
};
