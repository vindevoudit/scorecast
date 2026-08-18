'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveMatches } = require('../lib/cricketResult');

const CPL = 'CPL';
const opts = { leagueCode: CPL };

function game(id, homeTeam, awayTeam, date, extra = {}) {
  return { id, sourceId: `CPL2026-${id}`, homeTeam, awayTeam, date, ...extra };
}

function match(providerMatchId, teams, dateTimeGMT, extra = {}) {
  return { providerMatchId, teams, dateTimeGMT, matchType: 't20', ...extra };
}

test('resolveMatches: a clean one-to-one match resolves', () => {
  const out = resolveMatches(
    [game('M01', 'Barbados Tridents', 'Trinbago Knight Riders', '2026-08-20T23:00:00Z')],
    [
      match('p-1', ['Barbados Tridents', 'Trinbago Knight Riders'], '2026-08-20T23:00:00'),
      match('p-2', ['Jamaica Kingsmen', 'Saint Lucia Kings'], '2026-08-21T23:00:00'),
    ],
    opts,
  );
  assert.equal(out.resolved.length, 1);
  assert.equal(out.resolved[0].providerMatchId, 'p-1');
  assert.equal(out.unresolved.length, 0);
});

test('resolveMatches: resolves across a rebrand via the alias map', () => {
  const out = resolveMatches(
    [game('M01', 'Barbados Tridents', 'Jamaica Kingsmen', '2026-08-20T23:00:00Z')],
    [match('p-1', ['Barbados Royals', 'Jamaica Tallawahs'], '2026-08-20T23:00:00')],
    opts,
  );
  assert.equal(out.resolved.length, 1);
});

test('resolveMatches: home/away order does not have to agree', () => {
  const out = resolveMatches(
    [game('M01', 'Barbados Tridents', 'Trinbago Knight Riders', '2026-08-20T23:00:00Z')],
    [match('p-1', ['Trinbago Knight Riders', 'Barbados Tridents'], '2026-08-20T23:00:00')],
    opts,
  );
  assert.equal(out.resolved.length, 1);
});

test('resolveMatches: a doubleheader resolves both, because the pairs differ', () => {
  const out = resolveMatches(
    [
      game('M01', 'Barbados Tridents', 'Trinbago Knight Riders', '2026-08-20T18:00:00Z'),
      game('M02', 'Jamaica Kingsmen', 'Saint Lucia Kings', '2026-08-20T23:00:00Z'),
    ],
    [
      match('p-1', ['Barbados Tridents', 'Trinbago Knight Riders'], '2026-08-20T18:00:00'),
      match('p-2', ['Jamaica Kingsmen', 'Saint Lucia Kings'], '2026-08-20T23:00:00'),
    ],
    opts,
  );
  assert.equal(out.resolved.length, 2);
  assert.equal(out.unresolved.length, 0);
});

test('resolveMatches: the SAME pair twice inside the window is ambiguous and refuses', () => {
  const out = resolveMatches(
    [game('M01', 'Barbados Tridents', 'Trinbago Knight Riders', '2026-08-20T18:00:00Z')],
    [
      match('p-1', ['Barbados Tridents', 'Trinbago Knight Riders'], '2026-08-20T18:00:00'),
      match('p-2', ['Barbados Tridents', 'Trinbago Knight Riders'], '2026-08-20T23:00:00'),
    ],
    opts,
  );
  assert.equal(out.resolved.length, 0);
  assert.equal(out.unresolved[0].reason, 'ambiguous');
  assert.equal(out.unresolved[0].candidateCount, 2);
});

test('resolveMatches: a match outside the window is not a candidate', () => {
  const out = resolveMatches(
    [game('M01', 'Barbados Tridents', 'Trinbago Knight Riders', '2026-08-20T23:00:00Z')],
    [match('p-1', ['Barbados Tridents', 'Trinbago Knight Riders'], '2026-08-25T23:00:00')],
    opts,
  );
  assert.equal(out.resolved.length, 0);
  assert.equal(out.unresolved[0].reason, 'no-candidate');
});

