const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$/;

async function hashPasswordIfNeeded(user) {
  if (user.changed('password') && user.password && !BCRYPT_HASH_PATTERN.test(user.password)) {
    user.password = await bcrypt.hash(user.password, 10);
  }
}

module.exports = (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      username: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(254),
        allowNull: true,
        validate: {
          isEmail: true,
        },
      },
      emailVerifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM('user', 'admin'),
        allowNull: false,
        defaultValue: 'user',
      },
      displayName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      bio: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      loginAttempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      totpSecret: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      totpEnabledAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      totpRecoveryCodes: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      onboardingCompletedAt: {
        // Tier 11 Chunk 4 — null until the user finishes or skips the
        // first-run tour rendered by <OnboardingTour />.
        type: DataTypes.DATE,
        allowNull: true,
      },
      profileVisibility: {
        // Tier 8.6 — 'public' (default; existing behavior), 'friends'
        // (only accepted friends see the full profile), 'private' (only
        // self + admins). Leaderboard rows are masked for non-public users
        // when the viewer isn't a friend/admin/group-mate.
        type: DataTypes.ENUM('public', 'friends', 'private'),
        allowNull: false,
        defaultValue: 'public',
      },
      pushPreferences: {
        // PWA Chunk 4 — JSONB map of notification-type → boolean. Absent or
        // true means "deliver"; only an explicit `false` opts out. Empty
        // object {} is the implicit "deliver everything" default a user gets
        // when they first subscribe; the per-type toggles in PushSettingsPanel
        // (Chunk 5) populate explicit keys here.
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'users',
      timestamps: false,
      hooks: {
        beforeCreate: hashPasswordIfNeeded,
        beforeUpdate: hashPasswordIfNeeded,
      },
    },
  );

  return User;
};
