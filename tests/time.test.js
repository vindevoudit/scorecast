'use strict';

// Live-match phase labels — matchMinute returns a coarse phase string
// ("First half" / "Half time" / "Second half" / "Extra time" / "Penalties")
// instead of a drifting minute estimate. The half-time window is the only
// remaining time-based check; everything else leans on the upstream
// `phase` + `halfTimeReached` signals.
//
// time.js is an ESM module (imports React), so it's loaded via dynamic
// import from this CommonJS test file. `now` is passed explicitly to keep
// every case deterministic.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const MIN = 60 * 1000;
const KICKOFF = new Date('2026-06-10T18:00:00Z').getTime();

let matchMinute;
before(async () => {
  ({ matchMinute } = await import('../src/utils/time.js'));
});

test('before kickoff → null label', () => {
  const r = matchMinute(KICKOFF, { halfTimeReached: false }, KICKOFF - 5 * MIN);
  assert.equal(r.label, null);
});

test('early elapsed, no halftime flag → First half', () => {
  const r = matchMinute(KICKOFF, { halfTimeReached: false }, KICKOFF + 10 * MIN);
  assert.equal(r.label, 'First half');
});

test('first half running long but no HT flag yet → still First half', () => {
  // 47 min elapsed but upstream hasn't written the HT score — we don't guess.
  const r = matchMinute(KICKOFF, { halfTimeReached: false }, KICKOFF + 47 * MIN);
  assert.equal(r.label, 'First half');
});

test('halftime reached, inside the 46-60 break window → Half time', () => {
  const r = matchMinute(KICKOFF, { halfTimeReached: true }, KICKOFF + 50 * MIN);
  assert.equal(r.label, 'Half time');
});

test('halftime reached, past the break window → Second half', () => {
  const r = matchMinute(KICKOFF, { halfTimeReached: true }, KICKOFF + 70 * MIN);
  assert.equal(r.label, 'Second half');
});

test("phase 'extra-time' wins regardless of elapsed → Extra time", () => {
  const r = matchMinute(
    KICKOFF,
    { halfTimeReached: true, phase: 'extra-time' },
    KICKOFF + 100 * MIN,
  );
  assert.equal(r.label, 'Extra time');
});

test("phase 'penalty-shootout' → Penalties", () => {
  const r = matchMinute(
    KICKOFF,
    { halfTimeReached: true, phase: 'penalty-shootout' },
    KICKOFF + 120 * MIN,
  );
  assert.equal(r.label, 'Penalties');
});

test('minute field is always null (no consumer reads it)', () => {
  const r = matchMinute(KICKOFF, { halfTimeReached: false }, KICKOFF + 10 * MIN);
  assert.equal(r.minute, null);
});
