'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyStatus,
  mapInningsToSides,
  isRainShortened,
  deriveAllOut,
  deriveWinner,
  buildCricketResultPayload,
} = require('../lib/cricketResult');
const { cricketResultSchema } = require('../validation/schemas');

const CPL = 'CPL';
const HOME = 'Barbados Tridents';
const AWAY = 'Trinbago Knight Riders';

function game(overrides = {}) {
  return {
    id: 'game-1',
    sourceId: 'CPL2026-M10',
    homeTeam: HOME,
    awayTeam: AWAY,
    date: '2026-08-20T23:00:00.000Z',
    ...overrides,
  };
}

// `inn` takes overs as the provider sends them (base-6 text).
function inn(teamName, runs, wickets, overs) {
  return { teamName, inningNumber: 1, runs, wickets, oversText: String(overs) };
}

function providerMatch(overrides = {}) {
  return {
    providerMatchId: 'p-1',
    matchType: 't20',
    matchEnded: true,
    dateTimeGMT: '2026-08-20T23:00:00',
    teams: [HOME, AWAY],
    statusText: '',
    innings: [],
    ...overrides,
  };
}

const build = (pm, g = game()) => buildCricketResultPayload(g, pm, { leagueCode: CPL });

// ---------------------------------------------------------------------------
// classifyStatus
// ---------------------------------------------------------------------------

test('classifyStatus: a normal win by wickets', () => {
  const s = classifyStatus('Trinbago Knight Riders won by 5 wickets');
  assert.equal(s.winnerName, 'Trinbago Knight Riders');
  assert.equal(s.noResult, false);
  assert.equal(s.notStarted, false);
});

test('classifyStatus: a normal win by runs', () => {
  assert.equal(classifyStatus('Barbados Tridents won by 12 runs').winnerName, 'Barbados Tridents');
});

test('classifyStatus: flags DLS in all its spellings', () => {
  assert.equal(classifyStatus('X won by 3 wickets (D/L method)').dls, true);
  assert.equal(classifyStatus('X won by 3 wickets (DLS method)').dls, true);
  assert.equal(classifyStatus('X won by 3 wickets (Duckworth-Lewis)').dls, true);
});

test('classifyStatus: flags a Super Over', () => {
  const s = classifyStatus('Trinbago Knight Riders won the Super Over');
  assert.equal(s.superOver, true);
  assert.equal(s.winnerName, 'Trinbago Knight Riders');
});

test('classifyStatus: recognises every no-result phrasing', () => {
  for (const text of [
    'No result',
    'Match abandoned due to rain',
    'Match called off',
    'Washed out without a ball bowled',
    'Match cancelled',
  ]) {
    assert.equal(classifyStatus(text).noResult, true, text);
  }
});

test('classifyStatus: a no-result never yields a winner name', () => {
  // "X won the toss" plus an abandonment must not leave a winner behind.
  const s = classifyStatus('Barbados Tridents won the toss. No result.');
  assert.equal(s.noResult, true);
  assert.equal(s.winnerName, null);
});

test('classifyStatus: a toss line is NOT a match winner', () => {
  // The single most dangerous misread available here: "X won the toss and
  // elected to bat" parsing as "X won the match".
  const s = classifyStatus('Barbados Tridents won the toss and elected to bat');
  assert.equal(s.winnerName, null);
  assert.equal(s.notStarted, true);
});

test('classifyStatus: a toss line alongside a real result keeps the real winner', () => {
  const s = classifyStatus(
    'Barbados Tridents won the toss and elected to bat. Trinbago Knight Riders won by 5 wickets',
  );
  assert.equal(s.winnerName, 'Trinbago Knight Riders');
  assert.equal(s.notStarted, false);
});

test('classifyStatus: an in-progress match is notStarted for our purposes', () => {
  assert.equal(classifyStatus('Match not started').notStarted, true);
  assert.equal(classifyStatus('Innings break').notStarted, true);
});

