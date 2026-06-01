'use strict';

// Tier 13 Chunk 3 — useRequest hook. Wraps apiFetch with the Tier 6.8 401
// refresh-retry path and the session-expired side effect. /api/auth/* is
// exempt from the retry to avoid recursion (CLAUDE.md invariant).
import { useCallback, useRef, useEffect } from 'react';
import { setLastRequestId } from '../lib/clientErrorReporter';
import { getCookie } from '../lib/cookies';
import { useAuth } from '../contexts/AuthContext';

// Tier 18 Chunk 6 — wrap server error codes that surface as cryptic
// machine-readable strings into one-sentence user-facing copy. Returns
// the original message if it doesn't match a known code (so plain
// human-readable errors pass through unchanged).
const FRIENDLY_ERROR_CODES = {
  football_api_rate_limit: 'Live scores are catching up — try again in a moment.',
  rate_limited: 'Too many requests — slow down for a moment and try again.',
};
function friendlyMessage(raw) {
  if (typeof raw !== 'string') return raw;
  return FRIENDLY_ERROR_CODES[raw] || raw;
}

// Single-flight refresh coordinator. Refresh tokens rotate (routes/auth.js
// /auth/refresh revokes the inbound row under a SELECT ... FOR UPDATE lock),
// so when the 15-min access JWT expires and several requests 401 in parallel
// (view switches, Promise.all fan-outs), only ONE may rotate successfully —
// the rest send the same now-revoked cookie and 401. Without coalescing, each
// of those siblings would treat its failed refresh as session-expired and call
// clearSession() → spurious logout. Sharing a single in-flight refresh promise
// means every concurrent 401 awaits the same call and then retries with the
// freshly-rotated cookie. A genuinely-expired token resolves `false` for all
// waiters → clearSession() fires once, correctly. Module-level so it's shared
// across every useRequest() consumer, not per-hook-instance.
let inflightRefresh = null;
function refreshSession() {
  if (!inflightRefresh) {
    inflightRefresh = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then((r) => r.status === 204)
      .catch(() => false)
      .finally(() => {
        inflightRefresh = null;
      });
  }
  return inflightRefresh;
}

export function useRequest() {
  const { user, clearSession } = useAuth();
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  return useCallback(
    async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      if (method !== 'GET' && method !== 'HEAD') {
        const csrf = getCookie('sc_csrf');
        if (csrf) headers['X-CSRF-Token'] = csrf;
      }

      const doFetch = () =>
        fetch(path, {
          credentials: 'include',
          ...options,
          headers,
        });

      let response = await doFetch();
      let reqId = response.headers.get('X-Request-Id');
      if (reqId) setLastRequestId(reqId);

      if (response.status === 401 && !path.startsWith('/api/auth/')) {
        const refreshed = await refreshSession();
        if (refreshed) {
          response = await doFetch();
          const newReqId = response.headers.get('X-Request-Id');
          if (newReqId) {
            setLastRequestId(newReqId);
            reqId = newReqId;
          }
        }
      }

      if (response.status === 401) {
        if (userRef.current) {
          clearSession();
          const err = new Error('Session expired');
          err.reqId = reqId;
          throw err;
        }
        const err = new Error('Authentication required');
        err.reqId = reqId;
        err.status = 401;
        throw err;
      }

      if (response.status === 204) return null;
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        // Two error envelopes coexist server-side:
        //   - validation/middleware.js: { error: '<string>', issues: [...] }
        //   - lib/errorMiddleware.js (AppError):  { error: { code, message } }
        // Without this normalization, AppError responses become `new
        // Error({…})` which stringifies to '[object Object]' in the toast.
        const errField = data && data.error;
        const msg =
          typeof errField === 'string'
            ? errField
            : (errField && errField.message) || 'Request failed';
        const err = new Error(friendlyMessage(msg));
        err.reqId = reqId;
        err.status = response.status;
        // Tier 18 Chunk 6 — flag so clientErrorReporter skips the generic
        // "Something went wrong" toast for 4xx responses. The thrower
        // already has a user-facing message (`msg`); the caller will
        // showStatus() it themselves.
        err.wasHandled = true;
        throw err;
      }
      return data;
    },
    [clearSession],
  );
}
