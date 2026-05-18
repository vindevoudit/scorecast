'use strict';

// Boundary assertion helpers for the per-endpoint API test suite under
// tests/e2e/api/. Each helper performs ONE HTTP call and throws if the
// response status (or body shape) doesn't match. Helpers do not clean up
// state — callers seed/reset their own DB fixtures.
//
// Method dispatch: APIRequestContext exposes lowercased methods
// (ctx.get / post / put / patch / delete / head). We map the conventional
// uppercase strings.

const { apiAnon, stripCsrf } = require('./api');

async function callRaw(ctx, method, path, body) {
  const fn = ctx[method.toLowerCase()];
  if (typeof fn !== 'function') {
    throw new Error(`callRaw: unsupported HTTP method '${method}'`);
  }
  const opts = body !== undefined ? { data: body } : undefined;
  return fn.call(ctx, path, opts);
}

async function failWithBody(res, prefix) {
  const text = await res.text().catch(() => '<unreadable>');
  throw new Error(`${prefix}: got ${res.status()} — body: ${text.slice(0, 300)}`);
}

async function assertStatus(res, expected, hint) {
  if (res.status() !== expected) {
    await failWithBody(res, `${hint} (expected ${expected})`);
  }
}

// 401 when no auth cookie is presented. Middleware order is csrf → auth, so
// state-changing routes would 403 on CSRF before they ever reach the auth
// gate. We seed an sc_csrf cookie (and matching header for non-GET methods)
// via a throwaway GET so the CSRF middleware passes and we land on the auth
// check itself.
async function assertUnauthorized(method, path, body) {
  const anon = await apiAnon();
  try {
    const upper = method.toUpperCase();
    const opts = body !== undefined ? { data: body } : {};
    if (upper !== 'GET' && upper !== 'HEAD') {
      await anon.get('/healthz');
      const state = await anon.storageState();
      const csrf = state.cookies.find((c) => c.name === 'sc_csrf')?.value;
      if (csrf) opts.headers = { ...(opts.headers || {}), 'X-CSRF-Token': csrf };
    }
    const fn = anon[method.toLowerCase()];
    const res = await fn.call(anon, path, opts);
    await assertStatus(res, 401, `${method} ${path} should require auth`);
  } finally {
    await anon.dispose();
  }
}

// 403 when an authed non-admin tries to call a requireAdmin route.
async function assertForbiddenWithoutAdmin(userCtx, method, path, body) {
  const res = await callRaw(userCtx, method, path, body);
  await assertStatus(res, 403, `${method} ${path} should require admin`);
}

// 403 when an authed user submits a state-changing request without the
// X-CSRF-Token header. Applies to non-exempt POST/PUT/PATCH/DELETE routes.
async function assertCsrfRejected(authedCtx, method, path, body) {
  const bare = await stripCsrf(authedCtx);
  try {
    const res = await callRaw(bare, method, path, body);
    await assertStatus(res, 403, `${method} ${path} should require CSRF`);
  } finally {
    await bare.dispose();
  }
}

// 400 with an `error` field when the body fails zod validation. The middleware
// envelope is `{ error: <first issue summary>, issues: [...] }` so we just
// check for the `error` key.
async function assertValidationError(authedCtx, method, path, badBody) {
  const res = await callRaw(authedCtx, method, path, badBody);
  await assertStatus(res, 400, `${method} ${path} should reject bad body`);
  const payload = await res.json().catch(() => null);
  if (!payload || typeof payload.error !== 'string') {
    throw new Error(`${method} ${path} validation: response missing 'error' field`);
  }
}

async function assertNotFound(authedCtx, method, path, body) {
  const res = await callRaw(authedCtx, method, path, body);
  await assertStatus(res, 404, `${method} ${path} should 404`);
}

// 2xx happy-path. Returns the parsed JSON (or null for 204) so callers can
// shape-check the response.
async function assertOk(ctx, method, path, body) {
  const res = await callRaw(ctx, method, path, body);
  if (res.status() < 200 || res.status() >= 300) {
    await failWithBody(res, `${method} ${path} expected 2xx`);
  }
  if (res.status() === 204) return null;
  return res.json().catch(() => null);
}

async function assertNoContent(ctx, method, path, body) {
  const res = await callRaw(ctx, method, path, body);
  await assertStatus(res, 204, `${method} ${path} expected 204`);
}

// Shallow shape check — every key in `requiredKeys` must be present in the
// payload (presence only; null is fine, undefined is not).
function expectShape(payload, requiredKeys) {
  if (payload === null || typeof payload !== 'object') {
    throw new Error(`expectShape: payload is ${payload === null ? 'null' : typeof payload}`);
  }
  for (const k of requiredKeys) {
    if (!(k in payload)) {
      throw new Error(`expectShape: missing key '${k}' (got: ${Object.keys(payload).join(', ')})`);
    }
  }
}

module.exports = {
  assertUnauthorized,
  assertForbiddenWithoutAdmin,
  assertCsrfRejected,
  assertValidationError,
  assertNotFound,
  assertOk,
  assertNoContent,
  expectShape,
};
