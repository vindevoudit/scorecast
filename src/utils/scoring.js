import { CRICKET, T20_BALLS } from './sports';

// Client-side scoring preview. MUST stay in sync with lib/scoring.js
// (server-side authoritative scorer used by the leaderboard).
//
// Draw scoring (post-Tier-4b-draw): result='draw' awards partial credit per
//   pts_home = round(P_d × P_a / (P_h + P_a) × 100)
//   pts_away = round(P_d × P_h / (P_h + P_a) × 100)
//
// Pick-time snapshot: when pick.pickedHomeProbability is non-null, ALL three
// snapshot columns are populated (PickService.createPick is atomic). Reads
// are all-or-nothing — never mix snapshot with live game.* values or the
// draw branch math (which uses all three together) breaks. Use `!= null`
// not truthy so 0.0 stays valid for pickedDrawProbability on pre-draw rows.
// expectedWinPoints / expectedDrawPoints / pickStatus stay snapshot-agnostic
// on purpose — they're "what would this side pay right now" previews, not
// the locked payout.

export function scorePick(pick, game) {
  // Tier 34 — market dispatch, mirroring lib/scoring.js. Guarded at the top so
  // the football body below stays byte-identical.
  if (game?.sport === CRICKET) return scoreCricketPick(pick, game);

  if (!game?.result || !pick) return 0;

  const usesSnapshot = pick.pickedHomeProbability != null;
  const ph = parseFloat(usesSnapshot ? pick.pickedHomeProbability : game.homeProbability);
  const pd = parseFloat(usesSnapshot ? pick.pickedDrawProbability : game.drawProbability);
  const pa = parseFloat(usesSnapshot ? pick.pickedAwayProbability : game.awayProbability);

  if (game.result === 'draw') {
    const denom = ph + pa;
    if (denom <= 0 || Number.isNaN(pd)) return 0;
    const opposite = pick.choice === 'home' ? pa : ph;
    return Math.round(((pd * opposite) / denom) * 100);
  }
  const isWinning =
    (pick.choice === 'home' && game.result === 'home') ||
    (pick.choice === 'away' && game.result === 'away');
  if (!isWinning) return 0;
  const probability = pick.choice === 'home' ? ph : pa;
  return Math.round((1 - probability) * 100);
}

export function pickStatus(pick, game) {
  if (!game) return 'unknown';
  // Tier 34 — an abandoned cricket match (status='cancelled', result=null)
  // must not fall through to the wall-clock branch below, which would call it
  // 'live' forever while useGames buckets it into Completed. Scoped to cricket
  // on purpose: the same latent bug affects postponed FOOTBALL games, but
  // fixing that changes existing football behaviour, so it is logged in
  // TODO.md rather than bundled into the cricket work.
  if (game.sport === CRICKET && !game.result) {
    if (game.status === 'cancelled' || game.status === 'postponed') return 'void';
  }
  if (!game.result) {
    // Finished with result=null = legacy/pre-tier draw (picks are winner-only,
    // so it's a miss). Post-tier draws set result='draw' and hit the branch
    // below.
    if (game.status === 'finished') return pick ? 'lost' : 'no-pick';
    if (game.status === 'in-progress') return 'live';
    const kickoff = new Date(game.date);
    return kickoff <= new Date() ? 'live' : 'pending';
  }
  if (!pick) return 'no-pick';
  if (game.result === 'draw') return 'draw';
  return pick.choice === game.result ? 'won' : 'lost';
}

// ---------------------------------------------------------------------------
// Tier 34 — T20 cricket market (mirror of lib/scoring.js; keep in sync)
// ---------------------------------------------------------------------------
// Winner leg is a flat +50; each optional runs leg pays
// max(0, 100 - |effective - predicted|). A side that did not face 20 overs has
// its total scaled to a 20-over equivalent UNLESS it was bowled out.

export function effectiveRuns(game, side) {
  const runs = side === 'home' ? game.homeScore : game.awayScore;
  if (runs == null) return null;
  const allOut = side === 'home' ? game.homeAllOut : game.awayAllOut;
  if (allOut) return Number(runs);
  const balls = side === 'home' ? game.homeBallsFaced : game.awayBallsFaced;
  if (balls == null || Number(balls) >= T20_BALLS) return Number(runs);
  if (Number(balls) <= 0) return null;
  return Math.round((Number(runs) * T20_BALLS) / Number(balls));
}

export function runsLeg(predicted, effective) {
  if (predicted == null || effective == null) return 0;
  return Math.max(0, 100 - Math.abs(effective - Number(predicted)));
}

export function scoreCricketBreakdown(pick, game) {
  const empty = { winner: 0, homeRuns: 0, awayRuns: 0, total: 0, scored: false };
  if (!pick || !game || !game.result) return empty;
  const homeEffective = effectiveRuns(game, 'home');
  const awayEffective = effectiveRuns(game, 'away');
  const winner = pick.choice === game.result ? 50 : 0;
  // Rain voids both runs legs — see the long note in lib/scoring.js. Mirrored
  // here because this file IS the client copy of that formula and the two must
  // never disagree about what a pick is worth.
  const rainVoided = Boolean(game.rainAffected);
  const homeRuns = rainVoided ? 0 : runsLeg(pick.predictedHomeRuns, homeEffective);
  const awayRuns = rainVoided ? 0 : runsLeg(pick.predictedAwayRuns, awayEffective);
  return {
    winner,
    homeRuns,
    awayRuns,
    total: winner + homeRuns + awayRuns,
    scored: true,
    homeEffective,
    awayEffective,
    rainVoided,
  };
}

export function scoreCricketPick(pick, game) {
  return scoreCricketBreakdown(pick, game).total;
}

// Points on offer for a cricket pick, for the pre-match panel. The winner leg
// is flat and knowable; the runs legs are a ceiling, not a forecast.
export const CRICKET_WINNER_POINTS = 50;
export const CRICKET_RUNS_LEG_MAX = 100;

export function expectedWinPoints(side, game) {
  const p = side === 'home' ? parseFloat(game.homeProbability) : parseFloat(game.awayProbability);
  if (Number.isNaN(p)) return 0;
  return Math.round((1 - p) * 100);
}

// Partial-credit points if the match draws and the user picked `side`.
// Returns null when drawProbability isn't configured (NaN or 0), so the UI
// can show the +x / +y placeholders instead of misleading "+0" cells.
// Legacy rows (pre-tier) carry drawProbability=0 by the migration default
// and so render placeholders until admin or ML writes a real weight.
export function expectedDrawPoints(side, game) {
  const pd = parseFloat(game.drawProbability);
  if (!Number.isFinite(pd) || pd <= 0) return null;
  const ph = parseFloat(game.homeProbability);
  const pa = parseFloat(game.awayProbability);
  const opposite = side === 'home' ? pa : ph;
  const denom = ph + pa;
  if (denom <= 0) return 0;
  return Math.round(((pd * opposite) / denom) * 100);
}