test('classifyStatus: flags a tie', () => {
  assert.equal(classifyStatus('Match tied').tied, true);
});

// ---------------------------------------------------------------------------
// mapInningsToSides
// ---------------------------------------------------------------------------

test('mapInningsToSides: assigns by NAME, not array position', () => {
  // Away batted first (won the toss and chose to bat). A positional assumption
  // would swap both scorecards and mis-score everyone.
  const mapped = mapInningsToSides([inn(AWAY, 175, 5, '20'), inn(HOME, 176, 3, '19.1')], {
    homeTeam: HOME,
    awayTeam: AWAY,
    leagueCode: CPL,
  });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.home.runs, 176);
  assert.equal(mapped.away.runs, 175);
  assert.equal(mapped.firstBattingSide, 'away');
});

test('mapInningsToSides: array position still decides batting ORDER', () => {
  const mapped = mapInningsToSides([inn(HOME, 175, 5, '20'), inn(AWAY, 176, 3, '19.1')], {
    homeTeam: HOME,
    awayTeam: AWAY,
    leagueCode: CPL,
  });
  assert.equal(mapped.firstBattingSide, 'home');
});

test('mapInningsToSides: resolves a rebranded provider name through the alias map', () => {
  const mapped = mapInningsToSides(
    [inn('Barbados Royals', 180, 6, '20'), inn(AWAY, 181, 4, '19.2')],
    { homeTeam: HOME, awayTeam: AWAY, leagueCode: CPL },
  );
  assert.equal(mapped.ok, true);
  assert.equal(mapped.home.runs, 180);
});

test('mapInningsToSides: a Super Over picks the MAIN innings by ball count', () => {
  // Folding the Super Over's runs into the total would corrupt both runs legs.
  const mapped = mapInningsToSides(
    [
      inn(HOME, 160, 7, '20'),
      inn(AWAY, 160, 8, '20'),
      inn(HOME, 11, 1, '1'),
      inn(AWAY, 12, 0, '0.4'),
    ],
    { homeTeam: HOME, awayTeam: AWAY, leagueCode: CPL },
  );
  assert.equal(mapped.ok, true);
  assert.equal(mapped.home.runs, 160);
  assert.equal(mapped.away.runs, 160);
  assert.equal(mapped.extraInnings, true);
});

test('mapInningsToSides: a malformed both-names label resolves by elimination', () => {
  // Real CricAPI defect, observed on CPL 2026 match 3: the second innings is
  // labelled with BOTH sides concatenated, and the first is lowercased.
  const mapped = mapInningsToSides(
    [inn('barbados tridents', 187, 8, '20'), inn(`${HOME},${AWAY}`, 183, 7, '20')],
    { homeTeam: HOME, awayTeam: AWAY, leagueCode: CPL },
  );
  assert.equal(mapped.ok, true);
  assert.equal(mapped.home.runs, 187); // mapped cleanly by the lowercased label
  assert.equal(mapped.away.runs, 183); // deduced: a T20 side bats exactly once
  assert.match(mapped.note, /elimination/);
});

test('mapInningsToSides: elimination requires the label to MENTION the deduced side', () => {
  // A label naming neither side is a wrong-match signal, not a formatting quirk.
  const mapped = mapInningsToSides(
    [inn(HOME, 187, 8, '20'), inn('Somebody Else Entirely', 183, 7, '20')],
    { homeTeam: HOME, awayTeam: AWAY, leagueCode: CPL },
  );
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, 'unmapped-inning-team');
});

test('mapInningsToSides: elimination does NOT fire with more than two innings', () => {
  // Kept narrow on purpose — with a Super Over in play, "the other side" is no
  // longer determined by a single unassigned entry.
  const mapped = mapInningsToSides(
    [
      inn(HOME, 160, 7, '20'),
      inn(AWAY, 160, 8, '20'),
      inn(HOME, 11, 1, '1'),
      inn(`${HOME},${AWAY}`, 12, 0, '0.4'),
    ],
    { homeTeam: HOME, awayTeam: AWAY, leagueCode: CPL },
  );
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, 'unmapped-inning-team');
});

