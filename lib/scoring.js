'use strict';

// Tier 13 Chunk 1 — scoring helpers extracted from server.js. This is the
// authoritative server-side scorer; the client-side preview lives in
// src/utils/scoring.js and MUST stay in sync (CLAUDE.md invariant).
function scorePick(pick, game) {
  if (!game.result) return 0;
  const isWinningChoice =
    (pick.choice === 'home' && game.result === 'home') ||
    (pick.choice === 'away' && game.result === 'away');
  if (!isWinningChoice) return 0;
  const probability =
    pick.choice === 'home' ? parseFloat(game.homeProbability) : parseFloat(game.awayProbability);
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
