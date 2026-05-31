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
      // Tier 30 Phase 3 A1 Revision (2026-05-31) — Win-streak state.
      // Maintained by services/StreakService.js via fire-and-forget hooks
      // from GameService.{setResult, bulkSetResult, applyLiveUpdate}
      // POST-transaction. The streak is per-result (W increments, D no-op,
      // L resets) and recomputed from full pick history on every scoring
      // event — see StreakService for the full spec.
      currentWinStreak: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      longestWinStreak: {
        // Monotonic high-water mark. Never decreases on a recompute, even
        // when result corrections trim the actual current run.
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lastMilestoneFired: {
        // Largest milestone in STREAK_MILESTONES the user has been pushed
        // about. Used for dedup so a stable streak doesn't re-fire on
        // every recompute. Drops back to the largest M ≤ currentWinStreak
        // when the current value falls, so re-crossings re-fire.
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Tier 30 Phase 3 A2 — Referral fields.
      // referralCode is generated server-side at User.create time
      // (8-char uppercase hex via crypto.randomBytes(4)); never user
      // input. Unique across all users.
      // referredByUserId is stamped at create time when the registering
      // user provides a valid code; null otherwise. Powers the Recruiter
      // I/II/III badge tier in BadgeService.evaluateBadges.
      referralCode: {
        type: DataTypes.STRING(8),
        allowNull: false,
        unique: true,
      },
      referredByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
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
