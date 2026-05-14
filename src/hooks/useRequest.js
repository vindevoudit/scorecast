'use strict';

// Tier 13 Chunk 3 — useRequest hook. Wraps apiFetch with the Tier 6.8 401
// refresh-retry path and the session-expired side effect. /api/auth/* is
// exempt from the retry to avoid recursion (CLAUDE.md invariant).
import { useCallback, useRef, useEffect } from 'react';
import { setLastRequestId } from '../lib/clientErrorReporter';
import { getCookie } from '../lib/cookies';
import { useAuth } from '../contexts/AuthContext';

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
        const refreshResp = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        if (refreshResp.status === 204) {
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
        const err = new Error((data && data.error) || 'Request failed');
        err.reqId = reqId;
        throw err;
      }
      return data;
    },
    [clearSession],
  );
}
