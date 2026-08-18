'use strict';

// CPL auto-results — reconciling cricket-provider team names against the
// canonical names in the committed fixture file.
//
// Two data sources that were never coordinated have to agree on what a team is
// called. Same class of problem as the football-data.org <-> martj42 mismatches
// that seeders/reconcileMap.json solves, and this follows that precedent:
// a committed JSON map plus a normaliser.
//
// THE NORMALISER DOES THE BULK OF THE WORK. Folding case, accents, punctuation,
// '&' <-> 'and' and 'St' <-> 'Saint' collapses the overwhelming majority of
// cosmetic differences, which keeps data/cricket-team-aliases.json to genuine
// rebrands only. That matters because the alias file is committed — every entry
// costs a redeploy, so the fewer that are needed, the better.
//
// LOOKUP IS PERMISSIVE ON PURPOSE. An unknown name canonicalises to itself
// rather than throwing. This code runs inside a cron tick, where the football
// jobs' convention is to skip and log, never to throw; and the caller
// (lib/cricketResult.js) already refuses to write when a name fails to match a
// side, so a miss degrades to "this match needs manual entry", not to bad data.

const logger = require('./logger');

let aliasMap = {};
try {
  // Relative, not path.join(__dirname, ...), so bundlers and lint see a static
  // specifier. The Dockerfile COPYs `data/` alongside `lib/`, so this resolves
  // identically in the runtime image.
  aliasMap = require('../data/cricket-team-aliases.json');
} catch (err) {
  // A missing or malformed alias file must not take the process down — every
  // name then canonicalises to itself, which is exactly the behaviour for a
  // league with no rebrands.
  logger.warn({ err }, 'cricketTeamNames: alias file unreadable — using identity mapping');
  aliasMap = {};
}

/**
 * Fold a team name to a comparable key.
 *
 * "St Kitts & Nevis Patriots" -> "saint kitts and nevis patriots"
 * "Antigua and Barbuda Falcons" -> "antigua and barbuda falcons"
 *
 * Order matters: '&' must expand before punctuation is stripped (otherwise it
 * vanishes and "A & B" collapses to "ab"), and the St -> Saint expansion must
 * run after punctuation is stripped so that "St." is caught alongside "St".
 */
function normalizeTeamName(name) {
  if (name == null) return '';
  return (
    String(name)
      .normalize('NFKD')
      // Unicode property escape rather than a literal combining-mark range, so
      // this line stays pure ASCII in source and survives any editor or pipe
      // that mangles combining characters.
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\s]/g, ' ') // punctuation -> space, never elided
      .replace(/\bst\b/g, 'saint')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function aliasesFor(leagueCode) {
  const block = leagueCode ? aliasMap[leagueCode] : null;
  return (block && block.aliases) || {};
}

/**
 * Fold a name onto the canonical fixture-file name, as a normalised key.
 *
 * Returns a NORMALISED string on both the hit and the miss path, so callers can
 * always compare two canonicalTeamName() results with ===.
 */
function canonicalTeamName(name, leagueCode) {
  const normalized = normalizeTeamName(name);
  if (!normalized) return '';
  const canonical = aliasesFor(leagueCode)[normalized];
  return canonical ? normalizeTeamName(canonical) : normalized;
}

function teamsMatch(a, b, leagueCode) {
  const left = canonicalTeamName(a, leagueCode);
  const right = canonicalTeamName(b, leagueCode);
  return Boolean(left) && left === right;
}

/**
 * Order-free key for a fixture's two sides.
 *
 * Sorting before joining is what makes this work as a join key at all: the
 * provider's home/away designation for a neutral-ish Caribbean fixture need not
 * agree with ours, and for resolution we only care *which two teams* are
 * playing. The home/away assignment is settled separately, by name, in
 * lib/cricketResult.js mapInningsToSides.
 */
function pairKey(a, b, leagueCode) {
  const left = canonicalTeamName(a, leagueCode);
  const right = canonicalTeamName(b, leagueCode);
  if (!left || !right) return null;
  return [left, right].sort().join('|');
}

module.exports = {
  normalizeTeamName,
  canonicalTeamName,
  teamsMatch,
  pairKey,
};
