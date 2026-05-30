'use strict';

// Phase 0 T29-1 — Group discriminator.
//
// 6-char uppercase hex tag rendered alongside every group name so two
// "Friday Football" groups are visually distinct. Server-set, never
// user-input. Unique across all groups.
//
// Backfill strategy: derive from id (first 6 hex chars of the UUID, sans
// dashes) for existing rows so we land deterministic values without a
// random sweep. Pre-existing dupes are exceptionally unlikely with
// UUIDv4 randomness at 6-hex granularity but we run a collision sweep
// after the backfill that rewrites colliding rows with a fresh md5
// fragment until uniqueness holds. Only then do we add the NOT NULL +
// UNIQUE constraints.

module.exports = {
  async up(queryInterface) {
    const [cols] = await queryInterface.sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'groups' AND column_name = 'discriminator';
    `);
    if (cols.length === 0) {
      await queryInterface.sequelize.query(`
        ALTER TABLE groups
        ADD COLUMN discriminator CHAR(6) NULL;
      `);
    }
    // Initial backfill — deterministic from id.
    await queryInterface.sequelize.query(`
      UPDATE groups
      SET discriminator = UPPER(LEFT(REPLACE(id::text, '-', ''), 6))
      WHERE discriminator IS NULL;
    `);
    // Resolve any collisions by rewriting one side of each duplicate.
    // Loop until no duplicates remain (worst-case O(dupes) iterations,
    // typically 0-1 in practice).
    let attempt = 0;
    for (;;) {
      const [dupes] = await queryInterface.sequelize.query(`
        SELECT discriminator FROM groups
        GROUP BY discriminator
        HAVING COUNT(*) > 1;
      `);
      if (dupes.length === 0) break;
      attempt += 1;
      if (attempt > 50) {
        throw new Error('groups discriminator backfill: collision sweep exceeded 50 iterations');
      }
      for (const row of dupes) {
        // Rewrite all but one (oldest by createdAt) with a fresh md5 tag.
        await queryInterface.sequelize.query(
          `
          UPDATE groups
          SET discriminator = UPPER(LEFT(MD5(random()::text || id::text), 6))
          WHERE id IN (
            SELECT id FROM groups
            WHERE discriminator = :tag
            ORDER BY "createdAt" ASC
            OFFSET 1
          );
        `,
          { replacements: { tag: row.discriminator } },
        );
      }
    }
    // Now lock in the NOT NULL + unique constraint.
    await queryInterface.sequelize.query(`
      ALTER TABLE groups ALTER COLUMN discriminator SET NOT NULL;
    `);
    const [idxRows] = await queryInterface.sequelize.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'groups' AND indexname = 'groups_discriminator_uq';
    `);
    if (idxRows.length === 0) {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX groups_discriminator_uq
        ON groups (discriminator);
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS groups_discriminator_uq;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE groups DROP COLUMN IF EXISTS discriminator;
    `);
  },
};
