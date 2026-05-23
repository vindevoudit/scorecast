'use strict';

// Tier 13 Chunk 2 — GameService. Owns game list / detail / result / bulk
// ops. setResult and the bulk endpoints fire pick-scored notifications +
// badge evaluations + cache invalidation per the Tier 5.2/5.3 invariants:
// notify() runs OUTSIDE any wrapping transaction; cache invalidate runs
// AFTER the transaction commits.
const { Op } = require('sequelize');
const { Game, League, Pick, Comment, Notification, sequelize } = require('../models');
const errors = require('../lib/errors');
const logger = require('../lib/logger');
const { scorePick } = require('../lib/scoring');
const { mapUpstreamStatus, deriveResultFromFixture } = require('../lib/fixtureStatus');
const NotificationService = require('./NotificationService');
const BadgeService = require('./BadgeService');
const LeaderboardService = require('./LeaderboardService');
const PredictionService = require('./PredictionService');

// Two-layer noise gate threshold. DECIMAL(3,2) stores at 0.01 resolution;
// anything below 0.005 rounds to the same value (and so the same rounded
// payout). Using 0.01 means "the smallest representable probability shift
// that could possibly move a rounded payout."
const PROBABILITY_DELTA_EPSILON = 0.01;
const ODDS_SHIFT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function listGames({ leagueId, seasonId } = {}) {
  const where = {};
  if (leagueId) where.leagueId = leagueId;
  if (seasonId) where.seasonId = seasonId;
  return Game.findAll({ where, order: [['date', 'ASC']] });
}

async function createGame(attrs) {
  // games.leagueId is NOT NULL (Tier 4b Chunk 3) but the admin form
  // doesn't surface a league picker. Default to the Legacy / Imported
  // league created by migration 20260518000007 so manual admin entries
  // still land somewhere identifiable. If the legacy row is missing
  // (shouldn't happen post-migration, but guard anyway), surface a clear
  // 400 instead of letting Postgres reject with a cryptic NOT NULL.
  if (!attrs.leagueId) {
    const legacy = await League.findOne({
      where: { sourceProvider: 'legacy', sourceLeagueId: 'LEGACY' },
    });
    if (!legacy) {
      throw errors.badRequest(
        'No league specified and the Legacy / Imported league is missing — create or pick a league first',
      );
    }
    attrs = { ...attrs, leagueId: legacy.id };
  }
  return Game.create(attrs);
}

async function updateGame(gameId, patch) {
  const game = await Game.findByPk(gameId);
  if (!game) throw errors.notFound('Game not found');

  // Capture BEFORE assign. Sequelize returns DECIMAL columns as strings —
  // parseFloat normalizes so the epsilon comparison below isn't string-vs-
  // number after the save round-trip.
  const prev = {
    home: parseFloat(game.homeProbability),
    draw: parseFloat(game.drawProbability),
    away: parseFloat(game.awayProbability),
  };

  Object.assign(game, patch);
  await game.save();

  const next = {
    home: parseFloat(game.homeProbability),
    draw: parseFloat(game.drawProbability),
    away: parseFloat(game.awayProbability),
  };
  const maxDelta = Math.max(
    Math.abs(prev.home - next.home),
    Math.abs(prev.draw - next.draw),
    Math.abs(prev.away - next.away),
  );
  // Game-level Δ gate runs BEFORE the pick query — otherwise daily ML
  // rewrites with no real shift would walk every pick row for nothing.
  // Skip when the game already has a result — the score is settled, so a
  // "tap to revisit" notification would be meaningless. Awaited so a rapid
  // second admin edit's cooldown check sees the first fan-out's writes (no
  // race), with .catch() preserving the invariant that a fan-out failure
  // must not break the admin's save.
  if (maxDelta >= PROBABILITY_DELTA_EPSILON && !game.result) {
    await notifyOddsShiftFanOut(game, next).catch((err) => {
      logger.error({ err, gameId: game.id }, 'updateGame: odds-shift fan-out failed');
    });
  }
  return game;
}

