'use strict';

// CPL auto-results — every judgement call, as pure functions.
//
// No DB, no network, no clock beyond what callers pass in. That is deliberate:
// the hard parts of automating cricket results are all *derivations*, and
// keeping them here means they are exhaustively unit-testable the way
// lib/scoring.js is, rather than only reachable through a cron tick.
//
// THE GOVERNING RULE: REFUSE RATHER THAN GUESS.
// A wrong result silently moves every user's points — the winner leg is a flat
// +50 and `allOut` flips the 20-over proration in lib/scoring.js effectiveRuns,
// so a bad `allOut` rewrites both runs legs too. There is already a correct,
// working fallback (the admin form), so on every ambiguity these functions
// return a reason instead of a payload. A match that needs typing in is a minor
// annoyance; a match scored backwards is a leaderboard nobody trusts.

const { T20_BALLS, oversToBalls, ballsToOvers } = require('./sports');
const { isPlaceholderTeam } = require('./placeholderTeam');
const { canonicalTeamName, pairKey } = require('./cricketTeamNames');

// How far apart a local kickoff and a provider kickoff may be and still be the
// same match.
//
// MEASURED, NOT GUESSED. Against the live CPL 2026 payload (2026-08-10),
// CricAPI's `dateTimeGMT` runs a uniform **+4 h** ahead of our committed
// fixture times for most matches, and up to **20 h** away for the eight
// fixtures our schedule file records as a 20:00 local start (which rolls the
// UTC date forward while the provider keeps the original day). The first guess
// here was 14 h and it left those eight unresolvable.
//
// 24 h is the chosen value because the candidate set is ALREADY filtered to the
// exact unordered team pair, so the only thing a wider window can pull in is
// the same two sides meeting twice — and they are always weeks apart. Measured
// on the live payload: a 20 h window resolves all 35 non-playoff fixtures to
// exactly one candidate, with **zero** ambiguity, and it stays unambiguous out
// to 48 h. So 24 h sits in the middle of a very wide safe band rather than on
// the edge of one. Re-measure with scripts/cricket-provider-report.mjs if a
// future season's schedule shape changes.
const DEFAULT_RESOLVE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Status classification
// ---------------------------------------------------------------------------

const NOT_STARTED_RE = /match not started|innings break|in progress|yet to (begin|start)|stumps/i;
const NO_RESULT_RE = /no result|abandon|washed out|called off|cancell?ed|match postponed/i;
const TIED_RE = /\btied\b/i;
const SUPER_OVER_RE = /super over/i;
const DLS_RE = /d\/?l\b|dls|duckworth/i;
const TOSS_CLAUSE_RE = /\b\S.*?won the toss[^.]*/i;
const WINNER_RE = /^(.+?)\s+won\b/i;

/**
 * Read a provider status string.
 *
 * The string is the ONLY place a DLS or Super Over outcome is expressed, so it
 * cannot be ignored — but it is prose written for humans, so it is never
 * trusted alone either (see deriveWinner).
 */
function classifyStatus(statusText) {
  const text = String(statusText || '').trim();

  // Strip any toss clause before looking for a winner. "X won the toss and
  // elected to bat" would otherwise parse as "X won the match", which is the
  // single most dangerous misread available here. The clause stops at the
  // sentence boundary, so the orphaned separator has to come off too —
  // otherwise the winner regex captures ". Trinbago Knight Riders".
  const withoutToss = text
    .replace(TOSS_CLAUSE_RE, ' ')
    .replace(/^[\s.,;:-]+/, '')
    .trim();

  const noResult = NO_RESULT_RE.test(text);
  const winnerMatch = noResult ? null : WINNER_RE.exec(withoutToss);

  return {
    text,
    notStarted: NOT_STARTED_RE.test(text) || (/won the toss/i.test(text) && !winnerMatch),
    noResult,
    tied: TIED_RE.test(text),
    superOver: SUPER_OVER_RE.test(text),
    dls: DLS_RE.test(text),
    winnerName: winnerMatch ? winnerMatch[1].trim() : null,
  };
}

// ---------------------------------------------------------------------------
// Innings -> sides
// ---------------------------------------------------------------------------

