'use strict';

// Shared env resolution for the E2E suite. Loaded by playwright.config.js,
// global-setup.js, and seed.js. Loading dotenv here means the dev .env
// contributes credentials (e.g. local Postgres password) while the database
// name is swapped to scorecast_test so the suite never touches dev data.

require('dotenv').config();

function swapDatabaseName(rawUrl, dbName) {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    u.pathname = `/${dbName}`;
    return u.toString();
  } catch {
    return null;
  }
}

const E2E_PORT = parseInt(process.env.E2E_PORT || '3100', 10);
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ||
  swapDatabaseName(process.env.DATABASE_URL, 'scorecast_test') ||
  'postgres://postgres:postgres@127.0.0.1:5432/scorecast_test';

module.exports = { E2E_PORT, BASE_URL, DATABASE_URL };
