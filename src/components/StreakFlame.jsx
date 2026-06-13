// Shared win-streak flame chip (extracted from UserMenu, Tier 30 Phase 3 A1
// Revision). Rounded pill, warning-tint, brightens at the Streakmaster
// I/II/III thresholds (5 / 10 / 15) with `shadow-led` at the 15+ mastery
// tier. Consumers:
//   - UserMenu top-bar / dropdown — default `min={1}` (any active streak).
//   - LeaderboardCard rows — `min={3}` so the column only flags notable runs.

function streakChipClass(current) {
  if (current >= 15) return 'bg-warning/35 text-warning shadow-led';
  if (current >= 10) return 'bg-warning/25 text-warning';
  if (current >= 5) return 'bg-warning/15 text-warning';
  return 'bg-overlay text-fg-muted';
}

function StreakFlame({ current, min = 1 }) {
  if (!current || current < min) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${streakChipClass(
        current,
      )}`}
      aria-label={`${current}-game win streak`}
      title={`${current}-game win streak`}
    >
      <span aria-hidden="true">🔥</span>
      {current}
    </span>
  );
}

export default StreakFlame;
