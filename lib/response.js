'use strict';

// Tier 13.1 — response helpers attached as middleware. Chunk 1 ships the
// helpers but routes keep their existing res.status().json() shapes (pure
// mechanical move). Chunk 2 adopts these uniformly.
function attachResponseHelpers(req, res, next) {
  res.ok = (data) => res.status(200).json(data);
  res.created = (data) => res.status(201).json(data);
  res.noContent = () => res.status(204).end();
  next();
}

module.exports = { attachResponseHelpers };