// Per-pick fan-out for `odds-shifted` notifications. The two-layer noise
// gate's first layer (game-level Δ ≥ 0.01) is checked by the caller; this
// function applies layer two — per-pick "rounded payout actually changed"
// gate — plus a 24h cooldown per (userId, gameId) to keep daily ML drifts
// from producing a notification storm. Only fires for picks WITH non-null
// snapshots (legacy NULL picks have no locked value to compare against and
// are silently skipped). Draw partial-credit shifts are intentionally NOT
// notified — pick.choice is home/away only, draw payouts are bounded by
// drawProbability and noisy. Errors are swallowed: an outage in the fan-out
// must never block the admin's save() / live-score commit.
async function notifyOddsShiftFanOut(game, next) {
  const picks = await Pick.findAll({ where: { gameId: game.id } });
  if (picks.length === 0) return;

  const sinceCutoff = new Date(Date.now() - ODDS_SHIFT_COOLDOWN_MS);
  const link = `/games/${game.id}`;

  for (const pick of picks) {
    if (pick.pickedHomeProbability == null) continue; // legacy: silent skip

    const lockedProb = parseFloat(
      pick.choice === 'home' ? pick.pickedHomeProbability : pick.pickedAwayProbability,
    );
    const currentProb = pick.choice === 'home' ? next.home : next.away;
    const lockedPayout = Math.round((1 - lockedProb) * 100);
    const currentPayout = Math.round((1 - currentProb) * 100);
    if (lockedPayout === currentPayout) continue; // sub-rounding noise

    const recent = await Notification.findOne({
      where: {
        userId: pick.userId,
        type: 'odds-shifted',
        link,
        createdAt: { [Op.gte]: sinceCutoff },
      },
    });
    if (recent) continue;

    const title = `Odds shifted for ${game.homeTeam} vs ${game.awayTeam}`;
    const body = `Your locked pick pays +${lockedPayout}; current odds would pay +${currentPayout}. Tap to revisit.`;
    NotificationService.notify(pick.userId, 'odds-shifted', title, body, link).catch(() => {});
  }
}

async function cascadeDelete(game, { transaction } = {}) {
  const opts = transaction ? { transaction } : {};
  await Pick.destroy({ where: { gameId: game.id }, ...opts });
  await Comment.destroy({ where: { gameId: game.id }, ...opts });
  await game.destroy(opts);
}

async function deleteGame(gameId) {
  const game = await Game.findByPk(gameId);
  if (!game) throw errors.notFound('Game not found');
  await sequelize.transaction(async (t) => {
    await cascadeDelete(game, { transaction: t });
  });
  LeaderboardService.invalidate('all');
}

async function setResult(gameId, result) {
  // Tier 17 — transactional. The Elo update via
  // PredictionService.onResultUpdated MUST be atomic with game.save()
  // (Critical invariant #3) so a rolled-back result rolls back the Elo
  // update too. The notify/badge fan-out and leaderboard cache
  // invalidation stay OUTSIDE the transaction per Tier 5.3 — a side-effect
  // failure must not undo the result commit, and ghost notifications must
  // not appear on rollback. The reactive cascade
  // (rePredictFutureFixtures) also fires AFTER commit so a model-load
  // error in one fixture's rewrite never breaks the result-capture flow.
  //
  // PR F — onResultUpdated runs on EVERY result transition (set / change /
  // clear) including idempotent re-saves. It internally short-circuits
  // when result === appliedResult, reverses any prior delta against the
  // game's locked-in pre-match Elo snapshot, then applies the new delta.
  let cascadeInput = null;
  const game = await sequelize.transaction(async (t) => {
    const g = await Game.findByPk(gameId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!g) throw errors.notFound('Game not found');
    g.result = result;
    g.status = result ? 'finished' : 'scheduled';
    await g.save({ transaction: t });
    if (g.leagueId) {
      cascadeInput = await PredictionService.onResultUpdated(g, { transaction: t });
    }
    return g;
  });

  if (result) {
    const picksForGame = await Pick.findAll({ where: { gameId } });
    for (const pick of picksForGame) {
      const points = scorePick(pick, game);
      NotificationService.notify(
        pick.userId,
        'pick-scored',
        pickResultTitle(pick, game, result, points),
      ).catch(() => {});
      BadgeService.evaluateBadges(pick.userId).catch(() => {});
    }
  }

  LeaderboardService.invalidate('all');
  if (cascadeInput) {
    PredictionService.rePredictFutureFixtures(cascadeInput).catch((err) =>
      logger.error({ err, gameId }, 'setResult: rePredictFutureFixtures failed'),
    );
  }
  return game;
}

