'use strict';

// Backend mirror of src/utils/teamNames.js `isPlaceholderTeam`. Kept as a
// separate CJS module because the frontend copy is ESM under src/ and can't
// be required from the Node backend.
//
// Football-data.org returns placeholder team strings for knockout-stage
// fixtures whose participants haven't advanced yet — literal "TBD" (the
// fallback in lib/footballApi.js `homeTeam?.name || 'TBD'`) plus the upstream
// "Winner of QF1" / "Loser of SF2" / "Group A 1st" patterns that show up
// during the 2026 World Cup sync.
//
// Two places (keep in sync in the same commit): this file +
// src/utils/teamNames.js PLACEHOLDER_PATTERN.
const PLACEHOLDER_PATTERN = /^(tbd|winner|loser|group\s|placeholder|runner-up)/i;

function isPlaceholderTeam(name) {
  if (!name) return true;
  return PLACEHOLDER_PATTERN.test(String(name).trim());
}

module.exports = { isPlaceholderTeam, PLACEHOLDER_PATTERN };
