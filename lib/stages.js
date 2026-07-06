'use strict';

// Trophy Cabinet — shared tournament-stage vocabulary. Mirrored on the
// frontend in src/utils/stages.js (labels + order); keep the two in sync in
// the same commit, same rule as the lib/scoring.js ↔ src/utils/scoring.js
// scoring mirror.
//
// The tokens are football-data.org's `stage` values as stored on games.stage
// (see lib/footballApi.js normalizeFixture). WC_STAGE_ORDER is the canonical
// display + segmentation order for the World Cup; LAST_32 is the 48-team
// format's Round of 32 (verify against a live sync before launch — the label
// map falls back gracefully for any unexpected token).

const WC_STAGE_ORDER = [
  'GROUP_STAGE',
  'LAST_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
];

const STAGE_LABELS = {
  GROUP_STAGE: 'Group Stage',
  LAST_32: 'Round of 32',
  LAST_16: 'Round of 16',
  QUARTER_FINALS: 'Quarter Finals',
  SEMI_FINALS: 'Semi Finals',
  THIRD_PLACE: 'Third Place',
  FINAL: 'Final',
};

// Title-case fallback for any unmapped upstream token so an unexpected stage
// (e.g. PRELIMINARY_ROUND) still renders sanely instead of a raw SCREAMING
// enum string.
function stageLabel(raw) {
  if (!raw) return 'Unknown Stage';
  if (STAGE_LABELS[raw]) return STAGE_LABELS[raw];
  return String(raw)
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Podium medal for a 1-based overall rank. Feeds the cabinet's medal showcase.
function medalFor(rank) {
  if (rank === 1) return 'gold';
  if (rank === 2) return 'silver';
  if (rank === 3) return 'bronze';
  return null;
}

module.exports = { WC_STAGE_ORDER, STAGE_LABELS, stageLabel, medalFor };
