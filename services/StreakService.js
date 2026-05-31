'use strict';

// Tier 30 Phase 3 A1 Revision (2026-05-31) — Win-streak service.
//
// REPLACES the original calendar-day pick streak. Streaks are now per
// scoring event:
//
//   W (pick.choice === game.result, non-draw)  → current += 1
//   D (game.result === 'draw')                 → no-op
//   L (game scored, not draw, doesn't match)   → current = 0
//   Pending (game.result === null)             → ignored
//
// Within a same-kickoff batch (picks on games sharing game.date), wins
// are applied first, then draws, then losses — so longest captures the
// batch peak even when the final pick in the batch is a loss.
//
// longest is MONOTONIC: never shrinks on a recompute. A retroactive
// result correction that trims the computed history can still leave the
// previously-stamped longest in place, honoring the user's wording
// "highest ever will be recorded".
//
// Implementation: full recompute from the user's scored pick history on
// every scoring event. O(N) per affected user where N = lifetime scored
// picks. Sub-millisecond at our scale. Recompute beats an incremental
// state machine on simplicity: result corrections (X → Y, X → null) fall
// out naturally with no reversal logic.
//
// Trigger: fire-and-forget POST-transaction from
//   GameService.setResult
//   GameService.bulkSetResult
//   GameService.applyLiveUpdate
// (the three result-scoring entry points). Pick creation no longer
// affects the streak — the result does. PickService.createPick used to
// hook here pre-rework; that hook was removed.
//
// Milestones at 5 / 10 / 15 / 20 / 30 / 50 fire a `streak-milestone`
// push notification (dual-update rule: PUSH_NOTIFICATION_TYPES in
// validation/schemas.js + NOTIFICATION_TYPES in PushSettingsPanel.jsx).
// Deep-link `/?view=profile` per the Tier 18 Chunk 6a convention.
//
// Milestone dedup via users.lastMilestoneFired:
//   Fire the largest M in STREAK_MILESTONES with M <= newCurrent AND
//   M > prevMilestoneFired. Stamp lastMilestoneFired = M.
//   When newCurrent drops below prevMilestoneFired (e.g. after a loss
//   reset), drop lastMilestoneFired to max(M ≤ newCurrent) so future
//   re-crossings re-fire.

const { Op } = require('sequelize');
const { User, Pick, Game } = require('../models');
const NotificationService = require('./NotificationService');
const logger = require('../lib/logger');

const STREAK_MILESTONES = [5, 10, 15, 20, 30, 50];

// Result priority for same-kickoff sort: wins first so longest captures
// the batch peak before a draw/loss resets current.
const RESULT_PRIORITY = { win: 0, draw: 1, loss: 2 };

// Classify a single scored pick. Inputs assumed non-null (caller filters
// out pending picks). Returns one of 'win' | 'draw' | 'loss'.
function classify(pick, game) {
  if (game.result === 'draw') return 'draw';
  if (pick.choice === game.result) return 'win';
  return 'loss';
}

// Pure function — given a list of scored picks (each carrying its
// associated Game's date + result + id), return {current, longest}.
//
// Input shape: each entry is { choice, game: { id, date, result } }.
// Sequelize associations produce nested rows shaped this way when loaded
// via `include: [{ model: Game }]`.
//
// Sort order is the load-bearing invariant — see the file header.
function computeStreakFromPicks(scoredPicks) {
  const rows = scoredPicks
    .filter((p) => p.game && p.game.result !== null && p.game.result !== undefined)
    .map((p) => ({
      kind: classify(p, p.game),
      date: new Date(p.game.date).getTime(),
      gameId: p.game.id,
    }));

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date - b.date;
    const pa = RESULT_PRIORITY[a.kind];
    const pb = RESULT_PRIORITY[b.kind];
    if (pa !== pb) return pa - pb;
    // Stable final tiebreaker so the same input always produces the same
    // output regardless of array order coming in.
    if (a.gameId < b.gameId) return -1;
    if (a.gameId > b.gameId) return 1;
    return 0;
  });

  let current = 0;
  let longest = 0;
  for (const row of rows) {
    if (row.kind === 'win') {
      current += 1;
      if (current > longest) longest = current;
    } else if (row.kind === 'loss') {
      current = 0;
    }
    // draw → no-op
  }
  return { current, longest };
}

