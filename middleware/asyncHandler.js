'use strict';

// Tier 13.1 — Express 4 doesn't auto-catch async errors. Wrap a route handler
// with asyncHandler(fn) so thrown errors / rejected promises flow to the
// global error middleware (lib/errorMiddleware.js).
//
// Chunk 1 ships this helper but doesn't apply it everywhere; Chunk 2 will.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
