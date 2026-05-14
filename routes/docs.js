'use strict';

// Tier 13 Chunk 1 — dev-only OpenAPI docs extracted from server.js. Returns
// { router, mountSwagger } so server.js can wire both the JSON endpoint and
// the Swagger UI middleware (which needs a path prefix, not a router).
//
// Gated to NODE_ENV !== 'production' — leaves the API surface unpublished in
// prod (Tier 9.3 attack-surface decision). The /api 404 sentinel still
// catches stray paths beneath it.
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { buildOpenAPIDocument } = require('../lib/openapi');

function buildDocsRouter() {
  const router = express.Router();
  router.get('/openapi.json', (req, res) => {
    res.json(buildOpenAPIDocument());
  });
  return router;
}

function mountSwagger(app, mountPath = '/api/docs') {
  app.use(mountPath, swaggerUi.serve, swaggerUi.setup(buildOpenAPIDocument()));
}

module.exports = { buildDocsRouter, mountSwagger };
