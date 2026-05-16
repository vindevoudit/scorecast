'use strict';

// Tier 8.6 — per-user profile privacy. 'public' is the existing behavior
// (every authed user can view), 'friends' restricts to accepted friendships,
// 'private' restricts to self + admins. Leaderboard rows mask the username
// for non-public users (rank + points stay; click-through to drawer is
// suppressed). Plan: tier8.6.md.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_profileVisibility') THEN
          CREATE TYPE "public"."enum_users_profileVisibility" AS ENUM ('public', 'friends', 'private');
        END IF;
      END $$;
    `);
    await queryInterface.sequelize.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "profileVisibility" "public"."enum_users_profileVisibility" NOT NULL DEFAULT 'public'`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS "profileVisibility"`,
    );
    await queryInterface.sequelize.query(
      `DROP TYPE IF EXISTS "public"."enum_users_profileVisibility"`,
    );
  },
};
