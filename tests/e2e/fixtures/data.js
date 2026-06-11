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

// Anchor fixture games at LOCAL noon of (today + `days`) LOCAL days. Two
// reasons this shape matters — both surfaced as an intermittent calendar flake
// (comment-reaction / picks-snapshot couldn't find a game's card):
//   1. The GamesCalendar buckets games by LOCAL day (dayKey via
//      toLocaleDateString), and so does the selectGameDate test helper. Noon
//      is far from any midnight boundary, so a game's local day is exactly
//      today+`days` regardless of the runner's timezone offset. The old
//      18:00-UTC anchor drifted across the local-midnight boundary in
//      behind-UTC zones.
//   2. globalSetup (the seeder) and the test worker are SEPARATE processes
//      that each evaluate this at module-load time. The old UTC-date
//      arithmetic (setUTCDate + getUTCDate) put them on different calendar
//      days whenever the two loads straddled UTC midnight (20:00 in a UTC-4
//      zone — a normal evening test time), so the seeded row and the fixture
//      constant disagreed by a day and selectGameDate navigated to an empty
//      chip. Local-day arithmetic only drifts if the two loads straddle LOCAL
//      midnight (a few-minute window), which is acceptably rare.
function daysFromNow(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
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
