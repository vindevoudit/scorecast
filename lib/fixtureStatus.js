'use strict';

// Tier 4b Chunk 2 — shared upstream-status helpers. Extracted from
// LeagueService so the live-score job (lib/jobs/syncLiveScores.js +
// GameService.applyLiveUpdate) and the fixture upsert path agree on
// status mapping + result derivation.
//
// Status vocabulary comes from football-data.org v4. If we ever swap
// providers, only normalizeFixture() in lib/footballApi.js and this map
// need to change.

const STATUS_MAP = {
  SCHEDULED: 'scheduled',
  TIMED: 'scheduled',
  LIVE: 'in-progress',
  IN_PLAY: 'in-progress',
  PAUSED: 'in-progress',
  EXTRA_TIME: 'in-progress',
  PENALTY_SHOOTOUT: 'in-progress',
  FINISHED: 'finished',
  AWARDED: 'finished',
  POSTPONED: 'postponed',
  SUSPENDED: 'in-progress',
  CANCELLED: 'cancelled',
};

function mapUpstreamStatus(raw) {
  return STATUS_MAP[raw] || 'scheduled';
}

function deriveResultFromFixture(fixture, localStatus) {
  if (localStatus !== 'finished') return null;
  // Prefer upstream's authoritative `winner` field — handles knockout
  // matches decided on penalties (where fullTime is a draw but a winner
  // exists) without us having to reach into the `penalties` block.
  if (fixture.winner === 'HOME_TEAM') return 'home';
  if (fixture.winner === 'AWAY_TEAM') return 'away';
  if (fixture.winner === 'DRAW') return null;
  // Fallback: compare full-time scores when upstream doesn't expose a
  // winner field (older endpoint payloads or partial data).
  if (fixture.homeScore === null || fixture.awayScore === null) return null;
  if (fixture.homeScore > fixture.awayScore) return 'home';
  if (fixture.awayScore > fixture.homeScore) return 'away';
  return null; // draws stay unscored in the existing 'home'|'away' enum
}

module.exports = { mapUpstreamStatus, deriveResultFromFixture, STATUS_MAP };