/**
 * Assign the provider's innings to home and away, and work out who batted first.
 *
 * TWO USES OF POSITION, ONLY ONE OF THEM LEGITIMATE:
 *  - Deciding home vs away from array position is WRONG. Batting order is
 *    decided by the toss, so score[0] is not the home side; it is whoever won
 *    the toss and chose to bat, or whoever was sent in. Sides are assigned by
 *    NAME, and an unmappable name refuses outright.
 *  - Deciding batting order from array position is RIGHT. The scorecard is
 *    chronological, so the first entry is the first innings. That is what tells
 *    us who was chasing, which deriveAllOut needs.
 */
function mapInningsToSides(innings, { homeTeam, awayTeam, leagueCode }) {
  const list = Array.isArray(innings) ? innings : [];
  if (list.length === 0) return { ok: false, reason: 'no-innings' };

  const homeKey = canonicalTeamName(homeTeam, leagueCode);
  const awayKey = canonicalTeamName(awayTeam, leagueCode);
  if (!homeKey || !awayKey || homeKey === awayKey) {
    return { ok: false, reason: 'unusable-local-team-names' };
  }

  const buckets = { home: [], away: [] };
  const unassigned = [];
  let note = null;

  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    const balls = oversToBalls(entry.oversText);
    if (balls == null) {
      return { ok: false, reason: 'unparseable-overs', detail: entry.oversText };
    }
    const key = canonicalTeamName(entry.teamName, leagueCode);
    const side = key === homeKey ? 'home' : key === awayKey ? 'away' : null;
    if (side) buckets[side].push({ ...entry, balls, index: i });
    else unassigned.push({ ...entry, balls, index: i, key });
  }

  // CricAPI emits a malformed innings label on a minority of matches: instead of
  // "<Team> Inning 1" it concatenates BOTH sides, e.g.
  // "Antigua and Barbuda Falcons,Saint Lucia Kings Inning 1" (observed on 2 of
  // the first 9 CPL 2026 matches). Refusing outright would push a fifth of the
  // season back to manual entry.
  //
  // Elimination is sound here, and is deduction rather than a guess: a T20 side
  // bats exactly once, so with exactly two innings, one of them cleanly mapped,
  // the remaining innings necessarily belongs to the other side. Two extra
  // conditions keep it honest — the malformed label must actually MENTION the
  // side being assigned (whole-token, so it is corroboration rather than blind
  // fallback), and the mapped side must own exactly one innings. Anything else
  // still refuses. A mis-assignment would also be caught downstream, since
  // swapping the innings flips `byRuns` and deriveWinner refuses on unexplained
  // disagreement with the status string.
  if (unassigned.length === 1 && list.length === 2) {
    const target = buckets.home.length === 1 && buckets.away.length === 0 ? 'away' : 'home';
    const filled = target === 'away' ? buckets.home.length : buckets.away.length;
    const targetKey = target === 'home' ? homeKey : awayKey;
    const label = ` ${unassigned[0].key} `;
    if (filled === 1 && label.includes(` ${targetKey} `)) {
      buckets[target].push(unassigned[0]);
      note = `malformed-inning-label-resolved-by-elimination: "${unassigned[0].teamName}"`;
      unassigned.length = 0;
    }
  }

  if (unassigned.length > 0) {
    // Almost always a missing alias. Naming the string is what lets the
    // operator fix it in one edit.
    return { ok: false, reason: 'unmapped-inning-team', detail: unassigned[0].teamName };
  }

  if (buckets.home.length === 0 || buckets.away.length === 0) {
    return { ok: false, reason: 'one-sided-innings' };
  }

  // A Super Over appears as an extra one-over entry for each side. Taking the
  // larger ball count picks the main innings every time (a Super Over is 6
  // balls; a main innings that short would be a washout with no result). Adding
  // Super Over runs into the total instead would corrupt the runs legs for
  // every user on the match.
  const pickMain = (entries) => entries.reduce((best, e) => (e.balls > best.balls ? e : best));
  const home = pickMain(buckets.home);
  const away = pickMain(buckets.away);
  const extraInnings = list.length > 2;

  if (home.balls > T20_BALLS || away.balls > T20_BALLS) {
    return { ok: false, reason: 'innings-longer-than-t20' };
  }

  return {
    ok: true,
    home,
    away,
    extraInnings,
    note,
    // Chronological, not positional-as-home/away. See the note above.
    firstBattingSide: home.index < away.index ? 'home' : 'away',
  };
}

