// Tier 19 Chunk 3 — pending request-to-join rows for `private` groups.
// One ACTIVE row per (groupId, requesterId) — enforced via partial unique
// index `WHERE declinedAt IS NULL` (see migration 20260527000001). Declined
// rows persist with `declinedAt` stamped so the 24h cooldown can be
// enforced from the row itself; approved rows are destroyed by the service.

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const GroupJoinRequest = sequelize.define(
    'GroupJoinRequest',
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
      requesterId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      message: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      declinedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'group_join_requests',
      timestamps: false,
    },
  );

  return GroupJoinRequest;
};
