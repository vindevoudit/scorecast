'use strict';

// Tier 13 Chunk 1 — minimal liveness probe extracted from server.js. Mounted
// at the root (not /api) so container orchestrators can reach it without
// going through the API namespace.
//
// Tier 20 Chunk 7 — /readyz alongside /healthz. Two probes intentionally
// distinct:
//   /healthz  → liveness. Returns 200 instantly if the process is up. No
//               DB ping. Used by Azure Container Apps' Liveness probe + the
//               Docker HEALTHCHECK. A transient DB outage must NOT cause
//               the container to be killed and restarted.
//   /readyz   → readiness. Pings the DB. Returns 503 on failure so ACA's
//               Readiness probe pulls the replica out of rotation until
//               the DB is reachable again. The container stays alive.
const express = require('express');
const { sequelize } = require('../models');

const router = express.Router();

// Tier 22 M1 — dropped `uptime` from the response. process.uptime() tells
// an attacker when the container last restarted (useful for inferring
// deploy schedule, scaling behavior, whether a previous probe crashed the
// process). Azure Container Apps metrics already carry this info for
// legitimate operators.
router.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

router.get('/readyz', async (req, res) => {
  try {
    await sequelize.query('SELECT 1');
    res.json({ status: 'ready', db: 'ok' });
  } catch (err) {
    req.log?.warn({ err }, '/readyz: DB ping failed');
    res.status(503).json({ status: 'not_ready', db: 'down' });
  }
});

module.exports = router;
