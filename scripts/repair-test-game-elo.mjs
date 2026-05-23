// Tier 17 PR F operator cleanup. Use this AFTER PR F has deployed to
// undo the Elo drift left behind on a game whose result was toggled
// before PR F shipped (and so left the appliedResult column NULL).
//
// What it does, atomically per transaction:
//   1. Wipes the game's result + appliedResult + snapshot fields back to
//      a clean "never had a result" state.
//   2. Deletes the team rows for the two clubs involved so the next
//      `db:seed --seed 20260522000001-seed-teams-from-elo-history.js`
//      run restores them to canonical historical Elo (the seeder's
//      ON CONFLICT DO NOTHING skips existing rows, so the only way to
//      restore is delete+reinsert).
//
// Usage (run from repo root, $env:DATABASE_URL pointing at the env you
// want to repair):
//
//   node scripts/repair-test-game-elo.mjs <gameId> "Home FC" "Away FC"
//
// Example:
//   node scripts/repair-test-game-elo.mjs 584d2195-... "Newcastle United FC" "West Ham United FC"
//
// Then run:
//   npx sequelize-cli db:seed --seed 20260522000001-seed-teams-from-elo-history.js
//
// to put the two team rows back at canonical Elo. After that, the game
// is back to scheduled state with no Elo contribution and you can
// re-set its result via Admin if needed — that capture will route
// through PR F's first-capture path and behave correctly going forward.

import { Sequelize, Op } from 'sequelize';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set in env');
  process.exit(1);
}

const [, , gameId, homeTeam, awayTeam] = process.argv;
if (!gameId || !homeTeam || !awayTeam) {
  console.error(
    'Usage: node scripts/repair-test-game-elo.mjs <gameId> "<homeTeam>" "<awayTeam>"',
  );
  process.exit(1);
}

const opts = url.includes('sslmode=require')
  ? {
      dialect: 'postgres',
      dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
      logging: false,
    }
  : { logging: false };

const s = new Sequelize(url, opts);

try {
  await s.transaction(async (t) => {
    // Show before-state for audit.
    const [gameBefore] = await s.query(
      `SELECT id, "homeTeam", "awayTeam", result, "appliedResult", "homeEloPre", "awayEloPre" FROM games WHERE id = :gameId`,
      { replacements: { gameId }, transaction: t },
    );
    if (gameBefore.length === 0) {
      throw new Error(`game ${gameId} not found`);
    }
    console.log('game before:', gameBefore[0]);

    const [teamsBefore] = await s.query(
      `SELECT name, elo, "gamesPlayed", "lastMatchDate" FROM teams WHERE name IN (:names)`,
      { replacements: { names: [homeTeam, awayTeam] }, transaction: t },
    );
    console.log('teams before:');
    for (const r of teamsBefore) console.log(' ', r);

    // Clear the game's result + Elo snapshot + appliedResult. Status goes
    // back to scheduled since the row no longer has a captured result.
    const [, gameUpdateMeta] = await s.query(
      `UPDATE games SET result = NULL, "appliedResult" = NULL,
         "homeEloPre" = NULL, "awayEloPre" = NULL, status = 'scheduled'
       WHERE id = :gameId`,
      { replacements: { gameId }, transaction: t },
    );
    console.log('cleared game; rowCount =', gameUpdateMeta?.rowCount ?? 'n/a');

    // Delete the two team rows. The seeder will re-insert at canonical
    // historical Elo on its next run via ON CONFLICT-aware INSERT.
    const [, teamDeleteMeta] = await s.query(
      `DELETE FROM teams WHERE name IN (:names)`,
      { replacements: { names: [homeTeam, awayTeam] }, transaction: t },
    );
    console.log('deleted teams; rowCount =', teamDeleteMeta?.rowCount ?? 'n/a');
  });

  console.log('\nDone. Next step:');
  console.log(
    '  npx sequelize-cli db:seed --seed 20260522000001-seed-teams-from-elo-history.js',
  );
  console.log(
    'That re-seeds the two deleted team rows at their canonical historical Elo.',
  );
} finally {
  // Suppress unused-var warning for Op (imported but only relevant via
  // the named import contract for future query helpers).
  void Op;
  await s.close();
}
