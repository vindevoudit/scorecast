# Tier 5.1 — Migrations Framework, explained simply

## The problem in plain language

Imagine you have a **filing cabinet** (the database) where your app keeps everything — users, games, picks, comments. Over time, you keep needing to add new drawers or relabel folders: "we need a way to store nicknames now," "let's add a date stamp to comments so we know when they were edited."

Before Tier 5.1, the way ScoreCast handled these changes was a bit like keeping a **handwritten checklist taped to the side of the filing cabinet**. Every time the app started up, it would read the checklist out loud and do each thing on it:

> "If there's no 'role' column on the users folder, add one… if there's no nicknames column, add one… if the comments folder doesn't track edit dates, add it…"

This worked, but it had problems:

1. **No memory of what's already been done.** The checklist had to be written super carefully so that doing it again wouldn't break anything ("if a thing already exists, skip it"). Easy to forget and accidentally break the database.
2. **No way to undo a step.** If someone added a step that turned out to be wrong, there was no clean way to back it out.
3. **No history.** You couldn't look at the checklist and see "this step was added in March 2026 for the comment-edit feature." It was just one big jumble.
4. **Everything ran at startup, every time.** Even in production, where you usually want changes to the database to happen as a deliberate, supervised step — not silently when the app restarts.

## The fix in plain language

Switch from "handwritten checklist on the side of the cabinet" to **a stack of dated index cards in a special drawer**, plus a tiny notepad that records "we did card #1, we did card #2…"

That's literally what `sequelize-cli` and `umzug` give us:

- The **index cards** are files in the `migrations/` folder. Each one is named with a date (`20260513000001-add-user-role.js`) and contains one specific change — "add a 'role' column to the users folder," for example.
- The **tiny notepad** is a hidden table in the database called `SequelizeMeta`. It just lists which cards have been done.
- A new command, `npm run db:migrate`, says: "Look at the notepad, see which cards haven't been done yet, do them, and write their names down."

The benefits, in the same plain language:

1. **The system remembers.** Run `npm run db:migrate` ten times in a row — only the first one does any work. The other nine just say "everything's already up to date."
2. **Undoable.** Each index card has both an "up" side (do the change) and a "down" side (undo it).
3. **A real history.** The cards are dated and named. Anyone joining the team can flip through them and see "ah, this is when nicknames were added."
4. **Controlled in production.** In development the app still applies pending cards automatically when it boots (convenient). In production the app **refuses** to auto-apply them — a human deploying the app has to run `npm run db:migrate` deliberately, like a chef tasting before serving.

## What actually changed in the repo

### Files you'd see if you opened the project folder

A few new folders appeared:

```
migrations/      ← the stack of index cards (7 of them so far)
seeders/         ← a separate stack for "data tweaks," not schema changes
config/          ← tells the migration tool which database to connect to
.sequelizerc     ← tiny file that says "the cards live in /migrations"
```

### Inside `migrations/`, seven cards

Each card represents one historical change. For example:

- Card #1: "Add a `role` column to the users table." (This was originally on the handwritten checklist; now it's a proper card.)
- Card #5: "Add `displayName` and `bio` columns to users." (For the Tier 8 profile feature.)
- Card #7: "Create the `comment_reactions` table." (For the 5-emoji reaction feature.)

…and four others. Together they cover every change that used to live on the handwritten checklist.

### A safety property the cards inherit

The old checklist was written so each step was **safely re-runnable** ("if this column already exists, skip it"). I preserved that property when I converted the steps into cards. This means: **if your database was already updated by the old checklist before Tier 5.1, the new cards see "yep, that change is already done" and do nothing — no risk of damage.** Verified live: running `npm run db:migrate` after the conversion did exactly zero work, which is the correct behaviour.

### Five new commands

| Command                     | What it does                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run db:migrate`        | Apply every card that hasn't been done yet                                                                         |
| `npm run db:migrate:undo`   | Undo the most recent card                                                                                          |
| `npm run db:migrate:status` | List every card and whether it's been done                                                                         |
| `npm run db:seed`           | Apply the data-tweak cards (currently just one: re-hash any leftover plain-text passwords from the demo seed file) |
| `npm run db:seed:undo`      | Reverse the data tweaks                                                                                            |

### Two new pieces in `.env.example`

- `LOG_LEVEL` — for the new logging system (Tier 5.4, separate ship).
- `MIGRATE_ON_BOOT` — only matters in production. Default is "no, don't auto-apply on boot." Setting it to `'true'` says "yes I'm OK with the app applying pending changes whenever it restarts."

### The old "checklist" function still exists but is now a thin wrapper

The function in the code called `runMigrations()` — which used to contain all that handwritten SQL — still exists, but it no longer contains any SQL itself. It just says "hey card system, run any pending cards." If a future contributor tries to drop raw database commands back into that function, the documentation and code comments yell at them to use a migration card instead.

### Documentation refreshed

- A new doc, `MIGRATION_GUIDE.md`, explains the workflow with examples for the most common cases: "I want to add a column," "I want to add a new table," "I want to add a new enum type."
- `CLAUDE.md` and `ARCHITECTURE.md` were updated everywhere they previously described the old checklist approach.
- `.gitignore` got a one-line reminder: "the `migrations/` and `seeders/` folders are real code — keep them in version control."

## Why this matters, even if you don't deploy ScoreCast tomorrow

Today, ScoreCast is just an app you run on your own machine. The migrations framework feels like overkill for that. But:

1. **It's the foundation everything else builds on.** Tiers 6 (security), 7 (real-time), and 4b (live football data) all need to add columns or tables. Each future change will now be a clean, dated, reviewable card — not another scribble on the checklist.
2. **It makes the project "deployable" without surprises.** If you (or anyone else) ever puts ScoreCast on a real server, the deploy step now reads "stop the app, run `npm run db:migrate`, start the app." No mystery boot-time SQL. No "wait, why is the database changing every time we restart?"
3. **It's a one-time investment.** Once the cards exist, every future change is roughly the same amount of work as the old way — but versioned, reversible, and traceable forever.

## The mental shortcut

If you remember exactly one thing: **`migrations/` is where the database's history lives.** Want to change the database? Add a new card to that folder. The system handles the rest.
