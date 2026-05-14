'use strict';

// Tier 13 Chunk 1 — client-error reporting endpoint extracted from server.js.
// Pre-auth + CSRF-exempt (see middleware/csrf.js EXEMPT_PATHS). Attempts to
// resolve the caller's userId from the access cookie but tolerates missing
// or invalid tokens — anonymous reports still get logged.
const express = require('express');
const jwt = require('jsonwebtoken');
const { validate } = require('../validation/middleware');
const { clientErrorSchema } = require('../validation/schemas');
const { clientErrorLimiter } = require('../middleware/rateLimit');
const { JWT_SECRET, ACCESS_COOKIE } = require('../lib/auth');

const router = express.Router();

router.post('/client-errors', clientErrorLimiter, validate(clientErrorSchema), (req, res) => {
  let userId = null;
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET);
      userId = payload?.id || null;
    }
  } catch (_) {
    // anonymous report — token missing or invalid; that's fine
  }

  const { level = 'error', message, stack, componentStack, url, reqId, userAgent } = req.body;
  const logFn = level === 'warn' ? req.log.warn.bind(req.log) : req.log.error.bind(req.log);
  logFn(
    { clientError: { message, stack, componentStack, url, reqId, userAgent }, userId },
    'client error',
  );
  res.status(204).end();
});

module.exports = router;
