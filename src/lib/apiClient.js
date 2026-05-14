'use strict';

// Tier 13 Chunk 3 — bare fetch helper used by AuthContext for /api/auth/*
// endpoints (which never trigger the refresh-retry path). The full
// request() wrapper with refresh-retry + session-expired handling lives in
// src/hooks/useRequest.js.
import { setLastRequestId } from './clientErrorReporter';
import { getCookie } from './cookies';

export async function apiFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = getCookie('sc_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  const response = await fetch(path, { credentials: 'include', ...options, headers });
  const reqId = response.headers.get('X-Request-Id');
  if (reqId) setLastRequestId(reqId);

  if (response.status === 204) return null;
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const err = new Error((data && data.error) || 'Request failed');
    err.reqId = reqId;
    err.status = response.status;
    throw err;
  }
  return data;
}
