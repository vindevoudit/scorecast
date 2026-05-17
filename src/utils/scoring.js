export function scorePick(pick, game) {
  if (!game?.result || !pick) return 0;
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
    // Finished without a winner = draw; picks are winner-only, so it's a miss.
    if (game.status === 'finished') return pick ? 'lost' : 'no-pick';
    if (game.status === 'in-progress') return 'live';
    const kickoff = new Date(game.date);
    return kickoff <= new Date() ? 'live' : 'pending';
  }
  if (!pick) return 'no-pick';
  return pick.choice === game.result ? 'won' : 'lost';
}

export function expectedWinPoints(side, game) {
  const p = side === 'home' ? parseFloat(game.homeProbability) : parseFloat(game.awayProbability);
  if (Number.isNaN(p)) return 0;
  return Math.round((1 - p) * 100);
}

// Returns null when drawProbability isn't on the row so the UI can suppress
// the Draw row. Activates automatically once the draw-scoring tier writes it.
export function expectedDrawPoints(side, game) {
  const pd = parseFloat(game.drawProbability);
  if (Number.isNaN(pd)) return null;
  const ph = parseFloat(game.homeProbability);
  const pa = parseFloat(game.awayProbability);
  const opposite = side === 'home' ? pa : ph;
  const denom = ph + pa;
  if (denom <= 0) return 0;
  return Math.round((opposite / denom) * (1 - pd) * 100);
}