test('mapInningsToSides: elimination does NOT fire when both labels are malformed', () => {
  const both = `${HOME},${AWAY}`;
  const mapped = mapInningsToSides([inn(both, 187, 8, '20'), inn(both, 183, 7, '20')], {
    homeTeam: HOME,
    awayTeam: AWAY,
    leagueCode: CPL,
  });
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, 'unmapped-inning-team');
});

test('an eliminated mis-assignment would still be caught by the winner cross-check', () => {
  // Defence in depth: if elimination ever put the innings on the wrong side,
  // byRuns flips and disagrees with the status string, so the match refuses
  // rather than scoring backwards.
  const out = build(
    providerMatch({
      // Status says the AWAY side won, but the runs as mapped would say home.
      statusText: `${AWAY} won by 4 runs`,
      innings: [inn(HOME, 187, 8, '20'), inn(`${HOME},${AWAY}`, 183, 7, '20')],
    }),
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'winner-signals-disagree');
});

test('mapInningsToSides: an unmappable team name REFUSES rather than guessing', () => {
  const mapped = mapInningsToSides([inn('Some Other XI', 100, 5, '20'), inn(AWAY, 90, 8, '20')], {
    homeTeam: HOME,
    awayTeam: AWAY,
    leagueCode: CPL,
  });
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, 'unmapped-inning-team');
  assert.equal(mapped.detail, 'Some Other XI');
});

test('mapInningsToSides: an empty scorecard refuses', () => {
  const mapped = mapInningsToSides([], { homeTeam: HOME, awayTeam: AWAY, leagueCode: CPL });
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, 'no-innings');
});

test('mapInningsToSides: a one-sided scorecard refuses', () => {
  const mapped = mapInningsToSides([inn(HOME, 45, 2, '8')], {
    homeTeam: HOME,
    awayTeam: AWAY,
    leagueCode: CPL,
  });
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, 'one-sided-innings');
});

test('mapInningsToSides: a 7th ball in an over refuses instead of coercing', () => {
  // "17.6" is a typo for "18.0"; silently accepting it would shift the
  // proration denominator.
  const mapped = mapInningsToSides([inn(HOME, 150, 6, '17.6'), inn(AWAY, 151, 4, '19')], {
    homeTeam: HOME,
    awayTeam: AWAY,
    leagueCode: CPL,
  });
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, 'unparseable-overs');
});

test('mapInningsToSides: an innings longer than a T20 refuses', () => {
  const mapped = mapInningsToSides([inn(HOME, 300, 6, '50'), inn(AWAY, 280, 9, '50')], {
    homeTeam: HOME,
    awayTeam: AWAY,
    leagueCode: CPL,
  });
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, 'innings-longer-than-t20');
});

// ---------------------------------------------------------------------------
// deriveAllOut — the field that moves everyone's runs legs
// ---------------------------------------------------------------------------

const allOut = (o) => deriveAllOut({ side: 'home', maxBalls: 120, rainAffected: false, ...o });

test('deriveAllOut: ten wickets is always all out', () => {
  assert.deepEqual(allOut({ wickets: 10, balls: 95, isChase: false, runs: 120 }), { value: true });
});

test('deriveAllOut: a side that batted its full quota is not all out', () => {
  assert.deepEqual(allOut({ wickets: 9, balls: 120, isChase: false, runs: 170 }), { value: false });
});

test('deriveAllOut: a chase nine down and short of the target was dismissed', () => {
  assert.deepEqual(allOut({ wickets: 9, balls: 112, isChase: true, targetRuns: 161, runs: 148 }), {
    value: true,
  });
});

