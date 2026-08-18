'use strict';

const { test, expect } = require('@playwright/test');
const { USERS } = require('../fixtures/data');
const { apiLogin, apiAnon, getUserId, clearPicksAndBadges } = require('../helpers/api');

// Tier 34 — T20 cricket market.
//
// This spec seeds and tears down its OWN league, season and games rather than
// extending tests/e2e/fixtures/{seed,data}.js. That is deliberate: adding
// cricket rows to the shared fixture set would shift every other spec's game
// list and day chips, and leaderboard-scoring.spec.js computes expected points
// from probabilities against a known fixture set. Self-contained means the
// football suite has no diff at all.

const LEAGUE_ID = '44444444-0000-4000-8000-000000000001';
const SEASON_ID = '55555555-0000-4000-8000-000000000001';
const GAME_ID = '66666666-0000-4000-8000-000000000001';
const GAME_ID_2 = '66666666-0000-4000-8000-000000000002';

function models() {
  // Required lazily for the same reason the other API specs do it — the
  // Sequelize pool is shared across specs under workers:1.
  return require('../../../models');
}

async function seedCricket() {
  const { League, Season, Game } = models();
  const now = new Date();
  await League.upsert({
    id: LEAGUE_ID,
    name: 'E2E Cricket League',
    sport: 'cricket',
    sourceProvider: 'manual',
    sourceLeagueId: 'E2ECPL',
    country: 'Caribbean',
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  await Season.upsert({
    id: SEASON_ID,
    leagueId: LEAGUE_ID,
    year: now.getUTCFullYear(),
    current: true,
    createdAt: now,
    updatedAt: now,
  });
  const base = {
    leagueId: LEAGUE_ID,
    seasonId: SEASON_ID,
    sport: 'cricket',
    status: 'scheduled',
    result: null,
    homeProbability: 0.5,
    drawProbability: 0,
    awayProbability: 0.5,
    homeScore: null,
    awayScore: null,
    homeBallsFaced: null,
    awayBallsFaced: null,
    homeWickets: null,
    awayWickets: null,
    homeAllOut: false,
    awayAllOut: false,
    appliedResult: null,
  };
  // Far future so these never collide with the football fixtures' day chips.
  const far = (days) => new Date(Date.now() + days * 86400000);
  await Game.upsert({
    ...base,
    id: GAME_ID,
    homeTeam: 'E2E Kings',
    awayTeam: 'E2E Warriors',
    date: far(30),
  });
  await Game.upsert({
    ...base,
    id: GAME_ID_2,
    homeTeam: 'E2E Patriots',
    awayTeam: 'E2E Riders',
    date: far(31),
  });
}

async function teardownCricket() {
  const { League, Season, Game, Pick, UserScore } = models();
  await Pick.destroy({ where: { gameId: [GAME_ID, GAME_ID_2] } });
  await UserScore.destroy({ where: { leagueId: LEAGUE_ID } });
  await Game.destroy({ where: { id: [GAME_ID, GAME_ID_2] } });
  await Season.destroy({ where: { id: SEASON_ID } });
  await League.destroy({ where: { id: LEAGUE_ID } });
}

async function resetGame(gameId) {
  const { Game, Pick } = models();
  await Pick.destroy({ where: { gameId } });
  await Game.update(
    {
      result: null,
      status: 'scheduled',
      homeScore: null,
      awayScore: null,
      homeBallsFaced: null,
      awayBallsFaced: null,
      homeWickets: null,
      awayWickets: null,
      homeAllOut: false,
      awayAllOut: false,
      appliedResult: null,
      // CPL auto-results — without clearing these, the claim in
      // CricketProviderService.applyProviderResult would refuse every test
      // after the first with 'already-captured'.
      resultSource: null,
      providerMatchId: null,
      providerMatchResolvedAt: null,
    },
    { where: { id: gameId } },
  );
}

const innings = (runs, wickets, overs, allOut = false) => ({ runs, wickets, overs, allOut });

test.describe('cricket market', () => {
  let admin;
  let alice;
  let aliceId;

  test.beforeAll(async () => {
    await seedCricket();
    admin = await apiLogin(USERS.admin);
    alice = await apiLogin(USERS.alice);
    aliceId = await getUserId(USERS.alice.username);
  });

  test.afterAll(async () => {
    await clearPicksAndBadges([aliceId]);
    await teardownCricket();
    await admin?.dispose();
    await alice?.dispose();
  });

  test.beforeEach(async () => {
    await resetGame(GAME_ID);
    await clearPicksAndBadges([aliceId]);
  });

  test('games carry sport and the innings columns', async () => {
    const res = await apiAnon().then((ctx) => ctx.get('/api/games?sport=cricket'));
    expect(res.ok()).toBeTruthy();
    const games = await res.json();
    const game = games.find((g) => g.id === GAME_ID);
    expect(game).toBeTruthy();
    expect(game.sport).toBe('cricket');
    // Required by lib/scoring.js — without them scorePick silently takes the
    // football branch and both runs legs vanish.
    expect(game).toHaveProperty('homeBallsFaced');
    expect(game).toHaveProperty('homeAllOut');
  });

  test('?sport= filters the games list', async () => {
    const ctx = await apiAnon();
    const cricket = await (await ctx.get('/api/games?sport=cricket')).json();
    const football = await (await ctx.get('/api/games?sport=football')).json();
    expect(cricket.every((g) => g.sport === 'cricket')).toBeTruthy();
    expect(football.every((g) => g.sport === 'football')).toBeTruthy();
    expect(cricket.some((g) => g.id === GAME_ID)).toBeTruthy();
    expect(football.some((g) => g.id === GAME_ID)).toBeFalsy();
  });

  test('a pick round-trips its runs predictions', async () => {
    const res = await alice.post('/api/picks', {
      data: { gameId: GAME_ID, choice: 'home', predictedHomeRuns: 170, predictedAwayRuns: 150 },
    });
    expect(res.ok()).toBeTruthy();
    const picks = await (await alice.get('/api/picks')).json();
    const pick = picks.find((p) => p.gameId === GAME_ID);
    // Guards the zod-strips-unknown-keys failure mode: an unextended pickSchema
    // would drop these silently and still return 200.
    expect(pick.predictedHomeRuns).toBe(170);
    expect(pick.predictedAwayRuns).toBe(150);
  });

  test('a winner-only pick leaves the runs legs null', async () => {
    await alice.post('/api/picks', { data: { gameId: GAME_ID, choice: 'away' } });
    const picks = await (await alice.get('/api/picks')).json();
    const pick = picks.find((p) => p.gameId === GAME_ID);
    expect(pick.choice).toBe('away');
    expect(pick.predictedHomeRuns).toBeNull();
  });

  test('scores the winner leg flat and both runs legs, with proration', async () => {
    await alice.post('/api/picks', {
      data: { gameId: GAME_ID, choice: 'home', predictedHomeRuns: 170, predictedAwayRuns: 150 },
    });

    // Home 178 off a full 20 overs. Away 130 all out in 16.4 overs — all out,
    // so NOT prorated up to 156.
    const res = await admin.post(`/api/admin/games/${GAME_ID}/cricket-result`, {
      data: {
        result: 'home',
        home: innings(178, 5, '20.0'),
        away: innings(130, 10, '16.4', true),
      },
    });
    expect(res.ok()).toBeTruthy();

    const { Pick } = models();
    const pick = await Pick.findOne({ where: { userId: aliceId, gameId: GAME_ID } });
    // 50 winner + (100 - |178-170|) + (100 - |130-150|) = 50 + 92 + 80
    expect(pick.appliedPoints).toBe(222);
  });

  test('prorates a chase that finished early', async () => {
    await alice.post('/api/picks', {
      data: { gameId: GAME_ID, choice: 'away', predictedAwayRuns: 130 },
    });
    // 130 off 80 balls, not all out -> 195 at 20 overs. Predicting the literal
    // 130 is therefore 65 out, not spot on.
    await admin.post(`/api/admin/games/${GAME_ID}/cricket-result`, {
      data: {
        result: 'away',
        home: innings(129, 8, '20.0'),
        away: innings(130, 3, '13.2'),
      },
    });
    const { Pick } = models();
    const pick = await Pick.findOne({ where: { userId: aliceId, gameId: GAME_ID } });
    expect(pick.appliedPoints).toBe(50 + 35);
  });

  test('a wrong winner still banks the runs legs', async () => {
    await alice.post('/api/picks', {
      data: { gameId: GAME_ID, choice: 'home', predictedHomeRuns: 150, predictedAwayRuns: 160 },
    });
    await admin.post(`/api/admin/games/${GAME_ID}/cricket-result`, {
      data: {
        result: 'away',
        home: innings(150, 9, '20.0'),
        away: innings(160, 4, '20.0'),
      },
    });
    const { Pick } = models();
    const pick = await Pick.findOne({ where: { userId: aliceId, gameId: GAME_ID } });
    expect(pick.appliedPoints).toBe(200); // 0 winner + 100 + 100
  });

  test('a scorecard correction with an UNCHANGED result still moves the total', async () => {
    // The regression this whole compose-with-setResult design exists for. If
    // the scorecard were written after setResult rather than before,
    // applyPickTransition would compute the same points, take its idempotency
    // short-circuit, and drop the correction silently.
    await alice.post('/api/picks', {
      data: { gameId: GAME_ID, choice: 'home', predictedHomeRuns: 170 },
    });
    await admin.post(`/api/admin/games/${GAME_ID}/cricket-result`, {
      data: { result: 'home', home: innings(178, 5, '20.0'), away: innings(150, 10, '19.0', true) },
    });

    const { Pick, UserScoreOverall } = models();
    const first = (await UserScoreOverall.findOne({ where: { userId: aliceId } })).points;
    expect(first).toBe(142); // 50 + (100 - 8)

    await admin.post(`/api/admin/games/${GAME_ID}/cricket-result`, {
      data: { result: 'home', home: innings(171, 5, '20.0'), away: innings(150, 10, '19.0', true) },
    });
    const pick = await Pick.findOne({ where: { userId: aliceId, gameId: GAME_ID } });
    const after = (await UserScoreOverall.findOne({ where: { userId: aliceId } })).points;
    expect(pick.appliedPoints).toBe(149); // 50 + (100 - 1)
    expect(after - first).toBe(7);
  });

  test('an abandoned match voids the pick and is not counted as scored', async () => {
    await alice.post('/api/picks', {
      data: { gameId: GAME_ID, choice: 'home', predictedHomeRuns: 170 },
    });
    await admin.post(`/api/admin/games/${GAME_ID}/cricket-result`, {
      data: { result: null, home: innings(88, 2, '12.0'), away: innings(0, 0, '0.0') },
    });
    const { Pick, Game, UserScoreOverall } = models();
    const pick = await Pick.findOne({ where: { userId: aliceId, gameId: GAME_ID } });
    const game = await Game.findByPk(GAME_ID);
    const overall = await UserScoreOverall.findOne({ where: { userId: aliceId } });
    expect(pick.appliedPoints).toBe(0);
    // Not 'scheduled' — a rained-off match has happened and must not reappear
    // as an upcoming fixture.
    expect(game.status).toBe('cancelled');
    expect(overall?.picksScored ?? 0).toBe(0);
  });

  test('rejects a draw, a 7th ball, and a 10-wicket innings not marked all out', async () => {
    const bad = [
      { result: 'draw', home: innings(150, 5, '20.0'), away: innings(150, 6, '20.0') },
      { result: 'home', home: innings(150, 5, '19.7'), away: innings(140, 6, '20.0') },
      { result: 'home', home: innings(150, 10, '20.0'), away: innings(140, 6, '20.0') },
    ];
    for (const data of bad) {
      const res = await admin.post(`/api/admin/games/${GAME_ID}/cricket-result`, { data });
      expect(res.status(), JSON.stringify(data)).toBe(400);
    }
  });

  test('the cricket result route is admin-only', async () => {
    const res = await alice.post(`/api/admin/games/${GAME_ID}/cricket-result`, {
      data: { result: 'home', home: innings(150, 5, '20.0'), away: innings(140, 6, '20.0') },
    });
    expect(res.status()).toBe(403);
  });

  test('refuses to record a cricket result on a football game', async () => {
    const { Game } = models();
    const football = await Game.findOne({ where: { sport: 'football' } });
    const res = await admin.post(`/api/admin/games/${football.id}/cricket-result`, {
      data: { result: 'home', home: innings(150, 5, '20.0'), away: innings(140, 6, '20.0') },
    });
    expect(res.status()).toBe(400);
  });

  test('leaderboard ?sport= scopes points to that sport', async () => {
    await alice.post('/api/picks', {
      data: { gameId: GAME_ID, choice: 'home', predictedHomeRuns: 178 },
    });
    await admin.post(`/api/admin/games/${GAME_ID}/cricket-result`, {
      data: { result: 'home', home: innings(178, 5, '20.0'), away: innings(150, 10, '19.0', true) },
    });

    const cricket = await (await alice.get('/api/leaderboard?sport=cricket')).json();
    const football = await (await alice.get('/api/leaderboard?sport=football')).json();
    const row = (block) => block.overall.find((r) => r.userId === aliceId);

    expect(row(cricket).points).toBe(150); // 50 + 100
    // The cricket points must not leak into the football board.
    expect(row(football).points).toBe(0);
  });

  test('fixture sync is refused for a cricket league', async () => {
    const res = await admin.post(`/api/admin/leagues/${LEAGUE_ID}/sync`);
    // Without this guard the league's sourceLeagueId would be sent to
    // football-data.org as a competition code.
    expect(res.status()).toBe(400);
  });

  // -------------------------------------------------------------------------
  // CPL auto-results — automatic capture from the cricket provider.
  //
  // These drive CricketProviderService.applyProviderResult DIRECTLY rather
  // than running the cron job. The job's own logic is a cost gate plus a fetch;
  // everything that could corrupt a scorecard lives in the service and in
  // lib/cricketResult.js. Driving the service means no HTTP stub, no scheduler
  // (disabled under NODE_ENV=test anyway), and a real end-to-end assertion that
  // points actually move.
  // -------------------------------------------------------------------------
  test.describe('automatic result capture', () => {
    const PROVIDER_MATCH_ID = 'provider-match-e2e-1';

    function providerService() {
      return require('../../../services/CricketProviderService');
    }

    // A finished provider match for GAME_ID. Home 178/5 off 20; away 130 all
    // out in 16.4, so the away runs leg is NOT prorated up to 156.
    function finishedMatch(overrides = {}) {
      return {
        providerMatchId: PROVIDER_MATCH_ID,
        matchType: 't20',
        matchEnded: true,
        dateTimeGMT: new Date().toISOString(),
        teams: ['E2E Kings', 'E2E Warriors'],
        statusText: 'E2E Kings won by 48 runs',
        innings: [
          { teamName: 'E2E Kings', inningNumber: 1, runs: 178, wickets: 5, oversText: '20' },
          { teamName: 'E2E Warriors', inningNumber: 1, runs: 130, wickets: 10, oversText: '16.4' },
        ],
        ...overrides,
      };
    }

    async function apply(providerMatch) {
      const { Game } = models();
      const game = await Game.findByPk(GAME_ID);
      return providerService().applyProviderResult({
        game,
        providerMatch,
        leagueCode: 'E2ECPL',
      });
    }

    // writeEnabled() reads process.env on every call, and the service runs
    // in-process here, so the flag can be flipped per test.
    test.beforeEach(() => {
      process.env.CRICKET_RESULT_WRITE_ENABLED = 'true';
    });
    test.afterEach(() => {
      delete process.env.CRICKET_RESULT_WRITE_ENABLED;
    });

    test('captures a finished match end to end and scores the picks', async () => {
      await alice.post('/api/picks', {
        data: { gameId: GAME_ID, choice: 'home', predictedHomeRuns: 170, predictedAwayRuns: 150 },
      });

      const outcome = await apply(finishedMatch());
      expect(outcome.written).toBeTruthy();

      const { Game } = models();
      const game = await Game.findByPk(GAME_ID);
      expect(game.result).toBe('home');
      expect(game.status).toBe('finished');
      expect(game.resultSource).toBe('auto');
      // All eight innings columns, because a projection that misses any of them
      // silently mis-scores the runs legs.
      expect(game.homeScore).toBe(178);
      expect(game.homeWickets).toBe(5);
      expect(game.homeBallsFaced).toBe(120);
      expect(game.homeAllOut).toBe(false);
      expect(game.awayScore).toBe(130);
      expect(game.awayWickets).toBe(10);
      expect(game.awayBallsFaced).toBe(100);
      expect(game.awayAllOut).toBe(true);

      // 50 winner + (100 - |178-170|) + (100 - |130-150|) = 50 + 92 + 80.
      const board = await (await alice.get('/api/leaderboard?sport=cricket')).json();
      expect(board.overall.find((r) => r.userId === aliceId).points).toBe(222);
    });

    test('is idempotent — a second apply refuses and points do not move', async () => {
      await alice.post('/api/picks', {
        data: { gameId: GAME_ID, choice: 'home', predictedHomeRuns: 170, predictedAwayRuns: 150 },
      });
      await apply(finishedMatch());

      const second = await apply(finishedMatch());
      expect(second.written).toBeFalsy();
      expect(second.reason).toBe('already-captured');

      const board = await (await alice.get('/api/leaderboard?sport=cricket')).json();
      expect(board.overall.find((r) => r.userId === aliceId).points).toBe(222);
    });

    test('an admin correction moves the points AND locks the automation out', async () => {
      // The regression test for CricketResultService's ordering invariant under
      // the new source stamping: the result is unchanged, only the scorecard
      // moves, so if the scorecard were written after setResult the
      // oldPoints === newPoints short-circuit would silently drop the fix.
      await alice.post('/api/picks', {
        data: { gameId: GAME_ID, choice: 'home', predictedHomeRuns: 170, predictedAwayRuns: 150 },
      });
      await apply(finishedMatch());

      const corrected = await admin.post(`/api/admin/games/${GAME_ID}/cricket-result`, {
        data: {
          result: 'home',
          home: innings(190, 5, '20.0'),
          away: innings(130, 10, '16.4', true),
        },
      });
      expect(corrected.ok()).toBeTruthy();

      const { Game } = models();
      expect((await Game.findByPk(GAME_ID)).resultSource).toBe('admin');

      // 50 + (100 - |190-170|) + (100 - |130-150|) = 50 + 80 + 80.
      const board = await (await alice.get('/api/leaderboard?sport=cricket')).json();
      expect(board.overall.find((r) => r.userId === aliceId).points).toBe(210);

      // And the provider can never take it back.
      const reapplied = await apply(finishedMatch());
      expect(reapplied.reason).toBe('already-captured');
      const after = await Game.findByPk(GAME_ID);
      expect(after.homeScore).toBe(190);
      expect(after.resultSource).toBe('admin');
    });

    test('an abandoned match voids the game and scores nothing', async () => {
      await alice.post('/api/picks', {
        data: { gameId: GAME_ID, choice: 'home', predictedHomeRuns: 170, predictedAwayRuns: 150 },
      });

      const outcome = await apply(
        finishedMatch({ statusText: 'No result (abandoned due to rain)', innings: [] }),
      );
      expect(outcome.written).toBeTruthy();

      const { Game } = models();
      const game = await Game.findByPk(GAME_ID);
      expect(game.result).toBeNull();
      // Not 'scheduled' — a rained-off T20 has happened and must not reappear
      // as an upcoming fixture.
      expect(game.status).toBe('cancelled');

      const board = await (await alice.get('/api/leaderboard?sport=cricket')).json();
      expect(board.overall.find((r) => r.userId === aliceId).points).toBe(0);
    });

    test('refuses an unmappable team name and leaves the game untouched', async () => {
      const outcome = await apply(
        finishedMatch({
          statusText: 'Nobody XI won by 48 runs',
          innings: [
            { teamName: 'Nobody XI', inningNumber: 1, runs: 178, wickets: 5, oversText: '20' },
            {
              teamName: 'E2E Warriors',
              inningNumber: 1,
              runs: 130,
              wickets: 10,
              oversText: '16.4',
            },
          ],
        }),
      );
      expect(outcome.written).toBeFalsy();
      expect(outcome.reason).toBe('unmapped-inning-team');

      const { Game } = models();
      const game = await Game.findByPk(GAME_ID);
      expect(game.result).toBeNull();
      expect(game.resultSource).toBeNull();
      expect(game.homeScore).toBeNull();
    });

    test('refuses a tie with no Super Over rather than guessing', async () => {
      const outcome = await apply(
        finishedMatch({
          statusText: 'Match tied',
          innings: [
            { teamName: 'E2E Kings', inningNumber: 1, runs: 160, wickets: 6, oversText: '20' },
            { teamName: 'E2E Warriors', inningNumber: 1, runs: 160, wickets: 7, oversText: '20' },
          ],
        }),
      );
      expect(outcome.written).toBeFalsy();
      expect(outcome.reason).toBe('tie-no-super-over');
      expect((await models().Game.findByPk(GAME_ID)).resultSource).toBeNull();
    });

    test('shadow mode derives the payload but writes nothing', async () => {
      delete process.env.CRICKET_RESULT_WRITE_ENABLED;

      const outcome = await apply(finishedMatch());
      expect(outcome.written).toBeFalsy();
      expect(outcome.reason).toBe('shadow');
      // It still produced exactly what it would have written — that is what
      // makes a shadow run reviewable.
      expect(outcome.payload.result).toBe('home');
      expect(outcome.payload.away.allOut).toBe(true);

      const game = await models().Game.findByPk(GAME_ID);
      expect(game.result).toBeNull();
      expect(game.resultSource).toBeNull();
      expect(game.homeScore).toBeNull();
    });

    test('an unfinished match is skipped quietly', async () => {
      const outcome = await apply(
        finishedMatch({ matchEnded: false, statusText: 'E2E Kings elected to bat', innings: [] }),
      );
      expect(outcome.written).toBeFalsy();
      expect(outcome.reason).toBe('not-finished');
    });
  });
});
