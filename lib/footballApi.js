'use strict';

// Tier 4b Chunk 1 — football-data.org v4 client. Provider-agnostic export
// surface (`getCompetitions`, `getFixtures`, `getLiveMatches`) so a swap to
// API-Football Pro or another provider is a one-file change. Callers
// (services/LeagueService.js + future cron jobs in lib/jobs/) only see the
// abstract shapes below.
//
// Rate-limit budget: defaults to 20 req/min (TIER_ONE plan, active since
// 2026-05-23). Override via FOOTBALL_DATA_RATE_LIMIT for other tiers (free
// is 10, higher tiers go to 30/50/etc.). We keep an in-process sliding-
// window counter and bail when only 1 slot remains so ad-hoc admin syncs
// don't starve the cron job. If the upstream returns 429 we surface a
// 503-style error and let the retry happen on the next cron tick.
//
// Caching: fixture lists cached 1h, live-match queries cached 30s. Reduces
// burst-sync calls by ~10x. Shared TTL-Map lives in lib/cache.js.

const logger = require('./logger');
const cache = require('./cache');
const errors = require('./errors');

const API_HOST = process.env.FOOTBALL_DATA_API_HOST || 'api.football-data.org';
const BASE_URL = `https://${API_HOST}/v4`;
const RATE_LIMIT_PER_MINUTE = Number(process.env.FOOTBALL_DATA_RATE_LIMIT) || 20;
const RATE_WINDOW_MS = 60 * 1000;
const FIXTURE_CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const LIVE_CACHE_TTL_MS = 30 * 1000; // 30s

// Sliding window of request timestamps (most recent first).
const requestLog = [];

function getApiKey() {
  return process.env.FOOTBALL_DATA_API_KEY || '';
}

function pruneRequestLog(now) {
  while (requestLog.length > 0 && now - requestLog[requestLog.length - 1] > RATE_WINDOW_MS) {
    requestLog.pop();
  }
}

function recordRequest() {
  const now = Date.now();
  pruneRequestLog(now);
  requestLog.unshift(now);
}

function requestsAvailable() {
  const now = Date.now();
  pruneRequestLog(now);
  return Math.max(0, RATE_LIMIT_PER_MINUTE - requestLog.length);
}

function isConfigured() {
  return Boolean(getApiKey());
}

