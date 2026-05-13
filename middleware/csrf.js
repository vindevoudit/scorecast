const crypto = require('crypto');

const CSRF_COOKIE = 'sc_csrf';
const CSRF_HEADER = 'x-csrf-token';
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const EXEMPT_PATHS = new Set([
  '/api/auth/refresh',
  '/api/auth/verify-email',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/client-errors',
  '/api/login',
  '/api/register',
]);

function isExempt(path) {
  if (EXEMPT_PATHS.has(path)) return true;
  return false;
}

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function ensureCsrfCookie(req, res) {
  if (req.cookies?.[CSRF_COOKIE]) return req.cookies[CSRF_COOKIE];
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  req.cookies[CSRF_COOKIE] = token;
  return token;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch (_) {
    return false;
  }
}

function csrfMiddleware(req, res, next) {
  ensureCsrfCookie(req, res);
  if (!STATE_CHANGING.has(req.method)) return next();
  if (isExempt(req.path)) return next();
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return res.status(403).json({ error: 'CSRF token missing or invalid' });
  }
  return next();
}

module.exports = csrfMiddleware;
module.exports.CSRF_COOKIE = CSRF_COOKIE;
module.exports.CSRF_HEADER = CSRF_HEADER;
module.exports.generateCsrfToken = generateCsrfToken;
