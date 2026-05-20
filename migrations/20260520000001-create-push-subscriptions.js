'use strict';

// PWA Chunk 4 — Web Push infrastructure.
//
// Adds `push_subscriptions` (one row per browser/device that opted in) and
// `users.pushPreferences` (JSONB map of notification-type -> boolean). The
// subscription row holds the three fields the browser hands us at subscribe
// time: endpoint URL, p256dh public key, auth secret.
//
// CASCADE invariant (CLAUDE.md): the userId FK declares ON DELETE CASCADE so a
// retro `User.destroy()` doesn't error on dangling subscriptions. Mirrors the
// pattern locked in by 20260516000002-cascade-user-fks.js. Idempotent via
// `IF NOT EXISTS` so re-runs are safe.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        "userAgent" TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "lastUsedAt" TIMESTAMP WITH TIME ZONE,
        "failureCount" INTEGER NOT NULL DEFAULT 0
      );
    `);

    // One subscription per (user, endpoint) pair — re-subscribing from the
    // same device replaces rather than appends. INSERT ... ON CONFLICT in the
    // service relies on this constraint.
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_endpoint_idx
      ON push_subscriptions ("userId", endpoint);
    `);

    // Index for the per-user fan-out query in PushService.sendToUser.
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
      ON push_subscriptions ("userId");
    `);

    // Per-type push preferences. Absent key (or true) means "deliver"; only
    // `false` opts out. JSONB so adding a new notification type is a no-op
    // schema-wise. Default `{}` so existing users implicitly opt in to
    // everything once they subscribe — then the Settings UI can flip
    // individual types off.
    const [usersCols] = await queryInterface.sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'pushPreferences';
    `);
    if (usersCols.length === 0) {
      await queryInterface.sequelize.query(`
        ALTER TABLE users
        ADD COLUMN "pushPreferences" JSONB NOT NULL DEFAULT '{}'::jsonb;
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS "pushPreferences";`,
    );
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS push_subscriptions CASCADE;`);
  },
};
