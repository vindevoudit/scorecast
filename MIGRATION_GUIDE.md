# Migrations Guide

ScoreCast uses [sequelize-cli](https://github.com/sequelize/cli) for schema migrations and seeders. Migrations are the **source of truth for schema changes**; never extend the (deprecated) `runMigrations()` boot helper in `models/index.js` again.

## Layout

```
.sequelizerc                       # tells sequelize-cli where things live
config/database.js                 # dev / test / production DB configs (reads DATABASE_URL)
migrations/                        # versioned schema migrations (numeric prefix = order)
seeders/                           # repeatable data seeds (e.g. password backfill)
```

## Day-to-day workflow

### Run pending migrations (local dev)

```bash
npm run db:migrate
```

Already runs automatically on `node server.js` boot in dev. In production it's a no-op unless you opt in with `MIGRATE_ON_BOOT=true` (default is to skip — run `npm run db:migrate` explicitly during deploy).

### Check status

```bash
npm run db:migrate:status
```

Shows which migrations are applied (`up`) vs pending (`down`).

### Roll back the last migration

```bash
npm run db:migrate:undo
```

> ⚠ `down` paths are **best-effort** and intended for local dev. They drop columns/indexes/types but won't try to restore data. Don't rely on them in production.

### Run seeders

```bash
npm run db:seed         # apply all seeders (idempotent)
npm run db:seed:undo    # roll back all seeders (rarely useful)
```

The current seeder set:

- `20260513000001-seed-password-backfill.js` — re-hashes any plaintext password that matches a `data.json` entry. Idempotent (skips already-bcrypt rows).

## Adding a new migration

1. Generate a stub:

   ```bash
   npx sequelize-cli migration:generate --name add-foo-to-bar
   ```

   This creates `migrations/<timestamp>-add-foo-to-bar.js` with empty `up` / `down` exports.

2. Fill in `up` and `down`. Examples:

   **Add a column** (idempotent):

   ```js
   await queryInterface.sequelize.query(
     `ALTER TABLE games ADD COLUMN IF NOT EXISTS "broadcaster" VARCHAR(80)`,
   );
   ```

   **Add an ENUM type** (idempotent, Postgres-only):

   ```js
   await queryInterface.sequelize.query(`
     DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_games_league') THEN
         CREATE TYPE "public"."enum_games_league" AS ENUM ('EPL', 'LaLiga');
       END IF;
     END $$;
   `);
   ```

   **Add a new table** — use `CREATE TABLE IF NOT EXISTS` because `sequelize.sync({alter:false})` at boot may already have created it from the model definition (this is intentional in dev). The migration is what guarantees the table exists in production where sync is constrained.

3. Update the matching Sequelize model in `models/` if the change adds columns/tables.

4. Apply locally: `npm run db:migrate` (or just restart the server in dev).

5. Verify: `npm run db:migrate:status` lists the new file as `up`.

## Conventions

- **File names**: `YYYYMMDDHHMMSS-short-description.js`. The timestamp determines execution order.
- **Idempotency**: every `up` must succeed on a DB that already has the change. Use `IF NOT EXISTS`, `IF EXISTS`, and `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN null; END $$;` for ENUMs. This is critical because some existing DBs were upgraded via the old `runMigrations()` and the new migration framework needs to be a no-op against them.
- **Transactions**: sequelize-cli wraps each migration in a transaction automatically. Avoid `CREATE INDEX CONCURRENTLY` (incompatible with transactions); use a plain `CREATE INDEX IF NOT EXISTS` instead.
- **Never edit a migration that's been merged to `main`.** Add a new one that adjusts the schema forward.
- **Sequelize `sync({alter:false})`** still runs on boot as a safety net for brand-new tables in dev. It does **not** alter existing tables. Treat the migration as the canonical source of truth.

## Initial migration set

These were extracted from the legacy `runMigrations()` body (now removed). Each is idempotent so it's a no-op against existing DBs that already ran the old boot-time migrations.

| File                                        | Effect                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `20260513000001-add-user-role.js`           | `users.role` ENUM + default `'user'`                                              |
| `20260513000002-pick-unique-index.js`       | `picks_user_game_unique` on `(userId, gameId)`                                    |
| `20260513000003-group-visibility-enum.js`   | `groups.visibility` ENUM `'private' \| 'public'`                                  |
| `20260513000004-friendship-pair-unique.js`  | functional unique index on `LEAST/GREATEST(requesterId, addresseeId)`             |
| `20260513000005-user-displayname-bio.js`    | `users.displayName VARCHAR(60)` + `users.bio TEXT`                                |
| `20260513000006-comment-edited-at.js`       | `comments.editedAt TIMESTAMPTZ`                                                   |
| `20260513000007-comment-reactions-table.js` | `comment_reactions` table + unique `(commentId, userId, emoji)` + commentId index |

## Production deploy checklist

1. Backup the database.
2. Pull the new code.
3. Run `npm run db:migrate` (does **not** run on boot in production by default).
4. Start the app.
5. Verify with `npm run db:migrate:status`.
