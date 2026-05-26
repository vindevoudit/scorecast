'use strict';

// Tier 19 Chunks 1 + 3 — visibility model + password-protected join + request-to-join.
//
// New visibility taxonomy:
//   public  — free join, fully discoverable
//   private — discoverable (search/discover), joinable via request, invite,
//             or password (any one of the three paths)
//   secret  — hidden (search returns 404 to non-members), invite-only
//
// Migration choice: existing rows with `visibility='private'` are renamed
// to `visibility='secret'` so their original "invite-only / hidden"
// behavior is preserved. The new (more permissive) `private` is added as
// a separate enum value for new groups. `ALTER TYPE … RENAME VALUE` (PG
// 10+) flips every existing row transparently — no data UPDATE needed.
//
// Password is an OPTIONAL feature of private groups. `groups.passwordHash`
// stores a bcrypt hash (60 bytes; col sized 72 for future cost bumps);
// NULL means no password set. When visibility flips away from 'private'
// the service layer nulls the column out (see GroupService.setVisibility).
//
// `group_join_requests` carries the request-to-join workflow:
//   - One active row per (groupId, requesterId) — enforced via partial
//     UNIQUE index `WHERE declinedAt IS NULL`.
//   - Decline stamps `declinedAt = NOW()` instead of destroying the row,
//     so the 24h cooldown can be enforced from the row itself.
//   - Approve destroys the row (no cooldown after approval).
//   - Cancel (by requester) destroys the row (no stigma).
//
// Postgres specifics:
//   - ALTER TYPE … RENAME VALUE: PG 10+, transactional. Renames the label
//     in pg_enum; existing rows reading the column see the new label
//     instantly with no data write.
//   - ALTER TYPE … ADD VALUE: PG 12+ transactional. Idempotent via
//     IF NOT EXISTS.
//
// Down: drops the column + table. Postgres can't drop ENUM values
// without rebuilding the type, so 'private' and 'secret' both stay in
// the type on rollback (harmless once the model rolls back too).

module.exports = {
  async up(queryInterface) {
    // 1. Rename existing 'private' to 'secret' so legacy invite-only
    //    groups preserve their semantic. Guarded inside a DO block so a
    //    re-run after a partial failure (e.g. table creation errored on
    //    first attempt) doesn't trip on "label already exists" — we only
    //    rename if 'private' still exists AND 'secret' doesn't yet.
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumtypid = 'public.enum_groups_visibility'::regtype
            AND enumlabel = 'private'
        ) AND NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumtypid = 'public.enum_groups_visibility'::regtype
            AND enumlabel = 'secret'
        ) THEN
          ALTER TYPE "public"."enum_groups_visibility" RENAME VALUE 'private' TO 'secret';
        END IF;
      END$$;
    `);

    // 2. Add the new 'private' enum value (now means discoverable +
    //    multi-path join).
    await queryInterface.sequelize.query(
      `ALTER TYPE "public"."enum_groups_visibility" ADD VALUE IF NOT EXISTS 'private'`,
    );

    // 3. groups.passwordHash — bcrypt hash for password-gated private
    //    groups. NULL = no password set.
    await queryInterface.sequelize.query(
      `ALTER TABLE groups ADD COLUMN IF NOT EXISTS "passwordHash" VARCHAR(72) NULL`,
    );

    // 4. group_join_requests — pending requests, with declinedAt for
    //    cooldown bookkeeping. `gen_random_uuid()` is built into Postgres
    //    13+ (no extension needed); matches the convention used by every
    //    other create-table migration in this codebase.
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "group_join_requests" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "groupId" UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        "requesterId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "message" VARCHAR(160) NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "declinedAt" TIMESTAMPTZ NULL
      );
    `);

    // Partial unique index — one ACTIVE request per (group, user). Multiple
    // declined rows can coexist as cooldown bookkeeping.
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "group_join_requests_active_uniq"
      ON "group_join_requests" ("groupId", "requesterId")
      WHERE "declinedAt" IS NULL;
    `);

    // Owner-side list query index.
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "group_join_requests_group_idx"
      ON "group_join_requests" ("groupId");
    `);
  },

  async down(queryInterface) {
    // Postgres can't drop an enum value without rebuilding the type. We
    // leave 'private' AND 'secret' in the type on rollback (rename can't
    // be reversed cleanly either — old 'private' rows are now 'secret').
    // Drop the new table + column.
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS "group_join_requests"`);
    await queryInterface.sequelize.query(`ALTER TABLE groups DROP COLUMN IF EXISTS "passwordHash"`);
  },
};