test('deriveAllOut: a chase nine down that reached the target is not all out', () => {
  assert.deepEqual(allOut({ wickets: 9, balls: 112, isChase: true, targetRuns: 148, runs: 148 }), {
    value: false,
  });
});

test('deriveAllOut: a FIRST innings nine down and short with no rain is AMBIGUOUS', () => {
  // Either bowled out at 9 with a batter absent, or a rain-truncated innings.
  // The payload cannot tell you, and guessing rewrites both runs legs.
  const out = allOut({ wickets: 9, balls: 102, isChase: false, runs: 120 });
  assert.equal(out.ambiguous, true);
  assert.equal(out.reason, 'allout-ambiguous');
});

test('deriveAllOut: the same innings with a rain marker resolves to not-all-out', () => {
  const out = deriveAllOut({
    side: 'home',
    wickets: 9,
    balls: 102,
    maxBalls: 102,
    isChase: false,
    runs: 120,
    rainAffected: true,
  });
  assert.deepEqual(out, { value: false });
});

test('deriveAllOut: fewer than nine wickets is never all out', () => {
  assert.deepEqual(allOut({ wickets: 8, balls: 90, isChase: false, runs: 130 }), { value: false });
});

// ---------------------------------------------------------------------------
// isRainShortened — the flag that voids both runs legs
// ---------------------------------------------------------------------------

const side = (balls, allOut = false) => ({ balls, allOut });

test('isRainShortened: a DLS match with a truncated innings is rain-shortened', () => {
  const out = isRainShortened({
    statusInfo: classifyStatus(`${AWAY} won by 4 wickets (D/L method)`),
    home: side(120),
    away: side(46),
  });
  assert.equal(out, true);
});

test('isRainShortened: a rain DELAY that still played full overs is NOT', () => {
  // Nothing was truncated, so normal scoring is correct — voiding here would
  // silently confiscate points from a match that played out in full.
  const out = isRainShortened({
    statusInfo: classifyStatus(`${AWAY} won by 4 wickets after a rain delay`),
    home: side(120),
    away: side(120),
  });
  assert.equal(out, false);
});

test('isRainShortened: an ordinary chase won with overs to spare is NOT', () => {
  // No weather marker. This is the run-rate market working as designed.
  const out = isRainShortened({
    statusInfo: classifyStatus(`${AWAY} won by 6 wickets`),
    home: side(120),
    away: side(90),
  });
  assert.equal(out, false);
});

test('isRainShortened: a side bowled out early does not count as truncated', () => {
  // Dismissal, not weather. Even with a rain marker in the status, an all-out
  // innings is a complete innings.
  const out = isRainShortened({
    statusInfo: classifyStatus(`${HOME} won by 30 runs after a rain delay`),
    home: side(120),
    away: side(90, true),
  });
  assert.equal(out, false);
});

test('isRainShortened: every DLS spelling triggers the marker', () => {
  for (const text of [
    `${AWAY} won by 3 wickets (D/L method)`,
    `${AWAY} won by 3 wickets (DLS Method)`,
    `${AWAY} won by 9 runs - 18 overs game due to rain`,
    `${AWAY} won by 3 wkts (2nd innings reduced to 8 overs due to rain, DLS target 52)`,
  ]) {
    assert.equal(
      isRainShortened({ statusInfo: classifyStatus(text), home: side(120), away: side(46) }),
      true,
      text,
    );
  }
});