// ---------------------------------------------------------------------------
// allOut
// ---------------------------------------------------------------------------

/**
 * Was this side bowled out?
 *
 * This matters more than it looks: lib/scoring.js effectiveRuns prorates a
 * short innings to a 20-over equivalent UNLESS the side was all out, so getting
 * it wrong rewrites both runs legs for everyone who picked the match.
 *
 * Returns { value: boolean } or { ambiguous: true, reason } — the caller
 * refuses the whole match on ambiguity.
 */
function deriveAllOut({ side, wickets, balls, maxBalls, isChase, targetRuns, runs, rainAffected }) {
  if (wickets >= 10) return { value: true };

  const battedFullQuota = balls >= maxBalls;
  if (wickets < 9 || battedFullQuota) return { value: false };

  // Nine down, short of the quota. Two readings, and which one applies is
  // decidable only in the chase.
  if (isChase) {
    // Finished below the target with balls to spare: the innings ended because
    // the side was dismissed, and it read as 9 because a batter was absent hurt
    // or retired out. Unambiguous.
    if (Number.isFinite(targetRuns) && runs < targetRuns) return { value: true };
    return { value: false };
  }

  // First innings, nine down, short of the quota. Either bowled out at 9 with a
  // batter unavailable, or a rain-truncated innings — and the provider payload
  // cannot tell you which. A rain marker in the status makes it the latter;
  // otherwise refuse. (match_scorecard's batting card would settle this via
  // "absent hurt", at +1 API hit per match. Escalate to it only if this fires
  // more than once a season.)
  if (rainAffected) return { value: false };
  return {
    ambiguous: true,
    reason: 'allout-ambiguous',
    detail: `${side} innings ended 9 down after ${balls} of ${maxBalls} balls with no rain marker`,
  };
}

// ---------------------------------------------------------------------------
// Winner
// ---------------------------------------------------------------------------

/**
 * Decide the winner from two independent signals, and require them to agree.
 *
 * WHY RUN TOTALS ALONE ARE NOT ENOUGH: under DLS the chasing side wins by
 * passing a *revised* target, so it can finish with fewer runs than the side
 * that batted first. Caribbean rain in August makes that a live scenario, and
 * comparing totals would hand the win to the loser — inverting the 50-point
 * winner leg for everyone.
 *
 * WHY THE STATUS STRING ALONE IS NOT ENOUGH: it is prose, and the team name in
 * it has to survive alias reconciliation to be usable at all.
 *
 * So: derive both ways, write only when they agree, and let the string win in
 * exactly the two cases where arithmetic provably cannot answer.
 */
