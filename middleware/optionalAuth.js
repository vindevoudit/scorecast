'use strict';

// optionalAuth — same JWT-from-cookie logic as authMiddleware, but a missing
// or invalid sc_access cookie leaves req.user = null instead of 401. Used by
// the public-readable GETs (games / leaderboard / public groups / search /
// public profiles) so anonymous visitors can browse the app before signing
// up. Routes consuming this middleware must defensively handle req.user
// being null (e.g., strip user-relative fields like friendStatus).
const jwt = require('jsonwebtoken');
const { JWT_SECRET, ACCESS_COOKIE } = require('../lib/auth');

function optionalAuth(req, _res, next) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
  }
  next();
}

module.exports = { optionalAuth };