async function bulkSetResult(ids, result) {
  if (!(result === 'home' || result === 'away' || result === 'draw' || result === null)) {
    throw errors.badRequest('setResult requires result of home, away, draw, or null');
  }
  const games = await Game.findAll({ where: { id: ids } });
  const affected = [];
  // Coalesce affected teams per league across the entire bulk so the
  // cascade runs once per league at the end — not once per game. A full
  // PL matchday (10 games × 2 teams = 20 entries) becomes ONE cascade
  // call with 20 affected team names, hitting all in-scope upcoming
  // fixtures in a single sweep.
  const affectedByLeague = new Map(); // leagueId → Set<teamName>

  // Tier 17 — each game gets its OWN transaction (Tier 5.3 invariant —
  // one transaction per entity, so a single bad row doesn't undo the
  // rest of the batch). The Elo update inside is atomic with the game
  // save; notify/badge + cache invalidate + cascade run AFTER the
  // batch loop so they can never roll back the commits above them.
  for (const game of games) {
    let cascadeInput = null;
    await sequelize.transaction(async (t) => {
      const g = await Game.findByPk(game.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!g) return;
      g.result = result;
      g.status = result ? 'finished' : 'scheduled';
      await g.save({ transaction: t });
      if (g.leagueId) {
        cascadeInput = await PredictionService.onResultUpdated(g, { transaction: t });
      }
      // Reload the in-memory `game` so the post-tx notify/score uses the
      // committed values (mostly defensive — result + status are already
      // what we set, but g.result might differ if a hook munged it).
      game.result = g.result;
      game.status = g.status;
    });

    if (cascadeInput) {
      const set = affectedByLeague.get(cascadeInput.leagueId) || new Set();
      for (const name of cascadeInput.affectedTeams) set.add(name);
      affectedByLeague.set(cascadeInput.leagueId, set);
    }
    if (result) {
      const picksForGame = await Pick.findAll({ where: { gameId: game.id } });
      for (const pick of picksForGame) {
        const points = scorePick(pick, game);
        NotificationService.notify(
          pick.userId,
          'pick-scored',
          pickResultTitle(pick, game, result, points),
        ).catch(() => {});
        BadgeService.evaluateBadges(pick.userId).catch(() => {});
      }
    }
    affected.push(game.id);
  }
  if (affected.length > 0) LeaderboardService.invalidate('all');
  for (const [leagueId, teamSet] of affectedByLeague) {
    PredictionService.rePredictFutureFixtures({
      leagueId,
      affectedTeams: [...teamSet],
    }).catch((err) =>
      logger.error({ err, leagueId }, 'bulkSetResult: rePredictFutureFixtures failed'),
    );
  }
  return affected;
}

// Format the per-user pick-scored notification title. The three branches —
// won outright, drew with partial credit, missed — mirror the badges shown
// on the GameCard outcome chip so the user sees consistent language across
// the bell and the card.
function pickResultTitle(pick, game, result, points) {
  const matchup = `${game.homeTeam} vs ${game.awayTeam}`;
  if (result === 'draw') return `Your pick on ${matchup}: Drew +${points} pts`;
  if (pick.choice === result) return `Your pick on ${matchup}: ✓ Correct +${points} pts`;
  return `Your pick on ${matchup}: ✗ Missed`;
}

async function bulkDelete(ids) {
  const games = await Game.findAll({ where: { id: ids } });
  const affected = [];
  for (const game of games) {
    await sequelize.transaction(async (t) => {
      await cascadeDelete(game, { transaction: t });
    });
    affected.push(game.id);
  }
  if (affected.length > 0) LeaderboardService.invalidate('all');
  return affected;
}