// Given the previous lastMilestoneFired and the new current value,
// decide which milestone (if any) to fire and what to stamp.
//   - If a milestone M is newly crossed (M > prev AND M <= newCurrent),
//     fire the LARGEST such M (one push per recompute, never a flurry).
//   - If newCurrent dropped below prev (loss reset, retroactive
//     correction), recompute the stamped value down to the largest
//     milestone ≤ newCurrent — so future re-crossings re-fire.
function resolveMilestone(newCurrent, prevMilestoneFired) {
  if (newCurrent >= prevMilestoneFired) {
    const eligible = STREAK_MILESTONES.filter((M) => M <= newCurrent && M > prevMilestoneFired);
    if (eligible.length === 0) {
      return { fire: null, nextStamp: prevMilestoneFired };
    }
    const fire = Math.max(...eligible);
    return { fire, nextStamp: fire };
  }
  // newCurrent < prevMilestoneFired — drop the stamp.
  const reachable = STREAK_MILESTONES.filter((M) => M <= newCurrent);
  const nextStamp = reachable.length > 0 ? Math.max(...reachable) : 0;
  return { fire: null, nextStamp };
}

// Recompute and persist the user's streak. Fires fire-and-forget from
// the GameService result hooks. Never throws — a streak outage must
// never break the result commit (Tier 5.3 invariant carried forward).
async function applyForUser(userId) {
  const user = await User.findByPk(userId);
  if (!user) return null;

  // Load all of the user's scored picks with their associated game's
  // date + result + id. INNER JOIN via required:true so picks on
  // unscored games drop out at the SQL layer.
  const picks = await Pick.findAll({
    where: { userId },
    attributes: ['choice'],
    include: [
      {
        model: Game,
        required: true,
        where: { result: { [Op.ne]: null } },
        attributes: ['id', 'date', 'result'],
      },
    ],
  });

  const scoredPicks = picks.map((p) => ({
    choice: p.choice,
    game: {
      id: p.Game.id,
      date: p.Game.date,
      result: p.Game.result,
    },
  }));

  const { current, longest } = computeStreakFromPicks(scoredPicks);

  const prevCurrent = user.currentWinStreak || 0;
  const prevLongest = user.longestWinStreak || 0;
  const prevMilestoneFired = user.lastMilestoneFired || 0;

  // Monotonic longest — never decrease.
  const nextLongest = Math.max(prevLongest, longest);

  const { fire, nextStamp } = resolveMilestone(current, prevMilestoneFired);

  const changed =
    prevCurrent !== current || prevLongest !== nextLongest || prevMilestoneFired !== nextStamp;

  if (!changed) {
    return {
      current,
      longest: nextLongest,
      milestoneReached: null,
    };
  }

  user.currentWinStreak = current;
  user.longestWinStreak = nextLongest;
  user.lastMilestoneFired = nextStamp;
  await user.save({ hooks: false });

  if (fire) {
    NotificationService.notify(
      userId,
      'streak-milestone',
      `You're on a ${fire}-win streak!`,
      'Keep picking — win again to extend it.',
      '/?view=profile',
    ).catch((err) => {
      logger.warn({ err: err.message, userId, milestone: fire }, 'streak-milestone notify failed');
    });
  }

  return {
    current,
    longest: nextLongest,
    milestoneReached: fire,
  };
}

module.exports = {
  applyForUser,
  classify,
  computeStreakFromPicks,
  resolveMilestone,
  STREAK_MILESTONES,
};
