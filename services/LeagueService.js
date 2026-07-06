'use strict';

// Tier 4b Chunk 1 — LeagueService. CRUD on leagues + fixture sync against
// the football-data.org provider. Sync is idempotent: an upsert keyed on
// (leagueId, sourceId) means re-running pulls the latest kickoff / status
// for known fixtures without creating duplicates.
//
// Per-league cache invalidation is intentional but coarse for now; the
// leaderboard cache is wiped on any new result write inside GameService,
// so a fresh sync that doesn't touch results doesn't need to fire
// LeaderboardService.invalidate() — the cron's live-score path will do
// that when it auto-sets a result.

const { League, Season, Game, sequelize } = require('../models');
const errors = require('../lib/errors');
const logger = require('../lib/logger');
const footballApi = require('../lib/footballApi');
const { mapUpstreamStatus, deriveResultFromFixture } = require('../lib/fixtureStatus');
const { INITIAL_RATING } = require('../lib/ml/eloMath');
const { isPlaceholderTeam } = require('../lib/placeholderTeam');

async function listLeagues() {
  return League.findAll({ order: [['name', 'ASC']] });
}

async function getLeagueById(id) {
  const league = await League.findByPk(id);
  if (!league) throw errors.notFound('League not found');
  return league;
}

async function createLeague(attrs) {
  // Uniqueness on (sourceProvider, sourceLeagueId) is enforced by the DB
  // index. We let the constraint do the work; Sequelize will throw a
  // SequelizeUniqueConstraintError that the route handler maps to 409.
  try {
    return await League.create({
      name: attrs.name,
      sourceProvider: attrs.sourceProvider || 'football-data.org',
      sourceLeagueId: attrs.sourceLeagueId,
      country: attrs.country || null,
      logoUrl: attrs.logoUrl || null,
      active: Boolean(attrs.active),
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw errors.conflict('A league with this provider + code already exists');
    }
    throw err;
  }
}

async function updateLeague(id, patch) {
  const league = await getLeagueById(id);
  if (patch.name !== undefined) league.name = patch.name;
  if (patch.country !== undefined) league.country = patch.country;
  if (patch.logoUrl !== undefined) league.logoUrl = patch.logoUrl;
  if (patch.active !== undefined) league.active = Boolean(patch.active);
  await league.save();
  return league;
}

async function deleteLeague(id) {
  const league = await getLeagueById(id);
  // ON DELETE CASCADE on seasons; games' leagueId FK is SET NULL so their
  // rows survive but lose attribution. Picks + comments on those games are
  // not affected. The admin should re-assign or delete orphans manually.
  await league.destroy();
}

async function ensureSeason({ leagueId, year, transaction }) {
  const [season] = await Season.findOrCreate({
    where: { leagueId, year },
    defaults: { leagueId, year, current: true },
    transaction,
  });
  return season;
}

// Tier 17 — ensure a team row exists for (name, leagueId). Insert at the
// current league's min(elo) if missing, falling back to INITIAL_RATING=1500
// when the league has zero teams (first-fixture-of-a-new-league bootstrap).
// Mirrors the Python promoted_team_strategy='min_rating' behavior at the
// fixture-sync boundary so PredictionService.onResultCaptured never has to
// silently skip a missing team after a result lands. ON CONFLICT DO NOTHING
// keeps this idempotent — repeated syncs of the same fixture don't churn
// existing rows or reset accumulated Elo.
async function ensureTeamExists({ name, leagueId, transaction }) {
  await sequelize.query(
    `INSERT INTO teams (id, name, "leagueId", elo, "gamesPlayed", "createdAt", "updatedAt")
     SELECT gen_random_uuid(), :name, :leagueId,
            COALESCE((SELECT MIN(elo) FROM teams WHERE "leagueId" = :leagueId), :initialRating),
            0, NOW(), NOW()
     ON CONFLICT (name, "leagueId") DO NOTHING`,
    {
      replacements: { name, leagueId, initialRating: INITIAL_RATING },
      transaction,
    },
  );
}

async function upsertFixture({ league, fixture, transaction }) {
  const localStatus = mapUpstreamStatus(fixture.status);
  const year = Number.parseInt(fixture.season, 10) || new Date(fixture.utcDate).getUTCFullYear();
  const season = await ensureSeason({ leagueId: league.id, year, transaction });

  // Match an existing game by (leagueId, sourceId). If present, update;
  // otherwise create.
  const existing = await Game.findOne({
    where: { leagueId: league.id, sourceId: fixture.sourceId },
    transaction,
  });

  // International model — fixtures synced under the WC league row are the
  // V1 international meta-pool. Stamp the neutral-venue flag + FIFA-style
  // K-factor multiplier at intake so the cascade reads them consistently
  // for every result capture on this fixture.
  //
  // V1 simplification: every match arriving via sourceLeagueId='WC' is a
  // World Cup finals match (the only matches football-data.org currently
  // returns under that competition code), so we stamp a single 3.0 default.
  // Per-stage derivation (group vs final) is out of scope. When Euros/Copa
  // wire in later under their own sourceLeagueIds, this is the branch point
  // for their tier-specific defaults.
  const isInternationalMetaPool = league.sourceLeagueId === 'WC';
  const baseAttrs = {
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    date: new Date(fixture.utcDate),
    leagueId: league.id,
    seasonId: season.id,
    sourceId: fixture.sourceId,
    status: localStatus,
    homeScore: fixture.homeScore,
    awayScore: fixture.awayScore,
    kickoffTz: fixture.venueTimezone,
    halfTimeReached: Boolean(fixture.halfTimeReached),
    phase: fixture.phase || null,
    // Trophy Cabinet — persist the upstream tournament stage so the cabinet
    // can segment picks by round. Object.assign on the update path backfills
    // existing rows on the next sync.
    stage: fixture.stage || null,
    neutralVenue: isInternationalMetaPool,
    eloKMultiplier: isInternationalMetaPool ? 3.0 : null,
  };

  // Probabilities: leave existing values intact on update; for new rows
  // default to 0.5 / 0.5 since the free tier doesn't expose odds and
  // admins set probabilities by hand.
  const derivedResult = deriveResultFromFixture(fixture, localStatus);

  // Tier 17 — make sure both teams exist in the teams table so the runtime
  // cascade always has Elo to read. SKIP knockout-stage placeholder names
  // ("TBD" / "Winner Group A") — inserting them at min(elo) would give a
  // TBD-vs-Real fixture a real (wrong) Elo pair and defeat the null-Elo
  // skip in rePredictFutureFixtures. Existing rows are a no-op via ON
  // CONFLICT, so this is safe to call on every upsert.
  const ensureRealTeam = async (name) => {
    if (isPlaceholderTeam(name)) return;
    await ensureTeamExists({ name, leagueId: league.id, transaction });
  };

  if (existing) {
    // Capture the prior matchup BEFORE Object.assign so we can tell when a
    // knockout fixture's placeholder names resolve to real teams (or change
    // in a re-draw). syncFixtures uses this to fire a re-prediction.
    const prevHome = existing.homeTeam;
    const prevAway = existing.awayTeam;
    Object.assign(existing, baseAttrs);
    // Only fill result if it's currently null — never clobber an admin's
    // manual entry. derivedResult itself is null for in-progress or drawn
    // matches, so the guard also avoids spurious updates.
    if (existing.result === null && derivedResult !== null) {
      existing.result = derivedResult;
    }
    await existing.save({ transaction });
    // Tier 17 — team rows may have been added since the fixture was first
    // synced (e.g. a team was renamed upstream). Re-ensure on every update
    // path, not just the create path.
    await ensureRealTeam(fixture.homeTeam);
    await ensureRealTeam(fixture.awayTeam);
    const matchupChanged = prevHome !== fixture.homeTeam || prevAway !== fixture.awayTeam;
    return { game: existing, created: false, matchupChanged };
  }

  const created = await Game.create(
    {
      ...baseAttrs,
      homeProbability: 0.5,
      awayProbability: 0.5,
      // For first-time imports of past matches, set result from the
      // upstream so the UI's `game.result` check picks them up as
      // settled. New scheduled matches stay null (derivedResult is null
      // for non-finished fixtures).
      result: derivedResult,
    },
    { transaction },
  );
  await ensureRealTeam(fixture.homeTeam);
  await ensureRealTeam(fixture.awayTeam);
  // A newly-created scheduled fixture is treated as a matchup change so it
  // gets a real prediction off the bat (instead of the 0.5/0.5 default).
  return { game: created, created: true, matchupChanged: true };
}

async function syncFixtures(leagueId) {
  if (!footballApi.isConfigured()) {
    throw new errors.AppError(
      503,
      'football_api_unconfigured',
      'FOOTBALL_DATA_API_KEY is not set; cannot sync fixtures',
    );
  }
  const league = await getLeagueById(leagueId);
  const fixtures = await footballApi.getFixtures({ code: league.sourceLeagueId });

  let created = 0;
  let updated = 0;
  // Teams whose upcoming matchup changed in this sync (knockout brackets
  // resolving placeholder → real team, or a re-draw). Used to fire a
  // re-prediction AFTER the transaction commits.
  const affectedTeams = new Set();
  await sequelize.transaction(async (t) => {
    for (const fixture of fixtures) {
      try {
        const result = await upsertFixture({ league, fixture, transaction: t });
        if (result.created) created += 1;
        else updated += 1;
        if (result.matchupChanged && result.game.status === 'scheduled') {
          if (!isPlaceholderTeam(result.game.homeTeam)) affectedTeams.add(result.game.homeTeam);
          if (!isPlaceholderTeam(result.game.awayTeam)) affectedTeams.add(result.game.awayTeam);
        }
      } catch (err) {
        logger.error(
          { err, sourceId: fixture.sourceId, leagueId },
          'failed to upsert fixture during sync',
        );
        throw err;
      }
    }
  });

  // Self-heal: any scheduled fixture still sitting at the (0.50, 0.00, 0.50)
  // sentinel has real teams but was never predicted — e.g. a knockout fixture
  // that resolved in a PRIOR sync (before this hook existed, or before its
  // opponent was ensured). Roll its teams into the re-prediction set so it
  // fills on the next sync regardless of whether THIS sync changed it. A
  // genuine prediction is always nudged off the sentinel (normalize.js), so
  // this only ever catches never-predicted rows — manual admin edits are
  // left untouched.
  const sentinelGames = await Game.findAll({
    attributes: ['homeTeam', 'awayTeam'],
    where: {
      leagueId,
      status: 'scheduled',
      pickProbabilitiesLockedAt: null,
      homeProbability: 0.5,
      drawProbability: 0,
      awayProbability: 0.5,
    },
  });
  for (const g of sentinelGames) {
    if (!isPlaceholderTeam(g.homeTeam)) affectedTeams.add(g.homeTeam);
    if (!isPlaceholderTeam(g.awayTeam)) affectedTeams.add(g.awayTeam);
  }

  let rePredicted = 0;
  if (affectedTeams.size > 0) {
    // Best-effort, post-commit — a model-load failure or missing-Elo skip
    // must never fail the sync (mirrors the result-capture cascade contract).
    // Lazy-require to dodge any require-cycle at module load.
    try {
      const PredictionService = require('./PredictionService');
      const res = await PredictionService.rePredictFutureFixtures({
        affectedTeams: [...affectedTeams],
        leagueId,
      });
      rePredicted = res.rewritten || 0;
      logger.info(
        { leagueId, league: league.name, affectedTeams: affectedTeams.size, ...res },
        'syncFixtures: re-predicted resolved fixtures',
      );
    } catch (err) {
      logger.error(
        { err, leagueId, league: league.name },
        'syncFixtures: re-prediction failed (sync itself succeeded)',
      );
    }
  }

  return { leagueId, totalUpstream: fixtures.length, created, updated, rePredicted };
}

module.exports = {
  listLeagues,
  getLeagueById,
  createLeague,
  updateLeague,
  deleteLeague,
  syncFixtures,
};