// Tier 4b Chunk 2 — live-score job entrypoint. Called once per matched
// upstream fixture by lib/jobs/syncLiveScores.js + lib/jobs/
// reconcileInProgressGames.js. Writes the new status/scores/result inside
// a transaction; fires notify + badge + cache invalidation AFTER commit so
// a rollback never leaves ghost messages (CLAUDE.md Tier 5.3 invariant).
// No-ops when nothing changed so the cron polls don't churn the DB.
//
// Concurrency: the 1-min syncLiveScores and 5-min reconcileInProgressGames
// jobs can race on the same row (both fire at xx:00, xx:05, ...). We
// re-fetch the game inside the transaction under `SELECT ... FOR UPDATE`
// so a concurrent call serializes — the second caller observes the first's
// committed writes via the lock + re-fetch, NOT the stale `localGame` the
// caller loaded earlier. Without this, two concurrent saves with stale
// snapshots could overwrite each other (e.g. 5-min sets FINISHED+result,
// 1-min then sets in-progress+null on its stale view, wiping the result).
//
// Status flip-back guard: once `status='finished'` locally, ignore any
// upstream snapshot that isn't itself FINISHED or AWARDED. Reason:
// football-data.org's ?status=LIVE,IN_PLAY,PAUSED filter has been observed
// to lag the canonical ?ids= endpoint by hours (incident 2026-05-19:
// AFC Bournemouth vs Manchester City sourceId 538145 stuck at HT 1-0
// in the LIVE filter long after upstream's ?ids= returned FINISHED+DRAW
// 1-1). Without this guard, after the 5-min reconcile correctly finishes
// the game, the 1-min job's stale snapshot would regress status / scores /
// halfTimeReached on the very next tick.
async function applyLiveUpdate(localGame, apiMatch) {
  const tx = await sequelize.transaction(async (t) => {
    // Use t.LOCK.UPDATE so a concurrent applyLiveUpdate on the same row
    // blocks here until the other transaction commits. The reload sees
    // the committed writes (not the caller's stale snapshot).
    const fresh = await Game.findByPk(localGame.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!fresh) {
      return {
        game: localGame,
        changed: false,
        transitionedToFinished: false,
        newResult: null,
        cascadeInput: null,
      };
    }

    if (
      fresh.status === 'finished' &&
      apiMatch.status !== 'FINISHED' &&
      apiMatch.status !== 'AWARDED'
    ) {
      logger.info(
        { gameId: fresh.id, sourceId: fresh.sourceId, upstreamStatus: apiMatch.status },
        'applyLiveUpdate: ignored stale non-FINISHED upstream snapshot for already-finished game',
      );
      return {
        game: fresh,
        changed: false,
        transitionedToFinished: false,
        newResult: null,
        cascadeInput: null,
      };
    }

    const newStatus = mapUpstreamStatus(apiMatch.status);
    const newHomeScore = apiMatch.homeScore;
    const newAwayScore = apiMatch.awayScore;
    // halfTimeReached is monotonic — once true, never flips back even if
    // upstream temporarily drops the halfTime block.
    const newHalfTimeReached = fresh.halfTimeReached || Boolean(apiMatch.halfTimeReached);
    const newPhase = apiMatch.phase ?? fresh.phase ?? null;

    // Only derive a new result if we don't already have one. We never
    // overwrite an admin's manual entry, and we never flip a previously-set
    // result to a different value automatically.
    let newResult = fresh.result;
    if (fresh.result === null) {
      newResult = deriveResultFromFixture(apiMatch, newStatus);
    }

    const changed =
      fresh.status !== newStatus ||
      fresh.homeScore !== newHomeScore ||
      fresh.awayScore !== newAwayScore ||
      fresh.result !== newResult ||
      fresh.halfTimeReached !== newHalfTimeReached ||
      fresh.phase !== newPhase;

    if (!changed) {
      return {
        game: fresh,
        changed: false,
        transitionedToFinished: false,
        newResult: null,
        cascadeInput: null,
      };
    }

    // A "transition to finished" is when we are now setting a result for
    // the first time. That's what triggers pick scoring + notifications.
    const transitionedToFinished = fresh.result === null && newResult !== null;

    fresh.status = newStatus;
    fresh.homeScore = newHomeScore;
    fresh.awayScore = newAwayScore;
    fresh.result = newResult;
    fresh.halfTimeReached = newHalfTimeReached;
    fresh.phase = newPhase;
    await fresh.save({ transaction: t });

    // Tier 17 — atomic Elo update on the transition-to-finished moment.
    // Same invariant as setResult: the Elo write must roll back with the
    // game row if the transaction aborts. cascadeInput captured here is
    // fired AFTER commit (post-transaction below) so a model load issue
    // never breaks the live-score commit. PR F: applyLiveUpdate never
    // changes a previously-set result (see the result-derivation guard
    // above), so onResultUpdated only ever sees the null→non-null path
    // here. Still call the unified entry point so the snapshot + applied-
    // result columns stay populated.
    let cascadeInput = null;
    if (transitionedToFinished && newResult && fresh.leagueId) {
      cascadeInput = await PredictionService.onResultUpdated(fresh, { transaction: t });
    }
    return { game: fresh, changed: true, transitionedToFinished, newResult, cascadeInput };
  });

  if (tx.transitionedToFinished) {
    try {
      const picksForGame = await Pick.findAll({ where: { gameId: tx.game.id } });
      for (const pick of picksForGame) {
        const points = scorePick(pick, tx.game);
        NotificationService.notify(
          pick.userId,
          'pick-scored',
          pickResultTitle(pick, tx.game, tx.newResult, points),
        ).catch(() => {});
        BadgeService.evaluateBadges(pick.userId).catch(() => {});
      }
    } catch (err) {
      // Notifications are best-effort. Surface the error but don't crash
      // the polling tick — the result is already committed.
      logger.error(
        { err, gameId: tx.game.id },
        'applyLiveUpdate: failed to fan out pick notifications',
      );
    }
    LeaderboardService.invalidate('all');
    // Tier 17 — cascade probabilities for upcoming fixtures involving
    // either team. Best-effort: a model-load failure must NEVER undo the
    // result commit above. tx.cascadeInput is null when either team is
    // missing (logged warn inside onResultCaptured) — silently skip.
    if (tx.cascadeInput) {
      PredictionService.rePredictFutureFixtures(tx.cascadeInput).catch((err) =>
        logger.error(
          { err, gameId: tx.game.id },
          'applyLiveUpdate: rePredictFutureFixtures failed',
        ),
      );
    }
  }

  return {
    game: tx.game,
    changed: tx.changed,
    transitionedToFinished: tx.transitionedToFinished,
  };
}

module.exports = {
  listGames,
  createGame,
  updateGame,
  deleteGame,
  setResult,
  bulkSetResult,
  bulkDelete,
  cascadeDelete,
  applyLiveUpdate,
};
