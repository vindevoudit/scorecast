// One-shot operator script: flip the WC league's `active` flag to true
// so the daily fixture-sync cron starts pulling World Cup fixtures from
// football-data.org. Idempotent — running on an already-active row is a
// no-op. Required after the INT seeder lands the 333-nation Elo bootstrap
// (run-int-seed.mjs); without seeded teams the fixture sync would fall
// back to LeagueService.upsertFixture's auto-insert at min(elo) = 1500
// for every nation, defeating the historical Elo bootstrap.
//
// Outputs only ASCII status for compatibility with `az containerapp exec`
// on Windows hosts (see scripts/run-int-seed.mjs header for the codec
// rationale). Uses a raw Sequelize connection (not models/index.js) to
// avoid triggering umzug auto-migrate side effects on script invoke —
// same pattern as scripts/backfill-user-scores.mjs.

import { Sequelize } from 'sequelize';

const url = process.env.DATABASE_URL;
if (!url) {
  process.stdout.write('STATUS=FAIL REASON=missing_database_url\n');
  process.exit(1);
}

const opts = url.includes('sslmode=require')
  ? {
      dialect: 'postgres',
      dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
      logging: false,
    }
  : { dialect: 'postgres', logging: false };

const sequelize = new Sequelize(url, opts);

try {
  const [rows] = await sequelize.query(
    `SELECT id, name, active FROM leagues
     WHERE "sourceProvider" = 'football-data.org' AND "sourceLeagueId" = 'WC'
     LIMIT 1`,
  );
  if (rows.length === 0) {
    process.stdout.write('STATUS=FAIL REASON=no_wc_league_row\n');
    await sequelize.close();
    process.exit(1);
  }
  const wc = rows[0];
  const wasActive = wc.active === true;
  if (!wasActive) {
    await sequelize.query(
      `UPDATE leagues SET active = true, "updatedAt" = NOW()
       WHERE id = :id`,
      { replacements: { id: wc.id } },
    );
  }
  const safeName = String(wc.name).replace(/[^ -~]/g, '');
  process.stdout.write(
    `STATUS=OK WAS_ACTIVE=${wasActive} NOW_ACTIVE=true WC_LEAGUE_ID=${wc.id} NAME=${safeName}\n`,
  );
  await sequelize.close();
  process.exit(0);
} catch (err) {
  const safeMsg = String(err.message || err).replace(/[^ -~]/g, '');
  process.stdout.write(`STATUS=FAIL EXCEPTION=${safeMsg}\n`);
  try {
    await sequelize.close();
  } catch (closeErr) {
    process.stderr.write(`SEQUELIZE_CLOSE_FAILED=${closeErr.message}\n`);
  }
  process.exit(1);
}
