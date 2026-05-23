// Tier 17 backfill: rewrite probabilities for every upcoming fixture in
// a league using the currently-committed model + the current teams' Elo.
//
// Functionally identical to the per-result reactive cascade in
// services/PredictionService.rePredictFutureFixtures, just driven from a
// CLI instead of a result-capture event. Useful for:
//   - One-time backfill after the model is first committed
//   - Re-predicting all upcoming fixtures after a retrain
//   - Resetting probabilities that drifted from manual admin edits
//
// Usage (from repo root with $env:DATABASE_URL set):
//
//   node scripts/backfill-probabilities.mjs [--league PL] [--dry-run]
//
// --league PL    — football-data.org sourceLeagueId (default: PL)
// --dry-run      — log what WOULD be written, don't touch the DB
//
// Idempotent: re-running produces identical writes given the same
// model + same Elo. Safe to run multiple times.

import { Sequelize, Op } from 'sequelize';
import { loadModel, predict } from '../lib/ml/xgboostInference.js';
import { toThreeWay } from '../lib/ml/normalize.js';
import path from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const leagueArgIdx = args.indexOf('--league');
const leagueCode = leagueArgIdx >= 0 ? args[leagueArgIdx + 1] : 'PL';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set in env');
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

const modelPath = path.resolve('lib/ml/models', `${leagueCode}_elo.json`);
const model = loadModel(modelPath, { numFeatures: 2 });
if (!model) {
  console.error(`No model file at ${modelPath}. Train + commit first.`);
  process.exit(1);
}
console.log(`Loaded model: ${modelPath} (${model.trees.length} trees, numClass=${model.numClass})`);

try {
  // Resolve leagueId from the football-data.org code.
  const [leagueRows] = await s.query(
    `SELECT id, name FROM leagues WHERE "sourceLeagueId" = :code AND "sourceProvider" = 'football-data.org' LIMIT 1`,
    { replacements: { code: leagueCode } },
  );
  if (leagueRows.length === 0) {
    throw new Error(`League ${leagueCode} not found`);
  }
  const league = leagueRows[0];
  console.log(`League: ${league.name} (${league.id})`);

  // Pull every upcoming fixture in the league + an Elo map for the teams
  // referenced. Matches PredictionService.rePredictFutureFixtures shape so
  // the backfill produces the exact same output the reactive cascade would.
  const [games] = await s.query(
    `SELECT id, "homeTeam", "awayTeam", "homeProbability", "drawProbability", "awayProbability"
       FROM games
      WHERE "leagueId" = :leagueId AND status = 'scheduled'
      ORDER BY date ASC`,
    { replacements: { leagueId: league.id } },
  );
  console.log(`Found ${games.length} upcoming fixtures in ${leagueCode}`);
  if (games.length === 0) {
    console.log('Nothing to backfill.');
    process.exit(0);
  }

  const teamNames = new Set();
  for (const g of games) {
    teamNames.add(g.homeTeam);
    teamNames.add(g.awayTeam);
  }
  const [teams] = await s.query(
    `SELECT name, elo FROM teams WHERE name IN (:names) AND "leagueId" = :leagueId`,
    { replacements: { names: [...teamNames], leagueId: league.id } },
  );
  const eloByName = new Map(teams.map((t) => [t.name, parseFloat(t.elo)]));
  console.log(`Loaded Elo for ${eloByName.size}/${teamNames.size} unique teams`);

  let written = 0;
  let skipped = 0;
  let unchanged = 0;
  for (const g of games) {
    const homeElo = eloByName.get(g.homeTeam);
    const awayElo = eloByName.get(g.awayTeam);
    if (homeElo == null || awayElo == null) {
      console.warn(
        `  SKIP ${g.homeTeam} vs ${g.awayTeam} (missing Elo for ${homeElo == null ? g.homeTeam : g.awayTeam})`,
      );
      skipped += 1;
      continue;
    }
    let probs;
    try {
      probs = predict(model, [homeElo, awayElo]);
    } catch (err) {
      console.error(`  ERR ${g.id}: predict threw — ${err.message}`);
      skipped += 1;
      continue;
    }
    let triple;
    try {
      triple = toThreeWay(probs[0], probs[1], probs[2]);
    } catch (err) {
      console.error(`  ERR ${g.id}: normalize threw — ${err.message}`);
      skipped += 1;
      continue;
    }

    const prev = {
      home: parseFloat(g.homeProbability),
      draw: parseFloat(g.drawProbability),
      away: parseFloat(g.awayProbability),
    };
    const same =
      Math.abs(prev.home - triple.home) < 1e-6 &&
      Math.abs(prev.draw - triple.draw) < 1e-6 &&
      Math.abs(prev.away - triple.away) < 1e-6;
    if (same) {
      unchanged += 1;
      continue;
    }

    const line = `${g.homeTeam.padEnd(28)} vs ${g.awayTeam.padEnd(28)}  ${prev.home}/${prev.draw}/${prev.away}  ->  ${triple.home}/${triple.draw}/${triple.away}`;
    if (dryRun) {
      console.log('  DRY ' + line);
    } else {
      await s.query(
        `UPDATE games
            SET "homeProbability" = :home, "drawProbability" = :draw, "awayProbability" = :away
          WHERE id = :id`,
        {
          replacements: {
            id: g.id,
            home: triple.home,
            draw: triple.draw,
            away: triple.away,
          },
        },
      );
      console.log('  WRITE ' + line);
    }
    written += 1;
  }

  console.log(
    `\nSummary: written=${written} unchanged=${unchanged} skipped=${skipped}${dryRun ? ' (DRY RUN — no DB writes)' : ''}`,
  );
} finally {
  void Op;
  await s.close();
}
