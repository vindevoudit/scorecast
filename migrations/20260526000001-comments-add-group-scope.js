'use strict';

// Tier 18 Chunk 5 — group running comments. Extends the comments table to
// support either game-scoped (existing) OR group-scoped (new) threads via
// a sibling `groupId` column. The CHECK constraint enforces that exactly
// one of (gameId, groupId) is set per row, so the model stays self-validating
// and a buggy caller can't insert a comment with no scope (or both).
//
// CASCADE invariant (CLAUDE.md, post-Tier-11 cascade fix): the new FK
// declares ON DELETE CASCADE so deleting a group atomically removes its
// comments at the SQL layer. Belt-and-braces: GroupService.cascadeDelete
// also explicitly destroys group comments inside the transaction, matching
// the user-cascade pattern.
//
// Idempotent — re-running is safe via IF NOT EXISTS guards + a check for
// the constraint's existence before adding.

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    // 1. Add nullable groupId column with FK + cascade.
    const [groupIdCols] = await sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'comments' AND column_name = 'groupId';
    `);
    if (groupIdCols.length === 0) {
      await sequelize.query(`
        ALTER TABLE comments
        ADD COLUMN "groupId" UUID NULL REFERENCES groups(id) ON DELETE CASCADE;
      `);
    }

    // 2. Partial index on groupId for the per-group listing query.
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS comments_group_idx
      ON comments("groupId") WHERE "groupId" IS NOT NULL;
    `);

    // 3. Loosen gameId to nullable so the CHECK constraint can enforce
    //    the "exactly one scope" rule. Existing rows are unaffected
    //    (they all have a non-null gameId and that stays true).
    await sequelize.query(`
      ALTER TABLE comments ALTER COLUMN "gameId" DROP NOT NULL;
    `);

    // 4. CHECK constraint: exactly one of (gameId, groupId) must be set.
    //    Cast booleans to int and sum so the predicate equals 1 for valid
    //    rows. The IF NOT EXISTS guard avoids a re-apply error.
    const [chkRows] = await sequelize.query(`
      SELECT 1 FROM pg_constraint
      WHERE conname = 'comments_one_scope_chk';
    `);
    if (chkRows.length === 0) {
      await sequelize.query(`
        ALTER TABLE comments
        ADD CONSTRAINT comments_one_scope_chk
        CHECK ((("gameId" IS NOT NULL)::int + ("groupId" IS NOT NULL)::int) = 1);
      `);
    }
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;
    // Reverse order: constraint → loosen back to NOT NULL → drop index →
    // drop column. The NOT NULL retighten only succeeds if no group-scoped
    // rows exist (gameId would be null for those). Down-migrations against
    // a populated group-comments table will need a manual cleanup first;
    // for the e2e suite the truncate-and-reseed handles this.
    await sequelize.query(`
      ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_one_scope_chk;
    `);
    await sequelize.query(`
      ALTER TABLE comments ALTER COLUMN "gameId" SET NOT NULL;
    `);
    await sequelize.query(`DROP INDEX IF EXISTS comments_group_idx;`);
    await sequelize.query(`ALTER TABLE comments DROP COLUMN IF EXISTS "groupId";`);
  },
};
