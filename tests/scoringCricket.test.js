'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  scorePick,
  effectiveRuns,
  runsLeg,
  scoreCricketPick,
  scoreCricketBreakdown,
} = require('../lib/scoring');
const { ballsToOvers, oversToBalls, formatCricketScore } = require('../lib/sports');

// A finished cricket game. Overrides let each test state only what it cares about.
function cricketGame(overrides = {}) {
  return {
    sport: 'cricket',
    result: 'home',
    homeScore: null,
    awayScore: null,
    homeBallsFaced: null,
    awayBallsFaced: null,
    homeAllOut: false,
    awayAllOut: false,
    // Cricket carries no probability model; these stay at the sentinel forever
    // and must never influence the score.
    homeProbability: '0.50',
    drawProbability: '0.00',
    awayProbability: '0.50',
    ...overrides,
  };
}

function pick(overrides = {}) {
  return { choice: 'home', predictedHomeRuns: null, predictedAwayRuns: null, ...overrides };
}

// ---------------------------------------------------------------------------
// effectiveRuns — the proration rule
// ---------------------------------------------------------------------------

test('effectiveRuns: a full 20-over innings is not prorated', () => {
  const g = cricketGame({ homeScore: 178, homeBallsFaced: 120 });
  assert.equal(effectiveRuns(g, 'home'), 178);
});

test('effectiveRuns: a bowled-out side is NOT prorated even though it faced fewer balls', () => {
  // 96 all out in 14.3 overs. The score is what it is.
  const g = cricketGame({ homeScore: 96, homeBallsFaced: 87, homeAllOut: true });
  assert.equal(effectiveRuns(g, 'home'), 96);
});

test('effectiveRuns: a chase won early IS prorated to 20 overs', () => {
  // 130 in 13.2 overs (80 balls), not all out -> 130 * 120 / 80 = 195.
  const g = cricketGame({ awayScore: 130, awayBallsFaced: 80 });
  assert.equal(effectiveRuns(g, 'away'), 195);
});

test('effectiveRuns: a rain-shortened innings IS prorated to 20 overs', () => {
  // 120 in a 15-over (90-ball) innings -> 160.
  const g = cricketGame({ homeScore: 120, homeBallsFaced: 90 });
  assert.equal(effectiveRuns(g, 'home'), 160);
});

test('effectiveRuns: allOut wins over the ball count when both would apply', () => {
  // Same 80 balls as the prorated case above, but all out -> no proration.
  const g = cricketGame({ awayScore: 130, awayBallsFaced: 80, awayAllOut: true });
  assert.equal(effectiveRuns(g, 'away'), 130);
});

test('effectiveRuns: an unknown ball count assumes a full innings rather than inventing a scale', () => {
  const g = cricketGame({ homeScore: 150, homeBallsFaced: null });
  assert.equal(effectiveRuns(g, 'home'), 150);
});

test('effectiveRuns: zero balls faced yields null, not a divide-by-zero', () => {
  const g = cricketGame({ homeScore: 0, homeBallsFaced: 0 });
  assert.equal(effectiveRuns(g, 'home'), null);
});

test('effectiveRuns: a null score yields null', () => {
  assert.equal(effectiveRuns(cricketGame(), 'home'), null);
});

test('effectiveRuns: a ball count above a full innings is left alone', () => {
  const g = cricketGame({ homeScore: 200, homeBallsFaced: 126 });
  assert.equal(effectiveRuns(g, 'home'), 200);
});

test('effectiveRuns: rounds to the nearest whole run', () => {
  // 100 in 7 balls -> 1714.28... -> 1714. Absurd, but the rounding must be defined.
  const g = cricketGame({ homeScore: 100, homeBallsFaced: 7 });
  assert.equal(effectiveRuns(g, 'home'), 1714);
});

// ---------------------------------------------------------------------------
// runsLeg — max(0, 100 - |diff|)
// ---------------------------------------------------------------------------

test('runsLeg: an exact prediction pays the full 100', () => {
  assert.equal(runsLeg(178, 178), 100);
});

test('runsLeg: each run off costs one point', () => {
  assert.equal(runsLeg(170, 178), 92);
  assert.equal(runsLeg(186, 178), 92);
});

