'use strict';

// Tier 13 Chunk 1 — minimal liveness probe extracted from server.js. Mounted
// at the root (not /api) so container orchestrators can reach it without
// going through the API namespace. Tier 10.1 will add /readyz alongside.
const express = require('express');

const router = express.Router();

router.get('/healthz', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

module.exports = router;
