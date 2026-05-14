'use strict';

// Playwright globalSetup: runs once before any test (and before webServer
// boots). Applies pending migrations and seeds deterministic fixture data.
// Env vars must be set BEFORE models/index.js is required, because that
// module reads DATABASE_URL at require-time.

const { DATABASE_URL } = require('./env');

process.env.DATABASE_URL = DATABASE_URL;
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const { sequelize, runMigrations } = require('../../../models');
const { seedFixtures } = require('./seed');

module.exports = async () => {
  await sequelize.authenticate();
  // The repo's migrations expect the base schema (users, games, etc.) to
  // already exist — they only add columns / new tables on top of what
  // sequelize.sync() materialises from model definitions. So mirror what
  // models/index.js#initDatabase does on first boot: sync first, then
  // migrate.
  await sequelize.sync({ alter: false });
  await runMigrations();
  await seedFixtures();
  await sequelize.close();
};
