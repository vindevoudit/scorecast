'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isPlaceholderTeam } = require('../lib/placeholderTeam');

test('isPlaceholderTeam: null / empty / whitespace are placeholders', () => {
  assert.equal(isPlaceholderTeam(null), true);
  assert.equal(isPlaceholderTeam(undefined), true);
  assert.equal(isPlaceholderTeam(''), true);
});

test('isPlaceholderTeam: football-data.org knockout placeholders', () => {
  // Literal fallback from lib/footballApi.js
  assert.equal(isPlaceholderTeam('TBD'), true);
  // Upstream bracket strings seen during the 2026 WC sync
  assert.equal(isPlaceholderTeam('Winner Group A'), true);
  assert.equal(isPlaceholderTeam('Winner of QF1'), true);
  assert.equal(isPlaceholderTeam('Loser of SF2'), true);
  assert.equal(isPlaceholderTeam('Group A 1st'), true);
  assert.equal(isPlaceholderTeam('Runner-up Group B'), true);
  assert.equal(isPlaceholderTeam('Placeholder 3'), true);
  // Case + surrounding whitespace tolerant
  assert.equal(isPlaceholderTeam('  winner group c  '), true);
});

test('isPlaceholderTeam: real nations / clubs are not placeholders', () => {
  assert.equal(isPlaceholderTeam('Brazil'), false);
  assert.equal(isPlaceholderTeam('France'), false);
  assert.equal(isPlaceholderTeam('United States'), false);
  assert.equal(isPlaceholderTeam('Manchester City FC'), false);
  // "Wolverhampton" starts with 'w' but not the 'winner' token — must not
  // false-positive on the regex.
  assert.equal(isPlaceholderTeam('Wolverhampton Wanderers FC'), false);
  // A nation whose name contains "group" mid-string is fine (anchored ^).
  assert.equal(isPlaceholderTeam('Newell Group United'), false);
});
