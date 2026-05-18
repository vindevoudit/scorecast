'use strict';

// Tier 13 Chunk 1 — scoring helpers extracted from server.js. This is the
// authoritative server-side scorer; the client-side preview lives in
// src/utils/scoring.js and MUST stay in sync (CLAUDE.md invariant).
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

module.exports = { scorePick, sortLeaderboard };
