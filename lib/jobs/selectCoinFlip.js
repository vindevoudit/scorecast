'use strict';

// Tier 30 Phase 3 A6 — Pick of the Day cron.
//
// Fires daily at 00:30 UTC. Selects the MOST UNCERTAIN scheduled
// fixture among today's games in active leagues and stamps its
// `coinFlipDayKey = today's YYYY-MM-DD (UTC)`. Idempotent — if
// today already has a coin flip selected, no-op.
//
// Uncertainty metric: minimize `max(home, draw, away)`. A perfectly
// 3-way uncertain game (0.33, 0.34, 0.33) scores 0.34, a confident
// favorite (0.80, 0.10, 0.10) scores 0.80. Tiebreaker: smallest gameId
// for determinism.
//
// Eligibility filter:
//   - status = 'scheduled' (not in-progress, not finished)
//   - league.active = true
//   - kickoff date within today's UTC window
//   - all three probabilities > 0 (excludes the (0.50, 0.00, 0.50)
//     pre-ML sentinel and any rows where ML hasn't run yet)
//
// Picks on coin-flip games drive the `coin-flip-master` badge — see
// services/BadgeService.computeProgressForUser.

const { Op } = require('sequelize');
const { Game, League } = require('../../models');
const logger = require('../logger');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayDayKey(now = new Date()) {
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function startOfNextUtcDay(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
}

// Pure function — given a list of candidate games (already filtered
// by status/league/date/non-zero-probs), pick the most uncertain one.
// Returns the selected game or null if the candidate list is empty.
// Exposed for unit testing.
function selectMostUncertain(games) {
  if (!games || games.length === 0) return null;
  let best = null;
  let bestScore = Infinity;
  for (const g of games) {
    const h = parseFloat(g.homeProbability);
    const d = parseFloat(g.drawProbability);
    const a = parseFloat(g.awayProbability);
    const score = Math.max(h, d, a);
    if (score < bestScore || (score === bestScore && best && g.id < best.id)) {
      best = g;
      bestScore = score;
    }
  }
  return best;
}

async function run({ now = new Date() } = {}) {
  const dayKey = todayDayKey(now);

  // Idempotency: if today already has a coin-flip, no-op.
  const existing = await Game.findOne({ where: { coinFlipDayKey: dayKey } });
  if (existing) {
    return { skipped: 'already-selected', dayKey, gameId: existing.id };
  }

  // Active leagues only — a deactivated league's games shouldn't
  // surface as a coin-flip target.
  const activeLeagues = await League.findAll({ where: { active: true }, attributes: ['id'] });
  if (activeLeagues.length === 0) {
    return { skipped: 'no-active-leagues', dayKey };
  }
  const leagueIds = activeLeagues.map((l) => l.id);

  const windowStart = startOfUtcDay(now);
  const windowEnd = startOfNextUtcDay(now);

  const candidates = await Game.findAll({
    where: {
      status: 'scheduled',
      leagueId: { [Op.in]: leagueIds },
      date: { [Op.gte]: windowStart, [Op.lt]: windowEnd },
      // Exclude games where ML hasn't run / the legacy (0.50, 0, 0.50)
      // sentinel by requiring all three probabilities to be positive.
      homeProbability: { [Op.gt]: 0 },
      drawProbability: { [Op.gt]: 0 },
      awayProbability: { [Op.gt]: 0 },
    },
  });
  if (candidates.length === 0) {
    return { skipped: 'no-eligible-games', dayKey };
  }

  const selected = selectMostUncertain(candidates);
  if (!selected) return { skipped: 'no-eligible-games', dayKey };

  selected.coinFlipDayKey = dayKey;
  await selected.save();

  logger.info(
    {
      dayKey,
      gameId: selected.id,
      matchup: `${selected.homeTeam} vs ${selected.awayTeam}`,
      probs: {
        h: parseFloat(selected.homeProbability),
        d: parseFloat(selected.drawProbability),
        a: parseFloat(selected.awayProbability),
      },
    },
    'selectCoinFlip: stamped coin-flip for the day',
  );
  return { dayKey, gameId: selected.id };
}

module.exports = {
  run,
  // Exposed for unit tests.
  selectMostUncertain,
  todayDayKey,
  startOfUtcDay,
  startOfNextUtcDay,
};
