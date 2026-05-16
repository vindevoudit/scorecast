'use strict';

// Tier 4b Chunk 1 — generic TTL-Map cache, mirrored from
// lib/leaderboardCache.js. Used by lib/footballApi.js to cache fixture-list
// + live-score responses so burst syncs and re-clicks don't hammer the
// upstream 10-req/min budget.
//
// Like the leaderboard cache, this is single-process in-memory. Tier 10.4
// will swap both behind Redis for multi-replica deployments. Until then,
// each replica keeps its own copy and the worst case is duplicate upstream
// calls — never wrong data.

const DEFAULT_TTL_MS = 60 * 1000;

const store = new Map();
let hits = 0;
let misses = 0;

function isFresh(entry) {
  return entry && entry.expiresAt > Date.now();
}

async function getOrBuild(key, builder, ttlMs = DEFAULT_TTL_MS) {
  const cached = store.get(key);
  if (isFresh(cached)) {
    hits += 1;
    return cached.value;
  }
  misses += 1;
  const value = await builder();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function get(key) {
  const cached = store.get(key);
  return isFresh(cached) ? cached.value : undefined;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function invalidate(key) {
  if (key === 'all' || key === undefined) {
    store.clear();
    return;
  }
  store.delete(key);
}

function stats() {
  const now = Date.now();
  return {
    size: store.size,
    hits,
    misses,
    keys: [...store.entries()].map(([key, entry]) => ({
      key,
      ttlRemainingMs: Math.max(0, entry.expiresAt - now),
    })),
  };
}

module.exports = { getOrBuild, get, set, invalidate, stats };
