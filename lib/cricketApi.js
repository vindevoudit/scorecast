'use strict';

// CPL auto-results — CricketData.org (CricAPI) v1 client.
//
// Structurally a sibling of lib/footballApi.js: same sliding-window rate
// budget, same 10s AbortController timeout, same AppError vocabulary, same
// TTL cache. Callers see only the normalized shape at the bottom, so swapping
// cricket providers stays a one-file change.
//
// THREE DELIBERATE DIVERGENCES FROM footballApi. Each is a real defect if you
// copy that file verbatim:
//
// 1. THE API KEY IS IN THE QUERY STRING, NOT A HEADER.
//    footballApi logs `{ err, url }` on every failure path, which is fine when
//    auth is an X-Auth-Token header. Here it would write CRICAPI_API_KEY into
//    pino output, into Log Analytics and into Sentry. Every log site below uses
//    `safeUrl` (key redacted). Never log a raw URL from this file.
//
// 2. CRICAPI REPORTS FAILURE WITH HTTP 200.
//    Quota exhaustion, a bad key and an unknown id all come back as
//    `200 {status:'failure', reason:'...'}`. A `response.ok` check alone would
//    read quota exhaustion as a valid-but-empty payload, and the result job
//    would look perfectly healthy while silently capturing nothing for the rest
//    of the day. So the envelope is inspected after parsing and mapped onto the
//    same AppError codes an HTTP-level failure would have produced.
//
// 3. THE PROVIDER TELLS US OUR OWN BUDGET.
//    Every response carries `info: {hitsToday, hitsLimit}`. That survives
//    process restarts and multi-replica in a way the in-process window cannot,
//    so it is the primary budget signal; the sliding window stays as a burst
//    guard and CRICAPI_DAILY_BUDGET as a belt-and-braces local cap.

const logger = require('./logger');
const cache = require('./cache');
const errors = require('./errors');

const API_HOST = process.env.CRICAPI_API_HOST || 'api.cricapi.com';
const BASE_URL = `https://${API_HOST}/v1`;
const RATE_LIMIT_PER_MINUTE = Number(process.env.CRICAPI_RATE_LIMIT) || 10;
const RATE_WINDOW_MS = 60 * 1000;
const DAILY_BUDGET = Number(process.env.CRICAPI_DAILY_BUDGET) || 80;
// Leave a few hits in the tank so an operator running the report script can
// always get an answer even if the cron has been busy.
const HITS_RESERVE = 5;
const SERIES_CACHE_TTL_MS = 5 * 60 * 1000;
const MATCH_CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

// Sliding window of request timestamps (most recent first).
const requestLog = [];

// Last `info` block the provider sent us, plus a local per-UTC-day counter.
let lastInfo = { hitsToday: null, hitsLimit: null };
let localDayKey = null;
let localHitsToday = 0;

function getApiKey() {
  return process.env.CRICAPI_API_KEY || '';
}

function isConfigured() {
  return Boolean(getApiKey());
}

function pruneRequestLog(now) {
  while (requestLog.length > 0 && now - requestLog[requestLog.length - 1] > RATE_WINDOW_MS) {
    requestLog.pop();
  }
}

function requestsAvailable() {
  const now = Date.now();
  pruneRequestLog(now);
  return Math.max(0, RATE_LIMIT_PER_MINUTE - requestLog.length);
}

function recordRequest() {
  const now = Date.now();
  pruneRequestLog(now);
  requestLog.unshift(now);

  const dayKey = new Date(now).toISOString().slice(0, 10);
  if (dayKey !== localDayKey) {
    localDayKey = dayKey;
    localHitsToday = 0;
  }
  localHitsToday += 1;
}

function budgetStatus() {
  return {
    hitsToday: lastInfo.hitsToday,
    hitsLimit: lastInfo.hitsLimit,
    localHitsToday,
    localBudget: DAILY_BUDGET,
    perMinuteAvailable: requestsAvailable(),
  };
}

