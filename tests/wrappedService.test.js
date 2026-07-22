'use strict';

// World Cup Wrapped — pure-function tests for the stat helpers exported by
// services/WrappedService.js, exercised without a live DB. The database-backed
// shape + self-only route are covered by tests/e2e/api/me.spec.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  findBoldestCall,
  teamOfTournament,
  countUpsets,
  buildArchetype,
  ARCHETYPES,
} = require('../services/WrappedService');

function row(overrides) {
  return {
    choice: 'home',
    homeTeam: 'Home',
    awayTeam: 'Away',
    result: 'home',
    stage: 'GROUP_STAGE',
    stageLabel: 'Group Stage',
    scored: true,
    isWin: true,
    points: 50,
    probability: 0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// findBoldestCall
// ---------------------------------------------------------------------------

test('findBoldestCall — picks the lowest-probability winning pick', () => {
  const rows = [
    row({ pickedTeam: 'A', homeTeam: 'A', probability: 0.6, points: 40, isWin: true }),
    row({ pickedTeam: 'B', homeTeam: 'B', probability: 0.2, points: 80, isWin: true }),
    row({ pickedTeam: 'C', homeTeam: 'C', probability: 0.1, points: 90, isWin: false }), // not a win
  ];
  const best = findBoldestCall(rows);
  assert.equal(best.pickedTeam, 'B');
  assert.equal(best.probability, 0.2);
  assert.equal(best.points, 80);
});

test('findBoldestCall — returns null when there are no wins', () => {
  const rows = [row({ isWin: false }), row({ isWin: false, probability: 0.1 })];
  assert.equal(findBoldestCall(rows), null);
});

test('findBoldestCall — ignores wins with a null probability', () => {
  const rows = [
    row({ homeTeam: 'A', probability: null, isWin: true }),
    row({ homeTeam: 'B', probability: 0.7, isWin: true }),
  ];
  assert.equal(findBoldestCall(rows).pickedTeam, 'B');
});

// ---------------------------------------------------------------------------
// teamOfTournament
// ---------------------------------------------------------------------------

test('teamOfTournament — most-backed team by pick count', () => {
  const rows = [
    row({ choice: 'home', homeTeam: 'Brazil', isWin: true }),
    row({ choice: 'home', homeTeam: 'Brazil', isWin: false }),
    row({ choice: 'away', awayTeam: 'France', isWin: true }),
  ];
  const t = teamOfTournament(rows);
  assert.equal(t.team, 'Brazil');
  assert.equal(t.picks, 2);
  assert.equal(t.wins, 1);
});

test('teamOfTournament — ties broken by wins then name', () => {
  const rows = [
    row({ choice: 'home', homeTeam: 'Spain', isWin: false }),
    row({ choice: 'away', awayTeam: 'Italy', isWin: true }),
  ];
  // Both backed once; Italy has the win so it wins the tie.
  assert.equal(teamOfTournament(rows).team, 'Italy');
});

test('teamOfTournament — null on no picks', () => {
  assert.equal(teamOfTournament([]), null);
});

// ---------------------------------------------------------------------------
// countUpsets
// ---------------------------------------------------------------------------

test('countUpsets — counts correct picks under the 0.33 threshold', () => {
  const rows = [
    row({ isWin: true, probability: 0.2 }), // upset
    row({ isWin: true, probability: 0.32 }), // upset
    row({ isWin: true, probability: 0.4 }), // favourite
    row({ isWin: false, probability: 0.1 }), // not a win
  ];
  assert.equal(countUpsets(rows), 2);
});

test('countUpsets — zero when no bold wins', () => {
  assert.equal(countUpsets([row({ isWin: true, probability: 0.9 })]), 0);
});

// ---------------------------------------------------------------------------
// buildArchetype
// ---------------------------------------------------------------------------

test('buildArchetype — fewer than 3 scored picks → Newcomer', () => {
  assert.equal(buildArchetype({ winRate: 1, boldness: 1, scored: 2 }).key, ARCHETYPES.newcomer.key);
});

test('buildArchetype — bold + accurate → Oracle', () => {
  assert.equal(buildArchetype({ winRate: 0.6, boldness: 0.5, scored: 10 }).key, 'oracle');
});

test('buildArchetype — bold + inaccurate → Daredevil', () => {
  assert.equal(buildArchetype({ winRate: 0.3, boldness: 0.6, scored: 10 }).key, 'daredevil');
});

test('buildArchetype — safe + accurate → Analyst', () => {
  assert.equal(buildArchetype({ winRate: 0.7, boldness: 0.2, scored: 10 }).key, 'analyst');
});

test('buildArchetype — safe + inaccurate → Optimist', () => {
  assert.equal(buildArchetype({ winRate: 0.3, boldness: 0.2, scored: 10 }).key, 'optimist');
});

test('buildArchetype — boundary values land on the bold/accurate side', () => {
  // boldness 0.45 and winRate 0.5 are the inclusive thresholds → Oracle.
  assert.equal(buildArchetype({ winRate: 0.5, boldness: 0.45, scored: 3 }).key, 'oracle');
});