test('runsLeg: exactly 100 off pays 0 rather than going negative', () => {
  assert.equal(runsLeg(78, 178), 0);
  assert.equal(runsLeg(20, 178), 0);
});

test('runsLeg: a null prediction scores 0 (not entered)', () => {
  assert.equal(runsLeg(null, 178), 0);
});

test('runsLeg: a prediction of 0 is a real prediction, distinct from null', () => {
  assert.equal(runsLeg(0, 40), 60);
});

test('runsLeg: a null effective total scores 0', () => {
  assert.equal(runsLeg(150, null), 0);
});

// ---------------------------------------------------------------------------
// scoreCricketPick — the whole market
// ---------------------------------------------------------------------------

test('scoreCricketPick: correct winner with no runs entered pays the flat 50', () => {
  const g = cricketGame({ result: 'home', homeScore: 178, homeBallsFaced: 120 });
  assert.equal(scoreCricketPick(pick({ choice: 'home' }), g), 50);
});

test('scoreCricketPick: wrong winner with no runs entered pays 0', () => {
  const g = cricketGame({ result: 'away', homeScore: 178, homeBallsFaced: 120 });
  assert.equal(scoreCricketPick(pick({ choice: 'home' }), g), 0);
});

test('scoreCricketPick: the winner leg is flat, ignoring the probability columns', () => {
  // A lopsided probability pair must not shift the payout the way football does.
  const g = cricketGame({
    result: 'home',
    homeProbability: '0.90',
    awayProbability: '0.10',
  });
  assert.equal(scoreCricketPick(pick({ choice: 'home' }), g), 50);
});

test('scoreCricketPick: a perfect card pays the 250 maximum', () => {
  const g = cricketGame({
    result: 'home',
    homeScore: 178,
    homeBallsFaced: 120,
    awayScore: 165,
    awayBallsFaced: 120,
  });
  const p = pick({ choice: 'home', predictedHomeRuns: 178, predictedAwayRuns: 165 });
  assert.equal(scoreCricketPick(p, g), 250);
});

test('scoreCricketPick: runs legs still pay when the winner leg is missed', () => {
  const g = cricketGame({
    result: 'away',
    homeScore: 150,
    homeBallsFaced: 120,
    awayScore: 151,
    awayBallsFaced: 114,
  });
  // away: 151 in 114 balls -> round(151*120/114) = 159
  const p = pick({ choice: 'home', predictedHomeRuns: 150, predictedAwayRuns: 159 });
  assert.equal(scoreCricketPick(p, g), 0 + 100 + 100);
});

test('scoreCricketPick: predicting the literal score of an early chase is penalised', () => {
  // This is the documented consequence of the proration rule, locked so it
  // cannot regress silently: 130 off 80 balls prorates to 195, so a literal
  // 130 is 65 out and pays 35.
  const g = cricketGame({ result: 'away', awayScore: 130, awayBallsFaced: 80 });
  const p = pick({ choice: 'away', predictedAwayRuns: 130 });
  assert.equal(scoreCricketPick(p, g), 50 + 35);
});

test('scoreCricketPick: an abandoned match (no result) voids the whole pick', () => {
  const g = cricketGame({
    result: null,
    status: 'cancelled',
    homeScore: 88,
    homeBallsFaced: 60,
  });
  const p = pick({ choice: 'home', predictedHomeRuns: 176 });
  assert.equal(scoreCricketPick(p, g), 0);
});

test('scoreCricketPick: a game stored as a draw awards no winner points', () => {
  // Unreachable through CricketResultService, which rejects 'draw' for cricket,
  // but the scorer must be safe if the state is ever forced.
  const g = cricketGame({ result: 'draw', homeScore: 150, homeBallsFaced: 120 });
  const p = pick({ choice: 'home', predictedHomeRuns: 150 });
  assert.equal(scoreCricketPick(p, g), 100);
});

// ---------------------------------------------------------------------------
// scoreCricketBreakdown — must never disagree with the total
// ---------------------------------------------------------------------------

