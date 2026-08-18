'use strict';

// CPL auto-results — the DB half of automatic cricket result capture.
//
// Everything that requires a judgement lives in lib/cricketResult.js as pure
// functions; this file is the part that touches rows. It does three things:
// resolve provider match ids onto local games, claim a game for automatic
// capture, and hand the derived payload to the existing
// CricketResultService.setCricketResult.
//
// WHY IT DOES NOT WRITE THE SCORECARD ITSELF
// ------------------------------------------
// CricketResultService writes the innings columns in their own transaction and
// only THEN calls GameService.setResult, whose SELECT ... FOR UPDATE re-read
// observes them. Written the other way round, UserScoreService's
// `oldResult === newResult && oldPoints === newPoints` short-circuit fires on a
// correction and silently drops it. That ordering is load-bearing and already
// correct, so the automatic path reuses it verbatim rather than reimplementing
// a write.
//
// WHY THE CLAIM IS A CONDITIONAL UPDATE
// -------------------------------------
// An admin correcting a scorecard and a cron tick re-deriving the same match
// are genuinely concurrent. Checking `resultSource` in JS and then writing
// would leave a window where the cron overwrites a correction typed a moment
// earlier. `UPDATE ... WHERE resultSource IS NULL` settles it in the database:
// whoever gets there first owns the game, and because the admin route stamps
// 'admin', a corrected game is excluded from every future tick for good.

const { Op } = require('sequelize');
const { Game } = require('../models');
const logger = require('../lib/logger');
const { CRICKET } = require('../lib/sports');
const { buildCricketResultPayload, resolveMatches } = require('../lib/cricketResult');
const { cricketResultSchema } = require('../validation/schemas');
const CricketResultService = require('./CricketResultService');
const AuditLogService = require('./AuditLogService');

// Beyond this, the automation gives up and the match needs manual entry. See
// the `needsManualEntry` alarm in lib/jobs/resolveCricketMatchIds.js.
//
// 12h is the steady-state value: it comfortably covers a rain-delayed finish
// while keeping the eligibility gate — and therefore the API budget — closed
// the rest of the time.
//
// CRICKET_CAPTURE_LOOKBACK_HOURS exists for ONE-OFF CATCH-UP. When the provider
// is switched on mid-season there is a backlog of played-but-uncaptured matches
// sitting well outside 12h, and they would otherwise only ever be reachable by
// hand. Set it wide (e.g. 720 for a month), let one tick run, then REMOVE IT —
// left in place it holds the gate open continuously and spends budget on games
// the automation has already given up on. Every safety layer still applies to a
// catch-up run: the claim, the schema check, and every refusal rule.
const CAPTURE_LOOKBACK_MS =
  (Number(process.env.CRICKET_CAPTURE_LOOKBACK_HOURS) || 12) * 60 * 60 * 1000;
// A match cannot plausibly be over sooner than this, so there is nothing to
// look at before it. A rain-reduced 10-over game can finish inside 90 minutes.
const CAPTURE_EARLIEST_MS = 2 * 60 * 60 * 1000;

function writeEnabled() {
  const raw = process.env.CRICKET_RESULT_WRITE_ENABLED;
  return raw === '1' || String(raw).toLowerCase() === 'true';
}

/**
 * Cricket games that are plausibly finishing and have never been captured.
 *
 * `resultSource: null` is the claimable state; `result: null` is belt-and-
 * braces for any legacy row written before this column existed on a path that
 * bypassed the stamp.
 */
function eligibleGamesWhere(leagueIds, now = Date.now()) {
  return {
    leagueId: { [Op.in]: leagueIds },
    sport: CRICKET,
    resultSource: null,
    result: null,
    status: { [Op.notIn]: ['finished', 'cancelled', 'postponed'] },
    date: {
      [Op.lte]: new Date(now - CAPTURE_EARLIEST_MS),
      [Op.gte]: new Date(now - CAPTURE_LOOKBACK_MS),
    },
  };
}

async function countEligibleGames(leagueIds, now = Date.now()) {
  if (!leagueIds || leagueIds.length === 0) return 0;
  return Game.count({ where: eligibleGamesWhere(leagueIds, now) });
}

async function listEligibleGames(leagueIds, now = Date.now()) {
  if (!leagueIds || leagueIds.length === 0) return [];
  return Game.findAll({ where: eligibleGamesWhere(leagueIds, now), order: [['date', 'ASC']] });
}

/**
 * Stamp providerMatchId onto every local game that resolves to exactly one
 * provider match. Idempotent: already-stamped games are skipped by the pure
 * resolver, and the UPDATE re-asserts `providerMatchId: null` so a concurrent
 * tick cannot double-write.
 */