// Provider-reported budget is authoritative when we have it; the local counter
// is the fallback for the very first call of a process.
function dailyBudgetExhausted() {
  const { hitsToday, hitsLimit } = lastInfo;
  if (Number.isFinite(hitsToday) && Number.isFinite(hitsLimit)) {
    return hitsToday >= hitsLimit - HITS_RESERVE;
  }
  const dayKey = new Date().toISOString().slice(0, 10);
  if (dayKey !== localDayKey) return false;
  return localHitsToday >= DAILY_BUDGET;
}

// Builds both the real URL (with the key) and a redacted twin for logging.
// Nothing outside this function ever sees the key-bearing string.
function buildUrl(endpoint, params) {
  const search = new URLSearchParams({ apikey: getApiKey(), ...params });
  const redacted = new URLSearchParams({ apikey: 'REDACTED', ...params });
  return {
    url: `${BASE_URL}/${endpoint}?${search.toString()}`,
    safeUrl: `${BASE_URL}/${endpoint}?${redacted.toString()}`,
  };
}

// CricAPI's failure envelope carries a human `reason`. Map it onto the codes a
// transport-level failure would have produced so callers need no new branch —
// in particular the jobs' existing `statusCode === 429 -> skip, don't error`
// handling then covers quota exhaustion for free.
function throwForFailureEnvelope(json, safeUrl) {
  const reason = String(json?.reason || json?.message || 'unknown');
  if (/limit|quota|exceed|hits/i.test(reason)) {
    logger.warn({ reason, safeUrl }, 'cricapi: daily hit budget exhausted');
    throw new errors.AppError(429, 'cricket_api_rate_limit', 'CricAPI hit limit reached');
  }
  if (/invalid.*key|unauthor|forbidden|not.*subscrib/i.test(reason)) {
    logger.error({ reason, safeUrl }, 'cricapi: key rejected');
    throw new errors.AppError(503, 'cricket_api_unconfigured', 'CricAPI rejected the API key');
  }
  logger.error({ reason, safeUrl }, 'cricapi: request failed');
  throw new errors.AppError(502, 'cricket_api_bad_response', `CricAPI returned: ${reason}`);
}

async function callApi(endpoint, params = {}) {
  if (!isConfigured()) {
    throw new errors.AppError(503, 'cricket_api_unconfigured', 'CRICAPI_API_KEY is not set');
  }
  if (dailyBudgetExhausted()) {
    throw new errors.AppError(
      429,
      'cricket_api_rate_limit',
      'CricAPI daily budget exhausted — deferring until tomorrow',
    );
  }
  if (requestsAvailable() <= 1) {
    throw new errors.AppError(
      429,
      'cricket_api_rate_limit',
      'CricAPI per-minute budget nearly exhausted — try again in a moment',
    );
  }

  const { url, safeUrl } = buildUrl(endpoint, params);
  recordRequest();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { method: 'GET', signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      logger.warn({ safeUrl }, 'cricapi fetch timed out (10s)');
    } else {
      logger.error({ err, safeUrl }, 'cricapi fetch failed');
    }
    throw new errors.AppError(502, 'cricket_api_unreachable', 'Upstream CricAPI unreachable');
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 429) {
    logger.warn({ safeUrl }, 'cricapi returned 429');
    throw new errors.AppError(429, 'cricket_api_rate_limit', 'Upstream rate-limited');
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error({ status: response.status, body, safeUrl }, 'cricapi returned non-OK status');
    throw new errors.AppError(
      502,
      'cricket_api_bad_response',
      `Upstream returned status ${response.status}`,
    );
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    logger.error({ err, safeUrl }, 'cricapi returned malformed JSON');
    throw new errors.AppError(502, 'cricket_api_bad_response', 'Upstream returned malformed JSON');
  }

  // Record the budget BEFORE the failure check — a quota-exhausted response
  // still carries the counter, and that is exactly when we most want it.
  if (json?.info) {
    lastInfo = {
      hitsToday: Number(json.info.hitsToday ?? json.info.hitsUsed ?? NaN),
      hitsLimit: Number(json.info.hitsLimit ?? NaN),
    };
  }

  // Divergence 2 — HTTP 200 does not mean success here.
  if (json?.status !== 'success') throwForFailureEnvelope(json, safeUrl);

  return json;
}

