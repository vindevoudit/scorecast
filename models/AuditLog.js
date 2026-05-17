const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AuditLog = sequelize.define(
    'AuditLog',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      actorUserId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      entityType: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      entityId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      before: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      after: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      requestId: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      statusCode: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'audit_log',
      timestamps: false,
    },
  );

  return AuditLog;
};