test('resolveMatches: tolerates a kickoff that crosses midnight UTC', () => {
  // A 19:00 Caribbean start is 23:00 UTC and the provider may report a
  // date-only value. The window has to absorb that.
  const out = resolveMatches(
    [game('M01', 'Barbados Tridents', 'Trinbago Knight Riders', '2026-08-20T23:00:00Z')],
    [match('p-1', ['Barbados Tridents', 'Trinbago Knight Riders'], '2026-08-21T00:00:00')],
    opts,
  );
  assert.equal(out.resolved.length, 1);
});

test('resolveMatches: a non-T20 entry in the same series is never a candidate', () => {
  const out = resolveMatches(
    [game('M01', 'Barbados Tridents', 'Trinbago Knight Riders', '2026-08-20T23:00:00Z')],
    [
      match('p-1', ['Barbados Tridents', 'Trinbago Knight Riders'], '2026-08-20T23:00:00', {
        matchType: 'odi',
      }),
    ],
    opts,
  );
  assert.equal(out.resolved.length, 0);
});

test('resolveMatches: playoff placeholders refuse with their own reason', () => {
  const out = resolveMatches(
    [
      game('M39', 'Winner of Qualifier 1', 'Winner of Qualifier 2', '2026-09-20T23:00:00Z', {
        stage: 'FINAL',
      }),
      game('M38', 'TBD (1st place)', 'TBD (2nd place)', '2026-09-17T23:00:00Z'),
    ],
    [match('p-1', ['Barbados Tridents', 'Trinbago Knight Riders'], '2026-09-20T23:00:00')],
    opts,
  );
  assert.equal(out.resolved.length, 0);
  assert.equal(out.unresolved.length, 2);
  for (const row of out.unresolved) assert.equal(row.reason, 'placeholder-teams');
});

test('resolveMatches: a placeholder is never resolved by being the only match that night', () => {
  // Even a date-singleton must refuse: the local row says "Winner of
  // Qualifier 1", so the innings-to-side mapping would be impossible anyway.
  const out = resolveMatches(
    [game('M39', 'Winner of Qualifier 1', 'Winner of Qualifier 2', '2026-09-20T23:00:00Z')],
    [match('p-1', ['Barbados Tridents', 'Trinbago Knight Riders'], '2026-09-20T23:00:00')],
    opts,
  );
  assert.equal(out.resolved.length, 0);
});

test('resolveMatches: a game already stamped is skipped, and holds its claim', () => {
  const out = resolveMatches(
    [
      game('M01', 'Barbados Tridents', 'Trinbago Knight Riders', '2026-08-20T23:00:00Z', {
        providerMatchId: 'p-1',
      }),
      game('M02', 'Barbados Tridents', 'Trinbago Knight Riders', '2026-08-20T20:00:00Z'),
    ],
    [match('p-1', ['Barbados Tridents', 'Trinbago Knight Riders'], '2026-08-20T23:00:00')],
    opts,
  );
  // M01 is skipped entirely; M02 cannot take p-1 because M01 already claims it.
  assert.equal(out.resolved.length, 0);
  assert.equal(out.unresolved.length, 1);
  assert.equal(out.unresolved[0].sourceId, 'CPL2026-M02');
});

test('resolveMatches: never throws on malformed input', () => {
  assert.doesNotThrow(() => resolveMatches([], [], opts));
  assert.doesNotThrow(() => resolveMatches(null, null, opts));
  assert.doesNotThrow(() =>
    resolveMatches(
      [game('M01', 'A', 'B', 'not-a-date')],
      [match('p-1', ['A', 'B'], 'also-not-a-date')],
      opts,
    ),
  );
  assert.doesNotThrow(() =>
    resolveMatches([game('M01', 'A', 'B', '2026-08-20T23:00:00Z')], [match('p-1', [], null)], opts),
  );
});

test('resolveMatches: an unresolved row carries what the operator needs to fix it', () => {
  const out = resolveMatches(
    [game('M01', 'Barbados Tridents', 'Trinbago Knight Riders', '2026-08-20T23:00:00Z')],
    [],
    opts,
  );
  const row = out.unresolved[0];
  assert.equal(row.sourceId, 'CPL2026-M01');
  assert.equal(row.localHome, 'Barbados Tridents');
  assert.equal(row.localAway, 'Trinbago Knight Riders');
});