// ---------------------------------------------------------------------------
// Normalization. The ONLY place provider field names appear.
//
// ProviderMatch: {
//   providerMatchId, name, matchType, statusText, venue, dateTimeGMT,
//   teams: [String, String], matchStarted, matchEnded, seriesId,
//   innings: [{ teamName, inningNumber, runs, wickets, oversText }],
// }
//
// `oversText` stays a STRING all the way to lib/sports.js oversToBalls. Overs
// are base-6 ("18.4" is 18 overs and 4 balls), so any float arithmetic on them
// is wrong; the only safe operation is the validated text -> balls conversion.
// ---------------------------------------------------------------------------

// "Barbados Tridents Inning 1" -> { teamName, inningNumber }.
function parseInningLabel(label) {
  const text = String(label || '').trim();
  const match = /^(.*?)\s+inning\s*(\d+)\s*$/i.exec(text);
  if (!match) return { teamName: text || null, inningNumber: 1 };
  return { teamName: match[1].trim(), inningNumber: Number(match[2]) };
}

function normalizeInnings(rawScore) {
  if (!Array.isArray(rawScore)) return [];
  return rawScore
    .map((entry) => {
      const { teamName, inningNumber } = parseInningLabel(entry?.inning);
      if (!teamName) return null;
      const runs = Number(entry?.r);
      const wickets = Number(entry?.w);
      if (!Number.isFinite(runs) || !Number.isFinite(wickets)) return null;
      return {
        teamName,
        inningNumber,
        runs,
        wickets,
        // Deliberately text. `0` and `0.0` and `20` all arrive as numbers from
        // JSON; String() normalises them for oversToBalls' regex.
        oversText: entry?.o == null ? null : String(entry.o).trim(),
      };
    })
    .filter(Boolean);
}

function normalizeProviderMatch(raw) {
  const teams = Array.isArray(raw?.teams) ? raw.teams.map((t) => String(t)) : [];
  return {
    providerMatchId: raw?.id ? String(raw.id) : null,
    name: raw?.name || null,
    matchType: raw?.matchType ? String(raw.matchType).toLowerCase() : null,
    statusText: raw?.status ? String(raw.status) : '',
    venue: raw?.venue || null,
    dateTimeGMT: raw?.dateTimeGMT || raw?.date || null,
    teams,
    matchStarted: Boolean(raw?.matchStarted),
    matchEnded: Boolean(raw?.matchEnded),
    seriesId: raw?.series_id ? String(raw.series_id) : null,
    innings: normalizeInnings(raw?.score),
  };
}

// One hit returns the whole competition. This is the endpoint the result job
// lives on — per-match `match_info` would be 39x the budget for the same data.
async function getSeriesMatches(seriesId) {
  if (!seriesId) throw errors.badRequest('seriesId is required');
  return cache.getOrBuild(
    `cric:series:${seriesId}`,
    async () => {
      const json = await callApi('series_info', { id: seriesId });
      const list = json?.data?.matchList || [];
      return list.map(normalizeProviderMatch);
    },
    SERIES_CACHE_TTL_MS,
  );
}

// Fallback for a finished match whose series_info entry arrived without a
// usable `score[]`. Costs one extra hit, so callers must gate on that.
async function getMatchInfo(matchId) {
  if (!matchId) throw errors.badRequest('matchId is required');
  return cache.getOrBuild(
    `cric:match:${matchId}`,
    async () => {
      const json = await callApi('match_info', { id: matchId });
      return json?.data ? normalizeProviderMatch(json.data) : null;
    },
    MATCH_CACHE_TTL_MS,
  );
}

// Operator-script only — used once to discover CRICAPI_SERIES_ID. No job calls
// this, so it never competes with the result budget on a match day.
async function findSeries(query) {
  const json = await callApi('series', { search: query || '', offset: 0 });
  return (json?.data || []).map((s) => ({
    id: String(s.id),
    name: s.name || null,
    startDate: s.startDate || null,
    endDate: s.endDate || null,
    matches: s.matches ?? null,
  }));
}

module.exports = {
  isConfigured,
  requestsAvailable,
  budgetStatus,
  getSeriesMatches,
  getMatchInfo,
  findSeries,
  // Exported for unit tests — pure, no I/O.
  normalizeProviderMatch,
  parseInningLabel,
};
