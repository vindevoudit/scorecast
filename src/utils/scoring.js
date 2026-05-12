export function scorePick(pick, game) {
  if (!game?.result || !pick) return 0;
  const isWinning =
    (pick.choice === 'home' && game.result === 'home') ||
    (pick.choice === 'away' && game.result === 'away');
  if (!isWinning) return 0;
  const probability =
    pick.choice === 'home'
      ? parseFloat(game.homeProbability)
      : parseFloat(game.awayProbability);
  return Math.round((1 - probability) * 100);
}

export function pickStatus(pick, game) {
  if (!game) return 'unknown';
  if (!game.result) {
    const kickoff = new Date(game.date);
    return kickoff <= new Date() ? 'live' : 'pending';
  }
  if (!pick) return 'no-pick';
  return pick.choice === game.result ? 'won' : 'lost';
}
