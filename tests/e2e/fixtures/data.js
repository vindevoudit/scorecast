'use strict';

// Deterministic fixture data for the E2E suite. UUIDs are stable so tests can
// reference rows directly without lookups. Passwords are stored plain here and
// hashed in seed.js before insertion.

// Tier 4b Chunk 3 tightened games.leagueId to NOT NULL. The seed inserts a
// dedicated "E2E Test League" with these stable IDs and points every fixture
// game at it; truncating wipes the migration-seeded Legacy league between
// runs, so the seed reinstates one of its own.
const LEAGUE_ID = '22222222-0000-4000-8000-000000000001';
const SEASON_ID = '33333333-0000-4000-8000-000000000001';

const USERS = {
  admin: {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'e2e_admin',
    email: 'e2e-admin@example.test',
    password: 'AdminPassword123!',
    role: 'admin',
  },
  alice: {
    id: '00000000-0000-4000-8000-000000000002',
    username: 'e2e_alice',
    email: 'e2e-alice@example.test',
    password: 'AlicePassword123!',
    role: 'user',
  },
  bob: {
    id: '00000000-0000-4000-8000-000000000003',
    username: 'e2e_bob',
    email: 'e2e-bob@example.test',
    password: 'BobPassword123!',
    role: 'user',
  },
};

function daysFromNow(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(18, 0, 0, 0);
  return d.toISOString();
}

const GAMES = {
  lions: {
    id: '11111111-0000-4000-8000-000000000001',
    homeTeam: 'Test Lions',
    awayTeam: 'Test Tigers',
    date: daysFromNow(1),
    homeProbability: 0.5,
    awayProbability: 0.5,
    result: null,
    leagueId: LEAGUE_ID,
    seasonId: SEASON_ID,
  },
  eagles: {
    id: '11111111-0000-4000-8000-000000000002',
    homeTeam: 'Test Eagles',
    awayTeam: 'Test Sharks',
    date: daysFromNow(2),
    homeProbability: 0.6,
    awayProbability: 0.4,
    result: null,
    leagueId: LEAGUE_ID,
    seasonId: SEASON_ID,
  },
  wolves: {
    id: '11111111-0000-4000-8000-000000000003',
    homeTeam: 'Test Wolves',
    awayTeam: 'Test Hawks',
    date: daysFromNow(3),
    homeProbability: 0.4,
    awayProbability: 0.6,
    result: null,
    leagueId: LEAGUE_ID,
    seasonId: SEASON_ID,
  },
};

module.exports = {
  USERS,
  GAMES,
  LEAGUE_ID,
  SEASON_ID,
  FIXTURE_USERS: Object.values(USERS),
  FIXTURE_GAMES: Object.values(GAMES),
};