test('buildCricketResultPayload: stamps rainAffected on a real DLS match', () => {
  // The real CPL 2026 M07 scorecard.
  const out = build(
    providerMatch({
      statusText: `${AWAY} won by 3 wkts (2nd innings reduced to 8 overs due to rain, DLS target 52)`,
      innings: [inn(HOME, 98, 9, '19'), inn(AWAY, 54, 7, '7.4')],
    }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.payload.rainAffected, true);
  assert.equal(cricketResultSchema.safeParse(out.payload).success, true);
});

test('buildCricketResultPayload: a dry match is not stamped rainAffected', () => {
  const out = build(
    providerMatch({
      statusText: `${AWAY} won by 6 wickets`,
      innings: [inn(HOME, 180, 6, '20'), inn(AWAY, 181, 4, '15')],
    }),
  );
  assert.equal(out.payload.rainAffected, false);
});

// ---------------------------------------------------------------------------
// deriveWinner — two signals that must agree
// ---------------------------------------------------------------------------

function winner({ homeRuns, awayRuns, statusText }) {
  return deriveWinner({
    home: { runs: homeRuns },
    away: { runs: awayRuns },
    statusInfo: classifyStatus(statusText),
    homeTeam: HOME,
    awayTeam: AWAY,
    leagueCode: CPL,
  });
}

test('deriveWinner: agreeing signals write', () => {
  const w = winner({ homeRuns: 180, awayRuns: 181, statusText: `${AWAY} won by 6 wickets` });
  assert.equal(w.ok, true);
  assert.equal(w.result, 'away');
  assert.equal(w.basis, 'agreed');
});

test('deriveWinner: under DLS the STATUS wins, even against the run totals', () => {
  // The scenario the whole two-signal design exists for: a rain-reduced chase
  // wins on a revised target with FEWER runs. Comparing totals hands the win to
  // the loser and inverts the 50-point winner leg for everyone.
  const w = winner({
    homeRuns: 180,
    awayRuns: 145,
    statusText: `${AWAY} won by 4 wickets (D/L method)`,
  });
  assert.equal(w.ok, true);
  assert.equal(w.result, 'away');
  assert.equal(w.basis, 'dls');
});

test('deriveWinner: a Super Over decides a match level on runs', () => {
  const w = winner({ homeRuns: 160, awayRuns: 160, statusText: `${HOME} won the Super Over` });
  assert.equal(w.ok, true);
  assert.equal(w.result, 'home');
  assert.equal(w.basis, 'super-over');
});

test('deriveWinner: a tie with no Super Over REFUSES', () => {
  // 'draw' is rejected for cricket, and null would void the match and strip
  // everyone's runs legs. Neither is right for a match that was decided.
  const w = winner({ homeRuns: 160, awayRuns: 160, statusText: 'Match tied' });
  assert.equal(w.ok, false);
  assert.equal(w.reason, 'tie-no-super-over');
});

test('deriveWinner: unexplained disagreement REFUSES', () => {
  const w = winner({ homeRuns: 180, awayRuns: 145, statusText: `${AWAY} won by 4 wickets` });
  assert.equal(w.ok, false);
  assert.equal(w.reason, 'winner-signals-disagree');
  assert.deepEqual(w.detail, { byRuns: 'home', byStatus: 'away' });
});

test('deriveWinner: an unresolvable winner name with clean totals writes, but warns', () => {
  // Nearly always a missing alias. Safe, because nothing about the totals is in
  // doubt — but worth surfacing so the alias gets added.
  const w = winner({ homeRuns: 180, awayRuns: 145, statusText: 'Some Other XI won by 35 runs' });
  assert.equal(w.ok, true);
  assert.equal(w.result, 'home');
  assert.equal(w.warn, 'winner-name-unresolved');
});

test('deriveWinner: an unresolvable winner name on a DLS match REFUSES', () => {
  // Exactly the case where the totals cannot be trusted as a fallback.
  const w = winner({
    homeRuns: 180,
    awayRuns: 145,
    statusText: 'Some Other XI won by 4 wickets (D/L method)',
  });
  assert.equal(w.ok, false);
  assert.equal(w.reason, 'dls-without-parsable-winner');
});

test('deriveWinner: level on runs with no signal at all REFUSES', () => {
  const w = winner({ homeRuns: 160, awayRuns: 160, statusText: '' });
  assert.equal(w.ok, false);
  assert.equal(w.reason, 'no-winner-signal');
});

// ---------------------------------------------------------------------------
// buildCricketResultPayload — end to end, and schema-conformant
// ---------------------------------------------------------------------------

test('buildCricketResultPayload: a clean chase produces a schema-valid payload', () => {
  const out = build(
    providerMatch({
      statusText: `${AWAY} won by 6 wickets`,
      innings: [inn(HOME, 180, 6, '20'), inn(AWAY, 181, 4, '19.2')],
    }),
  );
  assert.equal(out.ok, true);
  assert.deepEqual(out.payload, {
    result: 'away',
    home: { runs: 180, wickets: 6, overs: '20.0', allOut: false },
    away: { runs: 181, wickets: 4, overs: '19.2', allOut: false },
    rainAffected: false,
  });
  // The cross-module invariant: the automatic path is held to exactly the
  // rules the admin form obeys, so the two entry points cannot drift.
  assert.equal(cricketResultSchema.safeParse(out.payload).success, true);
});

test('buildCricketResultPayload: overs are re-emitted canonically whatever the provider sent', () => {
  const out = build(
    providerMatch({
      statusText: `${HOME} won by 30 runs`,
      innings: [inn(HOME, 180, 6, ' 20 '), inn(AWAY, 150, 8, '20')],
    }),
  );
  assert.equal(out.payload.home.overs, '20.0');
  assert.equal(cricketResultSchema.safeParse(out.payload).success, true);
});

test('buildCricketResultPayload: ten wickets produces allOut, satisfying the schema refine', () => {
  const out = build(
    providerMatch({
      statusText: `${HOME} won by 40 runs`,
      innings: [inn(HOME, 190, 5, '20'), inn(AWAY, 150, 10, '18.3')],
    }),
  );
  assert.equal(out.payload.away.allOut, true);
  assert.equal(cricketResultSchema.safeParse(out.payload).success, true);
});

test('buildCricketResultPayload: an unfinished match is skipped', () => {
  const out = build(providerMatch({ matchEnded: false, statusText: `${HOME} elected to bat` }));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'not-finished');
});

