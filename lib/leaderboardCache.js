const DEFAULT_TTL_MS = 30 * 1000;

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

function invalidate(key) {
  if (key === 'all' || key === undefined) {
    store.clear();
    return;
  }
  store.delete(key);
}

// Clear every cached entry whose key matches `prefix` exactly or starts
// with `${prefix}:`. Required once filter axes (e.g. league/season) are
// encoded into the cache key — one logical scope (e.g. a group) now has
// multiple variant keys (`group:abc:l:*:s:*`, `group:abc:l:<id>:s:*`, etc),
// so a single mutation can no longer cite one key to invalidate. The
// `=== prefix || startsWith(prefix + ':')` guard prevents accidental
// over-matching like `group:abc` clearing `group:abcd`.
function invalidatePrefix(prefix) {
  for (const key of store.keys()) {
    if (key === prefix || key.startsWith(`${prefix}:`)) {
      store.delete(key);
    }
  }
}

function stats() {
  const now = Date.now();
  return {
    size: store.size,
    hits,
    misses,
    keys: [...store.entries()].map(([key, entry]) => ({
      key,
      ageMs: now - (entry.expiresAt - DEFAULT_TTL_MS),
      ttlRemainingMs: Math.max(0, entry.expiresAt - now),
    })),
  };
}

module.exports = { getOrBuild, invalidate, invalidatePrefix, stats };
