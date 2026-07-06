// Trophy Cabinet — display mirror of lib/stages.js. Keep the label map + order
// in sync with the backend in the same commit (same rule as the
// lib/scoring.js ↔ src/utils/scoring.js scoring mirror). The server already
// orders + labels the cabinet's stages, so this is only used for defensive
// re-labelling + the medal → emoji map on the client.

export const WC_STAGE_ORDER = [
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

export function stageLabel(raw) {
  if (!raw) return 'Unknown Stage';
  if (STAGE_LABELS[raw]) return STAGE_LABELS[raw];
  return String(raw)
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const MEDAL_EMOJI = {
  gold: '🥇',
  silver: '🥈',
  bronze: '🥉',
};
