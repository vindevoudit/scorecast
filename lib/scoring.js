'use strict';

const { CRICKET, T20_BALLS } = require('./sports');

// Tier 13 Chunk 1 — scoring helpers extracted from server.js. This is the
// authoritative server-side scorer; the client-side preview lives in
// src/utils/scoring.js and MUST stay in sync (CLAUDE.md invariant).
//
// NOTE: there are FIVE copies of this formula in the repo, not two. The other
// three are scripts/backfill-user-scores.mjs, lib/jobs/postMatchdayGraphics.js
// and marketing/lib/livedata.mjs. All five must move together.
//
// Draw scoring (post-Tier-4b-draw): result='draw' awards partial credit per
//   pts_home = round(P_d × P_a / (P_h + P_a) × 100)
//   pts_away = round(P_d × P_h / (P_h + P_a) × 100)
// Legacy games default drawProbability=0, so picks on those score 0 on a draw.
//
// Pick-time snapshot: when pick.pickedHomeProbability is non-null, ALL three
// snapshot columns are populated (PickService.createPick is atomic). Reads
// are all-or-nothing — never mix snapshot with live game.* values or the
// draw branch math (which uses all three together) breaks. Use `!= null`
// not truthy so 0.0 stays valid for pickedDrawProbability on pre-draw rows.
function scorePick(pick, game) {
  // Tier 34 — market dispatch. Cricket uses a flat winner payout plus optional
  // runs legs; it never reads probabilities. Guarded at the top so the football
  // body below stays byte-identical, and since every football row carries
  // sport='football' this branch can never fire on one.
  if (game && game.sport === CRICKET) return scoreCricketPick(pick, game);

  if (!game.result) return 0;

  const usesSnapshot = pick && pick.pickedHomeProbability != null;
  const ph = parseFloat(usesSnapshot ? pick.pickedHomeProbability : game.homeProbability);
  const pd = parseFloat(usesSnapshot ? pick.pickedDrawProbability : game.drawProbability);
  const pa = parseFloat(usesSnapshot ? pick.pickedAwayProbability : game.awayProbability);

  if (game.result === 'draw') {
    const denom = ph + pa;
    if (denom <= 0 || Number.isNaN(pd)) return 0;
    const opposite = pick.choice === 'home' ? pa : ph;
    return Math.round(((pd * opposite) / denom) * 100);
  }
  const isWinningChoice =
    (pick.choice === 'home' && game.result === 'home') ||
    (pick.choice === 'away' && game.result === 'away');
  if (!isWinningChoice) return 0;
  const probability = pick.choice === 'home' ? ph : pa;
  return Math.round((1 - probability) * 100);
}

// ---------------------------------------------------------------------------
// Tier 34 — T20 cricket market
// ---------------------------------------------------------------------------
// Winner leg: a FLAT +50 for a correct winner. Deliberately not odds-weighted
// like football — cricket carries no probability model, and the runs legs are
// where the skill expression lives.
//
// Runs legs (optional, per side): max(0, 100 - |effective - predicted|).
//
// PRORATION. A side that did not face the full 20 overs has its total scaled
// to a 20-over equivalent, UNLESS it was bowled out — a side dismissed for 96
// scored 96, full stop, and inflating that would punish the bowling side's
// own success. Both causes of a short innings prorate: the chase finishing
// early AND overs being lost to rain.
//
// The consequence worth knowing: a side that wins a chase with 7 overs to
// spare turns 130 into 195, so predicting the LITERAL score of a successful
// chase scores poorly. That is intended — it makes the market about run rate
// rather than about guessing how early a chase ends — but the UI must state
// it before the user types, and show both figures afterwards.

// A side's 20-over-equivalent total, or null when it cannot be computed.
function effectiveRuns(game, side) {
  const runs = side === 'home' ? game.homeScore : game.awayScore;
  if (runs == null) return null;

  // Bowled out -> the score is what it is. Checked BEFORE the ball count,
  // because an all-out side has almost always faced fewer than 120 balls.
  const allOut = side === 'home' ? game.homeAllOut : game.awayAllOut;
  if (allOut) return Number(runs);

  const balls = side === 'home' ? game.homeBallsFaced : game.awayBallsFaced;
  // Unknown ball count -> assume a full innings rather than invent a scale
  // factor. `>= T20_BALLS` also covers the (impossible but cheap to guard)
  // over-long innings.
  if (balls == null || Number(balls) >= T20_BALLS) return Number(runs);
  // A side that faced no balls has no meaningful rate to extrapolate from.
  if (Number(balls) <= 0) return null;

  return Math.round((Number(runs) * T20_BALLS) / Number(balls));
}

// Points for one runs leg. A null prediction means "not entered" (0 points),
// which is distinct from a prediction of 0 runs.
function runsLeg(predicted, effective) {
  if (predicted == null || effective == null) return 0;
  return Math.max(0, 100 - Math.abs(effective - Number(predicted)));
}

// Per-leg detail for the UI and notification copy. Shares every code path with
// scoreCricketPick so the breakdown can never disagree with the total.
function scoreCricketBreakdown(pick, game) {
  const empty = { winner: 0, homeRuns: 0, awayRuns: 0, total: 0, scored: false };
  if (!pick || !game || !game.result) return empty;

  const homeEffective = effectiveRuns(game, 'home');
  const awayEffective = effectiveRuns(game, 'away');
  // pick.choice is only ever 'home' | 'away', so a game stored as a 'draw'
  // awards no winner points. Cricket rejects 'draw' at the write boundary
  // (CricketResultService) precisely so this state is unreachable.
  const winner = pick.choice === game.result ? 50 : 0;
  const homeRuns = runsLeg(pick.predictedHomeRuns, homeEffective);
  const awayRuns = runsLeg(pick.predictedAwayRuns, awayEffective);

  return {
    winner,
    homeRuns,
    awayRuns,
    total: winner + homeRuns + awayRuns,
    scored: true,
    homeEffective,
    awayEffective,
  };
}

function scoreCricketPick(pick, game) {
  // No result -> the whole pick voids at 0. Because UserScoreService's
  // deriveCounterDeltas only moves counters on a non-null result, an abandoned
  // match also correctly stays out of picksScored, so it cannot dent win rate.
  return scoreCricketBreakdown(pick, game).total;
}

function sortLeaderboard(rows, orderBy) {
  const sorted = [...rows];
  if (orderBy === 'winRate') {
    sorted.sort((a, b) => (b.winRate || 0) - (a.winRate || 0) || (b.points || 0) - (a.points || 0));
  } else if (orderBy === 'username') {
    sorted.sort((a, b) => {
      const an = (a.displayName || a.username || '').toLowerCase();
      const bn = (b.displayName || b.username || '').toLowerCase();
      return an.localeCompare(bn);
    });
  } else {
    sorted.sort((a, b) => (b.points || 0) - (a.points || 0));
  }
  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

module.exports = {
  scorePick,
  sortLeaderboard,
  // Tier 34 — cricket market internals, exported for the UI preview, the
  // admin form and the unit tests.
  effectiveRuns,
  runsLeg,
  scoreCricketPick,
  scoreCricketBreakdown,
};