test('scoreCricketBreakdown: legs sum to the total and expose the prorated figures', () => {
  const g = cricketGame({
    result: 'home',
    homeScore: 190,
    homeBallsFaced: 120,
    awayScore: 130,
    awayBallsFaced: 80,
  });
  const p = pick({ choice: 'home', predictedHomeRuns: 185, predictedAwayRuns: 160 });
  const b = scoreCricketBreakdown(p, g);

  assert.equal(b.winner, 50);
  assert.equal(b.homeRuns, 95); // |190 - 185|
  assert.equal(b.awayRuns, 65); // effective 195, |195 - 160|
  assert.equal(b.total, 210);
  assert.equal(b.total, b.winner + b.homeRuns + b.awayRuns);
  assert.equal(b.homeEffective, 190);
  assert.equal(b.awayEffective, 195);
  assert.equal(b.scored, true);
});

test('scoreCricketBreakdown: an unscored game reports scored:false and zeroes', () => {
  const b = scoreCricketBreakdown(pick(), cricketGame({ result: null }));
  assert.deepEqual(b, { winner: 0, homeRuns: 0, awayRuns: 0, total: 0, scored: false });
});

// ---------------------------------------------------------------------------
// scorePick dispatch — the football path must be untouched
// ---------------------------------------------------------------------------

test('scorePick: routes cricket games to the cricket scorer', () => {
  const g = cricketGame({ result: 'home', homeScore: 178, homeBallsFaced: 120 });
  const p = pick({ choice: 'home', predictedHomeRuns: 178 });
  assert.equal(scorePick(p, g), 150);
});

test('scorePick: football games are unaffected by the cricket branch', () => {
  const g = {
    sport: 'football',
    result: 'home',
    homeProbability: '0.40',
    drawProbability: '0.25',
    awayProbability: '0.35',
  };
  // Unchanged football rule: round((1 - 0.40) * 100) = 60.
  assert.equal(scorePick({ choice: 'home' }, g), 60);
});

test('scorePick: a game with no sport field falls through to football', () => {
  // Guards against a projection that forgets to select `sport` silently
  // switching markets — it must degrade to the existing behaviour, not to zero.
  const g = { result: 'home', homeProbability: '0.40', awayProbability: '0.60' };
  assert.equal(scorePick({ choice: 'home' }, g), 60);
});

test('scorePick: football draw partial credit is unchanged', () => {
  const g = {
    sport: 'football',
    result: 'draw',
    homeProbability: '0.40',
    drawProbability: '0.25',
    awayProbability: '0.35',
  };
  // round(0.25 * 0.35 / 0.75 * 100) = 12
  assert.equal(scorePick({ choice: 'home' }, g), 12);
});

// ---------------------------------------------------------------------------
// lib/sports.js format helpers
// ---------------------------------------------------------------------------

test('ballsToOvers: base-6, not decimal', () => {
  assert.equal(ballsToOvers(120), '20.0');
  assert.equal(ballsToOvers(104), '17.2');
  assert.equal(ballsToOvers(0), '0.0');
  assert.equal(ballsToOvers(5), '0.5');
  assert.equal(ballsToOvers(6), '1.0');
  assert.equal(ballsToOvers(null), null);
});

test('oversToBalls: parses base-6 and rejects a 7th ball', () => {
  assert.equal(oversToBalls('20'), 120);
  assert.equal(oversToBalls('20.0'), 120);
  assert.equal(oversToBalls('17.2'), 104);
  assert.equal(oversToBalls('0.5'), 5);
  // There is no .6 in an over — this is a typo for 18.0 and must not coerce.
  assert.equal(oversToBalls('17.6'), null);
  assert.equal(oversToBalls('17.9'), null);
  assert.equal(oversToBalls('abc'), null);
  assert.equal(oversToBalls('17.25'), null);
  assert.equal(oversToBalls(''), null);
  assert.equal(oversToBalls(null), null);
});

test('oversToBalls round-trips against ballsToOvers', () => {
  for (let balls = 0; balls <= 120; balls += 1) {
    assert.equal(oversToBalls(ballsToOvers(balls)), balls);
  }
});

test('formatCricketScore: wickets are shown when known', () => {
  assert.equal(formatCricketScore(165, 6), '165/6');
  assert.equal(formatCricketScore(165, null), '165');
  assert.equal(formatCricketScore(null, 6), null);
});
