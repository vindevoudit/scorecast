'use strict';

// Tier 30 Phase 3 (Tier 27 Phase A — A2) — Referral fields.
//
// Two new columns on `users`:
//   referralCode      — 8-char uppercase hex tag rendered as "share this
//                       code with a friend". Unique across all users.
//                       Generated server-side at User.create time;
//                       backfilled here for pre-existing rows.
//   referredByUserId  — UUID FK to users(id) ON DELETE SET NULL. Stamped
//                       on User.create when the body includes a valid
//                       referral code. Drives the Recruiter I/II/III
//                       badge tier in BadgeService.evaluateBadges.
//
// Backfill strategy mirrors the Phase 0 groups.discriminator migration —
// deterministic seed from id, collision sweep, then NOT NULL + UNIQUE.

module.exports = {
  async up(queryInterface) {
    // referralCode column
    const [codeCols] = await queryInterface.sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'referralCode';
    `);
    if (codeCols.length === 0) {
      await queryInterface.sequelize.query(`
        ALTER TABLE users
        ADD COLUMN "referralCode" CHAR(8) NULL;
      `);
    }

    // Deterministic initial backfill from id. The first 8 hex chars of
    // the UUID (sans dashes) give us 2^32 keyspace — collisions among
    // UUIDv4 IDs at this granularity are vanishingly unlikely, but we
    // run a collision sweep anyway.
    await queryInterface.sequelize.query(`
      UPDATE users
      SET "referralCode" = UPPER(LEFT(REPLACE(id::text, '-', ''), 8))
      WHERE "referralCode" IS NULL;
    `);

    let attempt = 0;
    for (;;) {
      const [dupes] = await queryInterface.sequelize.query(`
        SELECT "referralCode" FROM users
        GROUP BY "referralCode"
        HAVING COUNT(*) > 1;
      `);
      if (dupes.length === 0) break;
      attempt += 1;
      if (attempt > 50) {
        throw new Error('users referralCode backfill: collision sweep exceeded 50 iterations');
      }
      for (const row of dupes) {
        await queryInterface.sequelize.query(
          `
          UPDATE users
          SET "referralCode" = UPPER(LEFT(MD5(random()::text || id::text), 8))
          WHERE id IN (
            SELECT id FROM users
            WHERE "referralCode" = :tag
            ORDER BY "createdAt" ASC
            OFFSET 1
          );
        `,
          { replacements: { tag: row.referralCode } },
        );
      }
    }

    await queryInterface.sequelize.query(`
      ALTER TABLE users ALTER COLUMN "referralCode" SET NOT NULL;
    `);
    const [idxRows] = await queryInterface.sequelize.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'users' AND indexname = 'users_referral_code_uq';
    `);
    if (idxRows.length === 0) {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX users_referral_code_uq
        ON users ("referralCode");
      `);
    }

    // referredByUserId column. SET NULL on cascade so a user delete
    // doesn't blast the downstream referee record — we lose the
    // attribution but keep the user account intact.
    const [refCols] = await queryInterface.sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'referredByUserId';
    `);
    if (refCols.length === 0) {
      await queryInterface.sequelize.query(`
        ALTER TABLE users
        ADD COLUMN "referredByUserId" UUID NULL
        REFERENCES users(id) ON DELETE SET NULL;
      `);
    }
    const [refIdxRows] = await queryInterface.sequelize.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'users' AND indexname = 'users_referred_by_idx';
    `);
    if (refIdxRows.length === 0) {
      await queryInterface.sequelize.query(`
        CREATE INDEX users_referred_by_idx
        ON users ("referredByUserId")
        WHERE "referredByUserId" IS NOT NULL;
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS users_referred_by_idx;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS "referredByUserId";
    `);
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS users_referral_code_uq;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS "referralCode";
    `);
  },
};