async function resolveMatchIds({ league, providerMatches, now = Date.now() }) {
  const games = await Game.findAll({
    where: { leagueId: league.id, sport: CRICKET, providerMatchId: null },
    order: [['date', 'ASC']],
  });
  if (games.length === 0) return { resolved: [], unresolved: [], stamped: 0 };

  const { resolved, unresolved } = resolveMatches(games, providerMatches, {
    leagueCode: league.sourceLeagueId,
    now,
  });

  let stamped = 0;
  for (const row of resolved) {
    try {
      const [affected] = await Game.update(
        { providerMatchId: row.providerMatchId, providerMatchResolvedAt: new Date() },
        { where: { id: row.gameId, providerMatchId: null } },
      );
      if (affected > 0) stamped += 1;
    } catch (err) {
      // games_league_provider_match_unique fired — two local games matched one
      // provider match. The pure resolver already refuses ambiguity, so this is
      // a genuine surprise worth an error line, but it must not abort the rest.
      logger.error(
        { err: err.message, gameId: row.gameId, providerMatchId: row.providerMatchId },
        'resolveCricketMatchIds: could not stamp provider match id',
      );
    }
  }

  for (const row of unresolved) {
    if (row.reason === 'placeholder-teams') continue; // reported separately by the job
    logger.warn(
      {
        gameId: row.gameId,
        sourceId: row.sourceId,
        localHome: row.localHome,
        localAway: row.localAway,
        kickoff: row.kickoff,
        reason: row.reason,
      },
      'resolveCricketMatchIds: no provider match — add an alias to data/cricket-team-aliases.json',
    );
  }

  return { resolved, unresolved, stamped };
}

/**
 * Derive and (unless in shadow mode) write one game's result.
 *
 * @returns {{written: boolean, reason?: string, payload?: object, notes?: object}}
 */
async function applyProviderResult({ game, providerMatch, leagueCode }) {
  const built = buildCricketResultPayload(game, providerMatch, { leagueCode });
  if (!built.ok) {
    // 'not-finished' is the overwhelmingly common answer on any tick before the
    // match ends, so it must not be noisy. Everything else is a real refusal
    // that an operator may need to act on.
    const log = built.reason === 'not-finished' ? logger.debug : logger.warn;
    log.call(
      logger,
      {
        gameId: game.id,
        sourceId: game.sourceId,
        providerMatchId: providerMatch.providerMatchId,
        reason: built.reason,
        detail: built.detail,
        status: providerMatch.statusText,
      },
      'syncCricketResults: refusing to auto-capture',
    );
    return { written: false, reason: built.reason };
  }

  // Hold the automatic path to exactly the invariants the admin form obeys —
  // 10 wickets implies allOut, the overs regex, the runs bound, no 'draw'. This
  // is the cheapest possible guarantee that the two entry points cannot drift.
  const parsed = cricketResultSchema.safeParse(built.payload);
  if (!parsed.success) {
    logger.error(
      { gameId: game.id, payload: built.payload, issues: parsed.error.issues },
      'syncCricketResults: derived payload failed cricketResultSchema — not writing',
    );
    return { written: false, reason: 'schema-rejected' };
  }

  if (!writeEnabled()) {
    logger.info(
      {
        gameId: game.id,
        sourceId: game.sourceId,
        providerMatchId: providerMatch.providerMatchId,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        payload: parsed.data,
        notes: built.notes,
      },
      'syncCricketResults: SHADOW would write',
    );
    return { written: false, reason: 'shadow', payload: parsed.data, notes: built.notes };
  }

  // Claim. See the header note — this is where admin-vs-cron is settled.
  const [claimed] = await Game.update(
    { resultSource: 'auto' },
    { where: { id: game.id, resultSource: null, result: null } },
  );
  if (claimed === 0) return { written: false, reason: 'already-captured' };

  try {
    await CricketResultService.setCricketResult(game.id, parsed.data, { source: 'auto' });
  } catch (err) {
    // Release the claim so a transient failure doesn't lock the game out of
    // every future tick. The scorecard columns may already be written (the
    // known two-transaction seam in CricketResultService); the daily resolve
    // job's `stranded` check is what surfaces that.
    await Game.update(
      { resultSource: null },
      { where: { id: game.id, resultSource: 'auto', result: null } },
    ).catch((releaseErr) => {
      logger.error(
        { err: releaseErr.message, gameId: game.id },
        'syncCricketResults: failed to release claim after a write error',
      );
    });
    throw err;
  }

  // Fire-and-forget; AuditLogService.record swallows its own failures. Lands
  // beside the manual admin.game.cricketResult rows in the audit-log tab.
  AuditLogService.record({
    actorUserId: null,
    action: 'cricket.result.auto',
    entityType: 'game',
    entityId: game.id,
    after: { ...parsed.data, providerMatchId: providerMatch.providerMatchId, notes: built.notes },
  });

  logger.info(
    {
      gameId: game.id,
      sourceId: game.sourceId,
      result: parsed.data.result,
      basis: built.notes.basis,
    },
    'syncCricketResults: captured cricket result automatically',
  );
  return { written: true, payload: parsed.data, notes: built.notes };
}

module.exports = {
  CAPTURE_LOOKBACK_MS,
  CAPTURE_EARLIEST_MS,
  writeEnabled,
  eligibleGamesWhere,
  countEligibleGames,
  listEligibleGames,
  resolveMatchIds,
  applyProviderResult,
};