test('buildCricketResultPayload: an abandoned match voids with a zero scorecard', () => {
  const out = build(
    providerMatch({
      statusText: 'No result (abandoned due to rain)',
      innings: [inn(HOME, 45, 2, '8')],
    }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.payload.result, null);
  assert.equal(cricketResultSchema.safeParse(out.payload).success, true);
});

test('buildCricketResultPayload: an abandoned match with both innings keeps the real scores', () => {
  const out = build(
    providerMatch({
      statusText: 'No result',
      innings: [inn(HOME, 150, 6, '20'), inn(AWAY, 60, 2, '8')],
    }),
  );
  assert.equal(out.payload.result, null);
  assert.equal(out.payload.home.runs, 150);
  assert.equal(out.payload.away.runs, 60);
});

test('buildCricketResultPayload: never emits draw for cricket', () => {
  // Belt-and-braces on the invariant that cricketResultSchema and
  // GameService.bulkSetResult both enforce from the other side.
  for (const statusText of ['Match tied', `${AWAY} won by 5 wickets`, 'No result']) {
    const out = build(
      providerMatch({
        statusText,
        innings: [inn(HOME, 160, 6, '20'), inn(AWAY, 160, 6, '20')],
      }),
    );
    if (out.ok) assert.notEqual(out.payload.result, 'draw');
  }
});

test('buildCricketResultPayload: a full-quota innings nine down is not treated as all out', () => {
  // Regression guard for the over-quota inference: without asserting a 20-over
  // quota when there is no rain, a chase that finished early would "prove" a
  // shorter allocation and let this side read as having batted its full share.
  const out = build(
    providerMatch({
      statusText: `${AWAY} won by 5 wickets`,
      innings: [inn(HOME, 150, 9, '20'), inn(AWAY, 151, 5, '15')],
    }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.payload.home.allOut, false);
});
