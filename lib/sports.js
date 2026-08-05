'use strict';

// Tier 34 — canonical sport list and cricket format helpers.
//
// MIRROR INVARIANT: src/utils/sports.js is the frontend copy of this file and
// MUST be changed in the same commit (same rule as lib/stages.js and the
// lib/scoring.js <-> src/utils/scoring.js pair).
//
// A sport is a plain string, stored on leagues.sport and denormalised onto
// games.sport. Adding a third sport is: append here + in the mirror, add a
// market branch to lib/scoring.js, add a pick panel to GameCard.

const FOOTBALL = 'football';
const CRICKET = 'cricket';

const SPORTS = [FOOTBALL, CRICKET];
const DEFAULT_SPORT = FOOTBALL;

const SPORT_LABELS = {
  [FOOTBALL]: 'Football',
  [CRICKET]: 'Cricket',
};

// A full T20 innings. The unit of every proration in lib/scoring.js.
const T20_BALLS = 120;

function isSport(value) {
  return SPORTS.includes(value);
}

function sportLabel(value) {
  return SPORT_LABELS[value] || DEFAULT_SPORT;
}

// 104 -> "17.2" (17 overs and 2 balls). Cricket overs are base-6, so this is
// NOT balls/6 — the fractional part counts balls, not tenths.
function ballsToOvers(balls) {
  if (balls == null || !Number.isFinite(Number(balls))) return null;
  const n = Math.max(0, Math.trunc(Number(balls)));
  return `${Math.floor(n / 6)}.${n % 6}`;
}

// "17.2" -> 104. Returns null for anything malformed, including the classic
// mistake of a .6 through .9 fractional part — there is no 7th ball in an
// over, so "17.6" is a typo for "18.0" and must be rejected rather than
// silently coerced (it would shift the proration denominator).
function oversToBalls(overs) {
  if (overs == null || overs === '') return null;
  const text = String(overs).trim();
  if (!/^\d+(\.\d)?$/.test(text)) return null;
  const [wholeText, ballText] = text.split('.');
  const whole = Number(wholeText);
  const balls = ballText == null ? 0 : Number(ballText);
  if (balls > 5) return null;
  return whole * 6 + balls;
}

// "165/6" when the side lost wickets, "165" when it did not. A side that was
// bowled out reads "165 all out" at the callers that want the emphasis.
function formatCricketScore(runs, wickets) {
  if (runs == null) return null;
  if (wickets == null) return String(runs);
  return `${runs}/${wickets}`;
}

module.exports = {
  FOOTBALL,
  CRICKET,
  SPORTS,
  DEFAULT_SPORT,
  SPORT_LABELS,
  T20_BALLS,
  isSport,
  sportLabel,
  ballsToOvers,
  oversToBalls,
  formatCricketScore,
};