function deriveWinner({ home, away, statusInfo, homeTeam, awayTeam, leagueCode }) {
  const byRuns = home.runs > away.runs ? 'home' : away.runs > home.runs ? 'away' : null;

  let byStatus = null;
  if (statusInfo.winnerName) {
    const key = canonicalTeamName(statusInfo.winnerName, leagueCode);
    if (key && key === canonicalTeamName(homeTeam, leagueCode)) byStatus = 'home';
    else if (key && key === canonicalTeamName(awayTeam, leagueCode)) byStatus = 'away';
  }

  const explained = statusInfo.dls || statusInfo.superOver;

  if (byRuns && byStatus) {
    if (byRuns === byStatus) return { ok: true, result: byRuns, basis: 'agreed' };
    if (explained) {
      // The status is authoritative here by construction: a DLS chase or a
      // Super Over is precisely the case where the main-innings totals do not
      // determine the winner.
      return { ok: true, result: byStatus, basis: statusInfo.dls ? 'dls' : 'super-over' };
    }
    return { ok: false, reason: 'winner-signals-disagree', detail: { byRuns, byStatus } };
  }

  // Level on runs. A winner still exists if a Super Over settled it.
  if (!byRuns && byStatus) return { ok: true, result: byStatus, basis: 'super-over' };

  if (byRuns && !byStatus) {
    if (explained) {
      // A DLS match whose winner name we could not resolve is exactly the case
      // where run totals are untrustworthy. Refuse.
      return { ok: false, reason: 'dls-without-parsable-winner' };
    }
    // Clean totals, unparsable name — nearly always a missing alias. Safe to
    // write, but worth surfacing so the alias gets added.
    return { ok: true, result: byRuns, basis: 'runs-only', warn: 'winner-name-unresolved' };
  }

  // Level on runs with no Super Over. 'draw' is rejected for cricket by
  // cricketResultSchema and by GameService.bulkSetResult, and null would void
  // the match and strip everyone's runs legs — neither is right for a tie that
  // was actually decided. Let a human decide.
  if (statusInfo.tied) return { ok: false, reason: 'tie-no-super-over' };

  return { ok: false, reason: 'no-winner-signal' };
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

const EMPTY_INNINGS = { runs: 0, wickets: 0, overs: '0.0', allOut: false };

function inningsPayload(entry, allOut) {
  return {
    runs: entry.runs,
    wickets: entry.wickets,
    // Re-emit from the parsed ball count rather than echoing the provider's
    // text, so the value always satisfies cricketResultSchema's overs regex
    // regardless of how the provider formatted it ("20", "20.0", " 19.2 ").
    overs: ballsToOvers(entry.balls),
    allOut,
  };
}

/**
 * Turn a provider match into the exact payload the admin form would have
 * produced, or a reason why it cannot be produced.
 *
 * @returns {{ok: true, payload: object, notes: object} | {ok: false, reason: string, detail?: any}}
 */
function buildCricketResultPayload(game, providerMatch, { leagueCode } = {}) {
  const statusInfo = classifyStatus(providerMatch?.statusText);

  if (!providerMatch?.matchEnded || statusInfo.notStarted) {
    return { ok: false, reason: 'not-finished' };
  }

  const mapped = mapInningsToSides(providerMatch.innings, {
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    leagueCode,
  });

  // Abandoned matches are the one case where a missing or one-sided scorecard
  // is expected rather than a defect. cricketResultSchema still requires both
  // innings objects, so a side that never batted is recorded as 0/0 — inert,
  // because scorePick returns 0 on a null result and effectiveRuns is never
  // consulted.
  if (statusInfo.noResult) {
    const payload = mapped.ok
      ? {
          result: null,
          home: inningsPayload(mapped.home, mapped.home.wickets >= 10),
          away: inningsPayload(mapped.away, mapped.away.wickets >= 10),
        }
      : { result: null, home: { ...EMPTY_INNINGS }, away: { ...EMPTY_INNINGS } };
    return { ok: true, payload, notes: { basis: 'no-result', status: statusInfo.text } };
  }

  if (!mapped.ok) return { ok: false, reason: mapped.reason, detail: mapped.detail };

  const { home, away, firstBattingSide } = mapped;

  const winner = deriveWinner({
    home,
    away,
    statusInfo,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    leagueCode,
  });
  if (!winner.ok) return { ok: false, reason: winner.reason, detail: winner.detail };

  const firstRuns = firstBattingSide === 'home' ? home.runs : away.runs;
  const rainAffected = statusInfo.dls || /rain|weather|wet|reduced/i.test(statusInfo.text);

  // The over quota each side was allotted. Without a weather marker it is a
  // full T20 by definition, and asserting that is important: inferring it from
  // the longest innings is circular when BOTH innings ended early (a chase that
  // finishes in 15 overs would "prove" a 15-over quota), which would let a side
  // that was genuinely bowled out at 9 read as having batted its full
  // allocation. With a weather marker the real quota is unknowable from this
  // payload, so the longest innings is the best available floor — and the
  // ambiguous branch below is short-circuited by rainAffected anyway.
  const maxBalls = rainAffected ? Math.min(T20_BALLS, Math.max(home.balls, away.balls)) : T20_BALLS;

  const allOutFor = (side, entry) =>
    deriveAllOut({
      side,
      wickets: entry.wickets,
      balls: entry.balls,
      maxBalls,
      isChase: side !== firstBattingSide,
      targetRuns: firstRuns + 1,
      runs: entry.runs,
      rainAffected,
    });

  const homeAllOut = allOutFor('home', home);
  const awayAllOut = allOutFor('away', away);
  if (homeAllOut.ambiguous)
    return { ok: false, reason: homeAllOut.reason, detail: homeAllOut.detail };
  if (awayAllOut.ambiguous)
    return { ok: false, reason: awayAllOut.reason, detail: awayAllOut.detail };

  return {
    ok: true,
    payload: {
      result: winner.result,
      home: inningsPayload(home, homeAllOut.value),
      away: inningsPayload(away, awayAllOut.value),
    },
    notes: {
      basis: winner.basis,
      warn: winner.warn || null,
      mapping: mapped.note || null,
      firstBattingSide,
      maxBalls,
      extraInnings: mapped.extraInnings,
      status: statusInfo.text,
    },
  };
}

// ---------------------------------------------------------------------------
// Match resolution
// ---------------------------------------------------------------------------

/**
 * Join local games onto provider matches.
 *
 * Local fixtures come from a committed file, so `sourceId` is synthetic and the
 * provider has never seen it. The join is therefore (kickoff window + the
 * unordered team pair), and it is deliberately all-or-nothing: exactly one
 * unclaimed candidate stamps, and everything else refuses with a reason. A
 * wrong stamp would attach another match's scorecard to the game, so the cost
 * of guessing is far higher than the cost of one manual entry.
 */
function resolveMatches(localGames, providerMatches, options = {}) {
  const { leagueCode, windowMs = DEFAULT_RESOLVE_WINDOW_MS, now = Date.now() } = options;
  const resolved = [];
  const unresolved = [];

  const claimed = new Set(
    (localGames || [])
      .map((g) => g.providerMatchId)
      .filter(Boolean)
      .map(String),
  );

  const candidatePool = (providerMatches || []).filter(
    (m) => m.providerMatchId && (!m.matchType || m.matchType === 't20'),
  );

  for (const game of localGames || []) {
    if (game.providerMatchId) continue;

    // Playoff slots. Even if the date alone identified the match, the local row
    // says "Winner of Qualifier 1", which makes the innings-to-side mapping
    // impossible — so resolving it would buy nothing. A human has to rename the
    // row once seeding is known.
    if (isPlaceholderTeam(game.homeTeam) || isPlaceholderTeam(game.awayTeam)) {
      unresolved.push({
        gameId: game.id,
        sourceId: game.sourceId,
        reason: 'placeholder-teams',
        kickoff: game.date,
        stage: game.stage || null,
        daysAway: Math.round((new Date(game.date).getTime() - now) / 86_400_000),
      });
      continue;
    }

    const localKey = pairKey(game.homeTeam, game.awayTeam, leagueCode);
    const kickoff = new Date(game.date).getTime();

    const candidates = candidatePool.filter((m) => {
      if (claimed.has(String(m.providerMatchId))) return false;
      const when = m.dateTimeGMT ? new Date(m.dateTimeGMT).getTime() : NaN;
      if (!Number.isFinite(when) || Math.abs(when - kickoff) > windowMs) return false;
      return pairKey(m.teams?.[0], m.teams?.[1], leagueCode) === localKey;
    });

    if (candidates.length === 1) {
      const match = candidates[0];
      claimed.add(String(match.providerMatchId));
      resolved.push({
        gameId: game.id,
        sourceId: game.sourceId,
        providerMatchId: String(match.providerMatchId),
      });
      continue;
    }

    unresolved.push({
      gameId: game.id,
      sourceId: game.sourceId,
      reason: candidates.length === 0 ? 'no-candidate' : 'ambiguous',
      kickoff: game.date,
      localHome: game.homeTeam,
      localAway: game.awayTeam,
      candidateCount: candidates.length,
    });
  }

  return { resolved, unresolved };
}

module.exports = {
  DEFAULT_RESOLVE_WINDOW_MS,
  classifyStatus,
  mapInningsToSides,
  deriveAllOut,
  deriveWinner,
  buildCricketResultPayload,
  resolveMatches,
};
