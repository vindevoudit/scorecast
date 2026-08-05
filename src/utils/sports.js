// Tier 34 — frontend mirror of lib/sports.js. MUST be changed in the same
// commit as the backend copy (same rule as lib/stages.js <-> src/utils/stages.js
// and lib/scoring.js <-> src/utils/scoring.js).

export const FOOTBALL = 'football';
export const CRICKET = 'cricket';

export const SPORTS = [FOOTBALL, CRICKET];
export const DEFAULT_SPORT = FOOTBALL;

export const SPORT_LABELS = {
  [FOOTBALL]: 'Football',
  [CRICKET]: 'Cricket',
};

// Emoji rather than an SVG set: these appear inline in pill labels and beside
// fixture rows, where a glyph that inherits font sizing beats a fixed icon.
export const SPORT_ICONS = {
  [FOOTBALL]: '⚽',
  [CRICKET]: '🏏',
};

// A full T20 innings. The unit of every proration in src/utils/scoring.js.
export const T20_BALLS = 120;

export function isSport(value) {
  return SPORTS.includes(value);
}

export function sportLabel(value) {
  return SPORT_LABELS[value] || SPORT_LABELS[DEFAULT_SPORT];
}

export function sportIcon(value) {
  return SPORT_ICONS[value] || SPORT_ICONS[DEFAULT_SPORT];
}

// 104 -> "17.2" (17 overs and 2 balls). Cricket overs are base-6, so this is
// NOT balls/6 — the fractional part counts balls, not tenths.
export function ballsToOvers(balls) {
  if (balls == null || !Number.isFinite(Number(balls))) return null;
  const n = Math.max(0, Math.trunc(Number(balls)));
  return `${Math.floor(n / 6)}.${n % 6}`;
}

// "17.2" -> 104. Returns null for anything malformed, including a .6-.9
// fractional part — there is no 7th ball in an over, so "17.6" is a typo for
// "18.0" and must be rejected rather than silently coerced.
export function oversToBalls(overs) {
  if (overs == null || overs === '') return null;
  const text = String(overs).trim();
  if (!/^\d+(\.\d)?$/.test(text)) return null;
  const [wholeText, ballText] = text.split('.');
  const balls = ballText == null ? 0 : Number(ballText);
  if (balls > 5) return null;
  return Number(wholeText) * 6 + balls;
}

// "165/6" when wickets are known, "165" otherwise.
export function formatCricketScore(runs, wickets) {
  if (runs == null) return null;
  if (wickets == null) return String(runs);
  return `${runs}/${wickets}`;
}
