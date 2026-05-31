'use strict';

// Tier 30 Phase 3 A1 — pure state-machine tests for StreakService.
// Exercises the computeNextState decision function directly so the test
// suite doesn't need a live database. The applyPickForUser flow is
// covered by e2e tests (which validate the User.save persistence path
// + NotificationService dispatch).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeNextState,
  todayDayKey,
  todayMonthKey,
  daysBetween,
  STREAK_MILESTONES,
} = require('../services/StreakService');

function emptyPrev() {
  return {
    currentDailyStreak: 0,
    longestDailyStreak: 0,
    lastStreakDayKey: null,
    lastStreakFreezeMonth: null,
  };
}

test('todayDayKey returns YYYY-MM-DD in UTC', () => {
  const fixed = new Date('2026-05-30T12:34:56Z');
  assert.equal(todayDayKey(fixed), '2026-05-30');
});

test('todayMonthKey returns YYYY-MM in UTC', () => {
  const fixed = new Date('2026-05-30T12:34:56Z');
  assert.equal(todayMonthKey(fixed), '2026-05-30'.slice(0, 7));
});

test('daysBetween handles month + year boundaries', () => {
  assert.equal(daysBetween('2026-05-30', '2026-05-31'), 1);
  assert.equal(daysBetween('2026-05-30', '2026-06-01'), 2);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(daysBetween('2026-05-30', '2026-05-30'), 0);
});

test('first-ever pick starts streak at 1', () => {
  const result = computeNextState(emptyPrev(), '2026-05-30', '2026-05');
  assert.equal(result.changed, true);
  assert.equal(result.next.current, 1);
  assert.equal(result.next.longest, 1);
  assert.equal(result.next.lastDay, '2026-05-30');
  assert.equal(result.next.freezeMonth, null);
  assert.equal(result.milestone, null);
});

test('same-day re-pick is a no-op', () => {
  const prev = {
    currentDailyStreak: 5,
    longestDailyStreak: 12,
    lastStreakDayKey: '2026-05-30',
    lastStreakFreezeMonth: null,
  };
  const result = computeNextState(prev, '2026-05-30', '2026-05');
  assert.equal(result.changed, false);
  assert.equal(result.next.current, 5);
  assert.equal(result.next.longest, 12);
  assert.equal(result.milestone, null);
});

test('next-day pick increments streak', () => {
  const prev = {
    currentDailyStreak: 6,
    longestDailyStreak: 6,
    lastStreakDayKey: '2026-05-29',
    lastStreakFreezeMonth: null,
  };
  const result = computeNextState(prev, '2026-05-30', '2026-05');
  assert.equal(result.changed, true);
  assert.equal(result.next.current, 7);
  assert.equal(result.next.longest, 7);
  assert.equal(result.milestone, 7);
});

test('two-day gap with freeze available — consumes freeze, increments', () => {
  const prev = {
    currentDailyStreak: 10,
    longestDailyStreak: 10,
    lastStreakDayKey: '2026-05-28',
    lastStreakFreezeMonth: null,
  };
  const result = computeNextState(prev, '2026-05-30', '2026-05');
  assert.equal(result.changed, true);
  assert.equal(result.next.current, 11);
  assert.equal(result.next.freezeMonth, '2026-05');
});

test('two-day gap with freeze already consumed this month — resets to 1', () => {
  const prev = {
    currentDailyStreak: 10,
    longestDailyStreak: 10,
    lastStreakDayKey: '2026-05-28',
    lastStreakFreezeMonth: '2026-05',
  };
  const result = computeNextState(prev, '2026-05-30', '2026-05');
  assert.equal(result.changed, true);
  assert.equal(result.next.current, 1);
  assert.equal(result.next.longest, 10); // unchanged — high-water mark preserved
  assert.equal(result.next.freezeMonth, '2026-05'); // unchanged
});

test('freeze refreshes at the start of a new calendar month', () => {
  const prev = {
    currentDailyStreak: 10,
    longestDailyStreak: 10,
    lastStreakDayKey: '2026-05-30',
    lastStreakFreezeMonth: '2026-05',
  };
  // June 1: a one-day gap from May 30 → June 1 (gap = 2). The May freeze
  // is now stale relative to the June month key, so we get a fresh
  // freeze in June.
  const result = computeNextState(prev, '2026-06-01', '2026-06');
  assert.equal(result.changed, true);
  assert.equal(result.next.current, 11);
  assert.equal(result.next.freezeMonth, '2026-06');
});

test('three-day gap always resets regardless of freeze', () => {
  const prev = {
    currentDailyStreak: 20,
    longestDailyStreak: 20,
    lastStreakDayKey: '2026-05-27',
    lastStreakFreezeMonth: null, // freeze available, but gap > 2 so it can't save
  };
  const result = computeNextState(prev, '2026-05-30', '2026-05');
  assert.equal(result.changed, true);
  assert.equal(result.next.current, 1);
  assert.equal(result.next.longest, 20);
  assert.equal(result.next.freezeMonth, null); // freeze NOT consumed on clean miss
});

test('longest is preserved when current resets', () => {
  const prev = {
    currentDailyStreak: 5,
    longestDailyStreak: 42,
    lastStreakDayKey: '2026-05-20',
    lastStreakFreezeMonth: null,
  };
  const result = computeNextState(prev, '2026-05-30', '2026-05');
  assert.equal(result.next.current, 1);
  assert.equal(result.next.longest, 42);
});

test('longest advances when current overtakes it', () => {
  const prev = {
    currentDailyStreak: 41,
    longestDailyStreak: 41,
    lastStreakDayKey: '2026-05-29',
    lastStreakFreezeMonth: null,
  };
  const result = computeNextState(prev, '2026-05-30', '2026-05');
  assert.equal(result.next.current, 42);
  assert.equal(result.next.longest, 42);
});

test('milestones fire only on the exact threshold', () => {
  for (const milestone of STREAK_MILESTONES) {
    const prev = {
      currentDailyStreak: milestone - 1,
      longestDailyStreak: milestone - 1,
      lastStreakDayKey: '2026-05-29',
      lastStreakFreezeMonth: null,
    };
    const result = computeNextState(prev, '2026-05-30', '2026-05');
    assert.equal(result.next.current, milestone);
    assert.equal(result.milestone, milestone, `milestone ${milestone} should fire`);
  }
});

test('non-milestone days do not fire a milestone event', () => {
  for (const current of [2, 3, 5, 8, 15, 50, 99, 101]) {
    const prev = {
      currentDailyStreak: current - 1,
      longestDailyStreak: current - 1,
      lastStreakDayKey: '2026-05-29',
      lastStreakFreezeMonth: null,
    };
    const result = computeNextState(prev, '2026-05-30', '2026-05');
    assert.equal(result.milestone, null, `current=${current} should not fire`);
  }
});

test('anti-paradox guard: pick on a day already past lastStreakDayKey is a no-op', () => {
  const prev = {
    currentDailyStreak: 5,
    longestDailyStreak: 5,
    lastStreakDayKey: '2026-05-30',
    lastStreakFreezeMonth: null,
  };
  // Today appears to be "yesterday" relative to the recorded last day.
  // (Clock skew, manual DB fix, replica drift.) Should not corrupt state.
  const result = computeNextState(prev, '2026-05-29', '2026-05');
  assert.equal(result.changed, false);
  assert.equal(result.next.current, 5);
});
