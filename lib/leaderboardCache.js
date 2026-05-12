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

module.exports = { getOrBuild, invalidate, stats };