async function callApi(pathAndQuery) {
  const key = getApiKey();
  if (!key) {
    throw new errors.AppError(503, 'football_api_unconfigured', 'FOOTBALL_DATA_API_KEY is not set');
  }

  // Reserve one slot from the budget so admin manual syncs can always
  // squeeze in even if the cron just ran. At the 20/min default this
  // means we cut off at 19 calls/min from background traffic.
  const available = requestsAvailable();
  if (available <= 1) {
    logger.warn(
      { available, path: pathAndQuery },
      'football-data.org rate budget near exhausted — request deferred',
    );
    throw new errors.AppError(
      429,
      'football_api_rate_limit',
      'football-data.org rate limit nearly exhausted — try again in a moment',
    );
  }

  recordRequest();
  const url = `${BASE_URL}${pathAndQuery}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { 'X-Auth-Token': key },
    });
  } catch (err) {
    logger.error({ err, url }, 'football-data.org fetch failed');
    throw new errors.AppError(
      502,
      'football_api_unreachable',
      'Upstream football-data.org unreachable',
    );
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('X-Requests-Available-Minute');
    logger.warn({ retryAfter, url }, 'football-data.org returned 429');
    throw new errors.AppError(
      429,
      'football_api_rate_limit',
      'Upstream rate-limited — try again shortly',
    );
  }
  if (response.status === 403) {
    const body = await response.text().catch(() => '');
    logger.warn({ status: 403, body, url }, 'football-data.org returned 403');
    throw new errors.AppError(
      403,
      'football_api_forbidden',
      'This competition is not available on your football-data.org plan',
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error(
      { status: response.status, body, url },
      'football-data.org returned non-OK status',
    );
    throw new errors.AppError(
      502,
      'football_api_bad_response',
      `Upstream returned status ${response.status}`,
    );
  }

  return response.json();
}

// Normalized shapes that callers consume. Keeping them provider-agnostic
// makes the swap to another football data API a one-file change.
//
// Competition: { code, name, country, emblem }
// Fixture:     { sourceId, competitionCode, season, utcDate, status,
//                homeTeam, awayTeam, homeScore, awayScore, venueTimezone }
// LiveMatch:   same shape as Fixture, with status in
//                LIVE | IN_PLAY | PAUSED.

function normalizeCompetition(raw) {
  return {
    code: raw.code,
    name: raw.name,
    country: raw.area?.name || null,
    emblem: raw.emblem || null,
  };
}

// `score.duration` upstream → local `phase` column. Mirrors the upstream
// vocabulary without leaking provider-specific strings into the DB.
const DURATION_TO_PHASE = {
  REGULAR: 'regular',
  EXTRA_TIME: 'extra-time',
  PENALTY_SHOOTOUT: 'penalty-shootout',
};

function normalizeFixture(raw) {
  // halfTimeReached: true once upstream has written a halftime score.
  // Lets the client clamp its kickoff-elapsed estimate to ≥ 46' instead
  // of underreporting through the break. Free tier doesn't expose a
  // `minute` field, so this is the next best signal.
  const halfTimeReached =
    raw.score?.halfTime?.home !== null &&
    raw.score?.halfTime?.home !== undefined &&
    raw.score?.halfTime?.away !== null &&
    raw.score?.halfTime?.away !== undefined;

  return {
    sourceId: String(raw.id),
    competitionCode: raw.competition?.code || null,
    season: raw.season?.startDate ? raw.season.startDate.slice(0, 4) : null,
    utcDate: raw.utcDate,
    status: raw.status, // raw enum from upstream; caller maps to local status
    // `winner` is the authoritative signal once the match is over —
    // HOME_TEAM / AWAY_TEAM / DRAW. Lets us tell a 1-1 draw apart from a
    // 1-1 + penalties-decided knockout (WC etc.) without inferring from
    // the fullTime score, which is the same in both cases.
    winner: raw.score?.winner || null,
    homeTeam: raw.homeTeam?.name || raw.homeTeam?.shortName || 'TBD',
    awayTeam: raw.awayTeam?.name || raw.awayTeam?.shortName || 'TBD',
    homeScore: raw.score?.fullTime?.home ?? null,
    awayScore: raw.score?.fullTime?.away ?? null,
    halfTimeReached,
    phase: raw.score?.duration ? DURATION_TO_PHASE[raw.score.duration] || null : null,
    venueTimezone: raw.venue?.timezone || null,
  };
}

async function getCompetitions() {
  return cache.getOrBuild(
    'fd:competitions',
    async () => {
      const raw = await callApi('/competitions');
      return (raw.competitions || []).map(normalizeCompetition);
    },
    FIXTURE_CACHE_TTL_MS,
  );
}

async function getFixtures({ code }) {
  if (!code) throw errors.badRequest('League code is required');
  // No dateFrom/dateTo — return the full current-season schedule. The free
  // tier returns all matches for the active season by default.
  return cache.getOrBuild(
    `fd:fixtures:${code}`,
    async () => {
      const raw = await callApi(`/competitions/${encodeURIComponent(code)}/matches`);
      return (raw.matches || []).map(normalizeFixture);
    },
    FIXTURE_CACHE_TTL_MS,
  );
}

async function getLiveMatches() {
  // Single global call returns every in-progress match across every league
  // we are entitled to. Callers filter to their active-league set.
  return cache.getOrBuild(
    'fd:live',
    async () => {
      // football-data.org v4 expects a comma-separated list, not repeated
      // status params (the latter returns 400 with an explanatory body).
      const raw = await callApi('/matches?status=LIVE,IN_PLAY,PAUSED');
      return (raw.matches || []).map(normalizeFixture);
    },
    LIVE_CACHE_TTL_MS,
  );
}

// Batch-fetch by upstream id. Used by the live-score reconcile pass to
// catch matches that just transitioned from IN_PLAY → FINISHED and so
// fell off the LIVE poll. Cached briefly so two ticks within the same
// minute don't double-spend budget on the same ids.
async function getMatchesByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  // URL length safety — football-data.org accepts comma-separated ids but
  // we don't want to construct a 4KB URL. Caller can paginate if needed.
  const capped = ids.slice(0, 50);
  const cacheKey = `fd:ids:${[...capped].sort().join(',')}`;
  return cache.getOrBuild(
    cacheKey,
    async () => {
      const raw = await callApi(`/matches?ids=${capped.join(',')}`);
      return (raw.matches || []).map(normalizeFixture);
    },
    LIVE_CACHE_TTL_MS,
  );
}

module.exports = {
  isConfigured,
  requestsAvailable,
  getCompetitions,
  getFixtures,
  getLiveMatches,
  getMatchesByIds,
};
