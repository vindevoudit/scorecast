// Client-side scoring preview. MUST stay in sync with lib/scoring.js
// (server-side authoritative scorer used by the leaderboard).
//
// Draw scoring (post-Tier-4b-draw): result='draw' awards partial credit per
//   pts_home = round(P_d × P_a / (P_h + P_a) × 100)
//   pts_away = round(P_d × P_h / (P_h + P_a) × 100)

export function scorePick(pick, game) {
  if (!game?.result || !pick) return 0;
  if (game.result === 'draw') {
    const ph = parseFloat(game.homeProbability);
    const pd = parseFloat(game.drawProbability);
    const pa = parseFloat(game.awayProbability);
    const denom = ph + pa;
    if (denom <= 0 || Number.isNaN(pd)) return 0;
    const opposite = pick.choice === 'home' ? pa : ph;
    return Math.round(((pd * opposite) / denom) * 100);
  }
  const isWinning =
    (pick.choice === 'home' && game.result === 'home') ||
    (pick.choice === 'away' && game.result === 'away');
  if (!isWinning) return 0;
  const probability =
    pick.choice === 'home' ? parseFloat(game.homeProbability) : parseFloat(game.awayProbability);
  return Math.round((1 - probability) * 100);
}

export function pickStatus(pick, game) {
  if (!game) return 'unknown';
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
