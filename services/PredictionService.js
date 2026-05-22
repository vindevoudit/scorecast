'use strict';

// Tier 17 — PredictionService. The reactive bridge between a captured
// match result and the probability rewrites for every upcoming fixture
// involving either team.
//
// Two-step shape (mirrors Tier 5.3 notify/badge fan-out pattern):
//
//   1. onResultCaptured(game, { transaction }) — runs INSIDE the
//      result-capture transaction. Locks both team rows with
//      SELECT ... FOR UPDATE, updates Elo via lib/ml/eloMath. If
//      the result rolls back, the Elo updates roll back too.
//      Returns { affectedTeams, leagueId } | null (null when a team
//      is missing from the teams table — graceful skip, logged warn).
//
//   2. rePredictFutureFixtures({ affectedTeams, leagueId }) — runs
//      AFTER the result transaction commits. Reads the just-committed
//      Elo from teams + writes new probabilities to every upcoming
//      fixture in the same league involving any affected team. NOT
//      transactional w.r.t. the result; a partial failure here doesn't
//      roll back the result. Caller wraps in .catch() so a model-load
//      error never breaks the result-capture flow.
//
// Graceful no-ops:
//  - missing model file (PR B → PR C handoff before training): loadModel
//    returns null → rePredictFutureFixtures logs warn + returns
//    { rewritten: 0 } without touching any rows.
//  - missing team row: onResultCaptured logs warn + returns null →
//    cascade skipped. LeagueService.upsertFixture's auto-insert closes
//    this gap going forward for newly-synced teams.

const path = require('path');
const { Op } = require('sequelize');

const { Team, Game } = require('../models');
const logger = require('../lib/logger');
const eloMath = require('../lib/ml/eloMath');
const xgboost = require('../lib/ml/xgboostInference');
const normalize = require('../lib/ml/normalize');

// Per-league model cache. Models are loaded lazily on first access so
// boot doesn't fail when the JSON file is missing (PR B → PR C handoff)
// — instead, getModel returns null and the cascade no-ops cleanly. Once
// the trained PL_elo.json is committed and the new image rolls out, the
// cache populates on the first cascade call.
const MODEL_PATHS = {
  PL: path.join(__dirname, '..', 'lib', 'ml', 'models', 'PL_elo.json'),
};
const modelCache = new Map();

function getModelForSourceLeagueCode(code) {
  if (modelCache.has(code)) return modelCache.get(code);
  const p = MODEL_PATHS[code];
  if (!p) {
    // No model defined for this league at all. Cache the null so we
    // don't re-warn on every cascade.
    modelCache.set(code, null);
    return null;
  }
  // numFeatures: 2 (homeElo, awayElo). Bumping this requires retraining
  // + updating the feature vector below in rePredictFutureFixtures.
  const model = xgboost.loadModel(p, { numFeatures: 2 });
  modelCache.set(code, model);
  return model;
}

// Reset the per-league cache. Mostly useful for tests that drop a model
// file in and out at runtime. Production code path doesn't call this.
function _resetModelCache() {
  modelCache.clear();
}

