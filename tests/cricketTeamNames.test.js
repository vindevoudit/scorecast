'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTeamName,
  canonicalTeamName,
  teamsMatch,
  pairKey,
} = require('../lib/cricketTeamNames');

const CPL = 'CPL';

// ---------------------------------------------------------------------------
// normalizeTeamName — the fold that keeps the committed alias file small
// ---------------------------------------------------------------------------

test('normalizeTeamName: folds case, punctuation and whitespace', () => {
  assert.equal(normalizeTeamName('  Trinbago   Knight Riders  '), 'trinbago knight riders');
  assert.equal(normalizeTeamName('Guyana Amazon Warriors'), 'guyana amazon warriors');
});

test('normalizeTeamName: & and "and" are the same thing', () => {
  assert.equal(
    normalizeTeamName('Antigua & Barbuda Falcons'),
    normalizeTeamName('Antigua and Barbuda Falcons'),
  );
});

test('normalizeTeamName: St, St. and Saint are the same thing', () => {
  const expected = 'saint lucia kings';
  assert.equal(normalizeTeamName('St Lucia Kings'), expected);
  assert.equal(normalizeTeamName('St. Lucia Kings'), expected);
  assert.equal(normalizeTeamName('Saint Lucia Kings'), expected);
});

test('normalizeTeamName: the St -> Saint expansion does not fire inside a word', () => {
  // Regression guard: a naive replace turns "West Indies" into "weSaint Indies".
  assert.equal(normalizeTeamName('West Indies'), 'west indies');
  assert.equal(normalizeTeamName('Stars XI'), 'stars xi');
});

test('normalizeTeamName: & is expanded before punctuation is stripped', () => {
  // If punctuation were stripped first the ampersand would vanish and the two
  // words would collide ("a and b" vs "ab").
  assert.equal(normalizeTeamName('A & B'), 'a and b');
});

test('normalizeTeamName: strips accents left by NFKD', () => {
  assert.equal(normalizeTeamName('Curaçao'), 'curacao');
});

test('normalizeTeamName: tolerates null and empty input', () => {
  assert.equal(normalizeTeamName(null), '');
  assert.equal(normalizeTeamName(undefined), '');
  assert.equal(normalizeTeamName(''), '');
});

// ---------------------------------------------------------------------------
// canonicalTeamName — the committed alias map
// ---------------------------------------------------------------------------

test('canonicalTeamName: the 2026 rebrands resolve onto the fixture-file names', () => {
  // Both are real: Barbados reverted from Royals to Tridents for 2026, and
  // Jamaica returned as a new franchise where feeds may still say Tallawahs.
  assert.equal(canonicalTeamName('Barbados Royals', CPL), normalizeTeamName('Barbados Tridents'));
  assert.equal(canonicalTeamName('Jamaica Tallawahs', CPL), normalizeTeamName('Jamaica Kingsmen'));
  assert.equal(canonicalTeamName('Saint Lucia Zouks', CPL), normalizeTeamName('Saint Lucia Kings'));
});

test('canonicalTeamName: an alias survives the normaliser on the way in', () => {
  // The alias file's keys are normalised, so a provider sending "St. Lucia
  // Zouks" must still hit the "saint lucia zouks" entry.
  assert.equal(canonicalTeamName('St. Lucia Zouks', CPL), normalizeTeamName('Saint Lucia Kings'));
});

test('canonicalTeamName: an unknown name falls back to itself rather than throwing', () => {
  // Permissive by design — this runs inside a cron tick, and the caller already
  // refuses to write when a name fails to match a side.
  assert.equal(canonicalTeamName('Some New Franchise', CPL), 'some new franchise');
  assert.doesNotThrow(() => canonicalTeamName('Anything', 'NOT_A_LEAGUE'));
});

test('canonicalTeamName: every 2026 CPL side is stable under canonicalisation', () => {
  const sides = [
    'Antigua & Barbuda Falcons',
    'Barbados Tridents',
    'Guyana Amazon Warriors',
    'Jamaica Kingsmen',
    'Saint Lucia Kings',
    'St Kitts & Nevis Patriots',
    'Trinbago Knight Riders',
  ];
  for (const side of sides) {
    assert.equal(canonicalTeamName(side, CPL), normalizeTeamName(side), side);
  }
  // ...and they are all distinct, so no alias collapses two real teams.
  const keys = new Set(sides.map((s) => canonicalTeamName(s, CPL)));
  assert.equal(keys.size, sides.length);
});

test('canonicalTeamName: no placeholder ever canonicalises onto a real team', () => {
  const placeholders = [
    'Winner of Qualifier 1',
    'Winner of Qualifier 2',
    'Loser of Qualifier 1',
    'Winner of Eliminator',
    'TBD (1st place)',
  ];
  const real = new Set(
    ['Barbados Tridents', 'Jamaica Kingsmen', 'Trinbago Knight Riders', 'Saint Lucia Kings'].map(
      (s) => canonicalTeamName(s, CPL),
    ),
  );
  for (const p of placeholders) {
    assert.equal(real.has(canonicalTeamName(p, CPL)), false, p);
  }
});

// ---------------------------------------------------------------------------
// teamsMatch / pairKey
// ---------------------------------------------------------------------------

test('teamsMatch: across a rebrand and a punctuation difference', () => {
  assert.equal(teamsMatch('Barbados Royals', 'Barbados Tridents', CPL), true);
  assert.equal(
    teamsMatch('St Kitts & Nevis Patriots', 'Saint Kitts and Nevis Patriots', CPL),
    true,
  );
  assert.equal(teamsMatch('Barbados Tridents', 'Jamaica Kingsmen', CPL), false);
});

test('teamsMatch: two empty names are not a match', () => {
  assert.equal(teamsMatch('', '', CPL), false);
  assert.equal(teamsMatch(null, null, CPL), false);
});

test('pairKey: is order-free', () => {
  assert.equal(
    pairKey('Barbados Tridents', 'Jamaica Kingsmen', CPL),
    pairKey('Jamaica Kingsmen', 'Barbados Tridents', CPL),
  );
});

test('pairKey: bridges rebrands, which is what makes resolution work', () => {
  assert.equal(
    pairKey('Barbados Royals', 'Jamaica Tallawahs', CPL),
    pairKey('Barbados Tridents', 'Jamaica Kingsmen', CPL),
  );
});

test('pairKey: returns null when either side is unusable', () => {
  assert.equal(pairKey('', 'Jamaica Kingsmen', CPL), null);
  assert.equal(pairKey('Jamaica Kingsmen', null, CPL), null);
});
