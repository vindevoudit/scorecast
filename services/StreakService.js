'use strict';

// Tier 30 Phase 3 (Tier 27 Phase A — A1) — Streak service.
//
// Pick-streak (NOT win-streak): every calendar day on which a user creates
// at least one pick increments their `currentDailyStreak`. The streak
// resets to 1 on a clean miss (≥2 missed days with no freeze available,
// or 1 missed day with the monthly freeze already consumed). A monthly
// auto-grant streak-freeze covers exactly one missed day per calendar
// month — designed to absorb accidental skips (illness, travel, app
// downtime) without nuking long streaks.
//
// Called fire-and-forget from PickService.createPick AFTER the wrapping
// transaction commits. Streak update is independent of the pick row
// (different conceptual scope, no scoring or leaderboard interaction),
// so a streak failure must never block the pick. Concurrency: two
// parallel picks from the same user in the same tick resolve correctly
// via the "same dayKey → no-op" branch even if they race; worst case is
// one stale read that lands the same value the other writer would have
// landed (idempotent at the day-key granularity).
//
// Milestones at 7 / 14 / 30 / 60 / 100 fire a `streak-milestone`
// notification (dual-update rule: PUSH_NOTIFICATION_TYPES in
// validation/schemas.js + NOTIFICATION_TYPES in PushSettingsPanel.jsx).
// Deep-link `/?view=profile` per the Tier 18 Chunk 6a convention.

const { User } = require('../models');
const NotificationService = require('./NotificationService');
const logger = require('../lib/logger');

const STREAK_MILESTONES = [7, 14, 30, 60, 100];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayDayKey(now = new Date()) {
  // UTC YYYY-MM-DD. The boundary follows UTC midnight, not the user's
  // local midnight, so there's one stable answer regardless of which
  // replica saw the request. Streak resolution is calendar-day, not
  // minute-precision, so a UTC-vs-local mismatch around midnight is
  // acceptable; the freeze mechanism covers the rare edge case where
  // a user's "today" pick lands on "yesterday UTC".
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

function todayMonthKey(now = new Date()) {
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`;
}

function dayKeyToUtcMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(fromKey, toKey) {
  return Math.round((dayKeyToUtcMs(toKey) - dayKeyToUtcMs(fromKey)) / 86_400_000);
}

// Pure decision function — given the prior state and "today",
// returns the next state + which milestone (if any) was just reached.
// Exposed for unit testing.
function computeNextState(prev, today, monthKey) {
  const last = prev.lastStreakDayKey;
  const current = prev.currentDailyStreak || 0;
  const longest = prev.longestDailyStreak || 0;
  const freezeMonth = prev.lastStreakFreezeMonth;

  if (last === today) {
    // Already counted today; no-op.
    return {
      changed: false,
      next: { current, longest, lastDay: last, freezeMonth },
      milestone: null,
    };
  }

  let nextCurrent;
  let nextFreezeMonth = freezeMonth;

  if (!last) {
    nextCurrent = 1;
  } else {
    const gap = daysBetween(last, today);
    if (gap <= 0) {
      // Anti-paradox guard — pick "in the past" should never happen, but if
      // it does (clock skew, manual data fix), do nothing rather than corrupt
      // the streak.
      return {
        changed: false,
        next: { current, longest, lastDay: last, freezeMonth },
        milestone: null,
      };
    }
    if (gap === 1) {
      nextCurrent = current + 1;
    } else if (gap === 2 && freezeMonth !== monthKey) {
      nextCurrent = current + 1;
      nextFreezeMonth = monthKey;
    } else {
      nextCurrent = 1;
    }
  }

  const nextLongest = Math.max(longest, nextCurrent);
  const milestone = STREAK_MILESTONES.includes(nextCurrent) ? nextCurrent : null;

  return {
    changed: true,
    next: {
      current: nextCurrent,
      longest: nextLongest,
      lastDay: today,
      freezeMonth: nextFreezeMonth,
    },
    milestone,
  };
}

async function applyPickForUser(userId, { now = new Date() } = {}) {
  const user = await User.findByPk(userId);
  if (!user) return null;

  const today = todayDayKey(now);
  const monthKey = todayMonthKey(now);

  const result = computeNextState(
    {
      currentDailyStreak: user.currentDailyStreak,
      longestDailyStreak: user.longestDailyStreak,
      lastStreakDayKey: user.lastStreakDayKey,
      lastStreakFreezeMonth: user.lastStreakFreezeMonth,
    },
    today,
    monthKey,
  );

  if (!result.changed) {
    return {
      current: result.next.current,
      longest: result.next.longest,
      milestoneReached: null,
    };
  }

  user.currentDailyStreak = result.next.current;
  user.longestDailyStreak = result.next.longest;
  user.lastStreakDayKey = result.next.lastDay;
  user.lastStreakFreezeMonth = result.next.freezeMonth;
  await user.save({ hooks: false });

  if (result.milestone) {
    NotificationService.notify(
      userId,
      'streak-milestone',
      `You're on a ${result.milestone}-day streak!`,
      'Keep it going — pick a game today to extend it.',
      '/?view=profile',
    ).catch((err) => {
      logger.warn(
        { err: err.message, userId, milestone: result.milestone },
        'streak-milestone notify failed',
      );
    });
  }

  return {
    current: result.next.current,
    longest: result.next.longest,
    milestoneReached: result.milestone,
  };
}

module.exports = {
  applyPickForUser,
  computeNextState,
  todayDayKey,
  todayMonthKey,
  daysBetween,
  STREAK_MILESTONES,
};