// Update both teams' Elo INSIDE the caller's transaction. Returns the
// information the caller needs to fire the post-commit cascade. Null
// when either team is missing (logged warn).
async function onResultCaptured(game, { transaction }) {
  if (!game || !game.result || !game.leagueId) {
    logger.warn(
      {
        gameId: game && game.id,
        hasResult: Boolean(game && game.result),
        leagueId: game && game.leagueId,
      },
      'onResultCaptured: missing required game fields; skipping Elo update',
    );
    return null;
  }
  const homeTeam = await Team.findOne({
    where: { name: game.homeTeam, leagueId: game.leagueId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const awayTeam = await Team.findOne({
    where: { name: game.awayTeam, leagueId: game.leagueId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!homeTeam || !awayTeam) {
    logger.warn(
      {
        gameId: game.id,
        leagueId: game.leagueId,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeTeamMissing: !homeTeam,
        awayTeamMissing: !awayTeam,
      },
      'onResultCaptured: team not in teams table; skipping Elo update. LeagueService.upsertFixture auto-insert should close this gap on next sync.',
    );
    return null;
  }
  // teams.elo is DECIMAL(8,2) which Sequelize returns as a STRING.
  // parseFloat before any math — load-bearing precision invariant.
  const homeEloBefore = parseFloat(homeTeam.elo);
  const awayEloBefore = parseFloat(awayTeam.elo);
  const { newHomeElo, newAwayElo } = eloMath.updateElos(homeEloBefore, awayEloBefore, game.result);

  // Round the persisted value to DECIMAL(3,2). Math stays in JS floats
  // until persistence so the next cascade reads back the rounded value.
  const homeEloAfter = Math.round(newHomeElo * 100) / 100;
  const awayEloAfter = Math.round(newAwayElo * 100) / 100;
  // game.date can be either a Date (Sequelize returns) or a string; coerce
  // to YYYY-MM-DD for the DATEONLY column.
  const matchDate = game.date instanceof Date ? game.date : new Date(game.date);
  const lastMatchDate = Number.isNaN(matchDate.getTime())
    ? null
    : matchDate.toISOString().slice(0, 10);

  await homeTeam.update(
    {
      elo: homeEloAfter,
      gamesPlayed: homeTeam.gamesPlayed + 1,
      lastMatchDate,
    },
    { transaction },
  );
  await awayTeam.update(
    {
      elo: awayEloAfter,
      gamesPlayed: awayTeam.gamesPlayed + 1,
      lastMatchDate,
    },
    { transaction },
  );

  logger.info(
    {
      gameId: game.id,
      leagueId: game.leagueId,
      result: game.result,
      home: { team: game.homeTeam, before: homeEloBefore, after: homeEloAfter },
      away: { team: game.awayTeam, before: awayEloBefore, after: awayEloAfter },
    },
    'onResultCaptured: Elo updated',
  );

  return { affectedTeams: [game.homeTeam, game.awayTeam], leagueId: game.leagueId };
}

// Resolve the league's source code (e.g. "PL") from the leagueId. Used
// to pick the right model file. Avoids importing LeagueService to dodge
// the dependency cycle; one extra query per cascade is cheap.
async function _resolveLeagueCode(leagueId) {
  // Models module is required at the top; pull League off it.
  const { League } = require('../models');
  const league = await League.findByPk(leagueId, { attributes: ['sourceLeagueId'] });
  return league ? league.sourceLeagueId : null;
}

// Rewrite probabilities for every upcoming fixture in `leagueId` that
// involves any team in `affectedTeams`. Runs OUTSIDE the result-capture
// transaction. Failures are logged and swallowed by the caller so they
// can't break the result commit.
async function rePredictFutureFixtures({ affectedTeams, leagueId }) {
  if (!leagueId || !Array.isArray(affectedTeams) || affectedTeams.length === 0) {
    return { rewritten: 0, skipped: 'no input' };
  }
  const leagueCode = await _resolveLeagueCode(leagueId);
  if (!leagueCode) {
    logger.warn({ leagueId }, 'rePredictFutureFixtures: league not found; skipping');
    return { rewritten: 0, skipped: 'no league' };
  }
  const model = getModelForSourceLeagueCode(leagueCode);
  if (!model) {
    logger.warn(
      { leagueCode, leagueId, affectedTeams },
      'rePredictFutureFixtures: no model file for league; cascade no-op until lib/ml/models/<code>_elo.json is committed',
    );
    return { rewritten: 0, skipped: 'no model' };
  }

  const games = await Game.findAll({
    where: {
      leagueId,
      status: 'scheduled',
      [Op.or]: [{ homeTeam: { [Op.in]: affectedTeams } }, { awayTeam: { [Op.in]: affectedTeams } }],
    },
  });
  if (games.length === 0) return { rewritten: 0 };

  // Bulk-fetch every team referenced by these fixtures (the affected
  // team(s) plus their opponents) so we make one query instead of N.
  const teamNames = new Set();
  for (const g of games) {
    teamNames.add(g.homeTeam);
    teamNames.add(g.awayTeam);
  }
  const teams = await Team.findAll({
    where: { name: { [Op.in]: [...teamNames] }, leagueId },
  });
  const eloByName = new Map(teams.map((t) => [t.name, parseFloat(t.elo)]));

  let rewritten = 0;
  let skipped = 0;
  for (const g of games) {
    const homeElo = eloByName.get(g.homeTeam);
    const awayElo = eloByName.get(g.awayTeam);
    if (homeElo == null || awayElo == null) {
      // Opponent team not in teams table — skip this fixture. Should be
      // rare after LeagueService.upsertFixture auto-inserts.
      skipped += 1;
      continue;
    }
    let probs;
    try {
      probs = xgboost.predict(model, [homeElo, awayElo]);
    } catch (err) {
      logger.error(
        { err, gameId: g.id, homeElo, awayElo },
        'rePredictFutureFixtures: xgboost.predict threw; skipping fixture',
      );
      skipped += 1;
      continue;
    }
    let triple;
    try {
      triple = normalize.toThreeWay(probs[0], probs[1], probs[2]);
    } catch (err) {
      logger.error(
        { err, gameId: g.id, probs },
        'rePredictFutureFixtures: normalize.toThreeWay threw; skipping fixture',
      );
      skipped += 1;
      continue;
    }
    await g.update({
      homeProbability: triple.home,
      drawProbability: triple.draw,
      awayProbability: triple.away,
    });
    rewritten += 1;
  }
  logger.info(
    { leagueId, leagueCode, affectedTeams, rewritten, skipped },
    'rePredictFutureFixtures: cascade complete',
  );
  return { rewritten, skipped };
}

module.exports = {
  onResultCaptured,
  rePredictFutureFixtures,
  // Test seam — production code paths don't call this.
  _resetModelCache,
};
