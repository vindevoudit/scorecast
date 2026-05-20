const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PushSubscription = sequelize.define(
    'PushSubscription',
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
      // The Push API endpoint URL the browser handed us at subscribe time —
      // a unique opaque URL per browser/device install. Long (~200-400 chars
      // for FCM, Apple WebPush, Mozilla autopush), so TEXT not STRING.
      endpoint: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // Public key half of the ECDH-P256 keypair the browser generated for
      // payload encryption. Base64url-encoded, ~88 chars.
      p256dh: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // 16-byte auth secret, base64url-encoded ~24 chars.
      auth: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // User agent at subscribe time, for "Active sessions" display + debug.
      userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Auto-purge after 5 consecutive non-410 failures (network errors,
      // 5xx). 410 Gone deletes immediately because the push service is
      // telling us the subscription is dead.
      failureCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'push_subscriptions',
      timestamps: false,
      indexes: [
        {
          name: 'push_subscriptions_user_endpoint_idx',
          unique: true,
          fields: ['userId', 'endpoint'],
        },
        { name: 'push_subscriptions_user_idx', fields: ['userId'] },
      ],
    },
  );

  return PushSubscription;
};
