'use strict';

// Tier 13 Chunk 1 — authMiddleware + requireAdmin extracted from server.js.
// Reads the sc_access cookie (Tier 6.8: bearer-header auth is gone) and
// attaches the JWT payload to req.user.
const jwt = require('jsonwebtoken');
const { JWT_SECRET, ACCESS_COOKIE } = require('../lib/auth');

function authMiddleware(req, res, next) {
  const token = req.cookies?.[ACCESS_COOKIE];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Pin HS256 — jsonwebtoken@9 already rejects `alg: none` by default, but
    // pinning the algorithm protects against future regressions and any
    // hypothetical confusion if JWT_SECRET resembled a public key.
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    req.user = payload;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authMiddleware, requireAdmin };
