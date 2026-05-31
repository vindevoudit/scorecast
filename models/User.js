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
      // Phase 0 P0-4 — last time we attempted to send a verification email.
      // UI uses this to render "Sent N min ago" + a [Resend] CTA so users
      // whose initial mail got eaten by spam filters have a visible
      // recovery path.
      lastVerificationSentAt: {
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
      termsAcceptedAt: {
        // Tier 18 Chunk 6 — null until the user accepts the Terms + Privacy
        // Policy. New registrations stamp it on create; existing users get a
        // blocking modal on next sign-in.
        type: DataTypes.DATE,
        allowNull: true,
      },
      termsAcceptedVersion: {
        // Tier 18 Chunk 6 — compares against the app-defined
        // CURRENT_TERMS_VERSION (validation/schemas.js). Bumping the
        // constant triggers a re-prompt for everyone with an older value.
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Tier 30 Phase 3 A1 — Pick-streak state. Maintained by
      // services/StreakService.js, hooked into PickService.createPick
      // post-transaction (fire-and-forget). See StreakService for the
      // full state-machine spec.
      currentDailyStreak: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      longestDailyStreak: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lastStreakDayKey: {
        // YYYY-MM-DD (UTC) — null for users who have never picked.
        type: DataTypes.STRING(10),
        allowNull: true,
      },
      lastStreakFreezeMonth: {
        // YYYY-MM (UTC) — null until the monthly auto-freeze is first
        // consumed. Compared against the current month at evaluation
        // time; if they differ, a freeze is available.
        type: DataTypes.STRING(7),
        allowNull: true,
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
