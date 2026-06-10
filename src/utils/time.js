import { useEffect, useState } from 'react';

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function formatCountdown(target) {
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return 'Locked';
  const days = Math.floor(ms / MS_PER_DAY);
  const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function timeAgo(target) {
  const ms = Date.now() - new Date(target).getTime();
  if (ms < MS_PER_MINUTE) return 'just now';
  if (ms < MS_PER_HOUR) return `${Math.floor(ms / MS_PER_MINUTE)}m ago`;
  if (ms < MS_PER_DAY) return `${Math.floor(ms / MS_PER_HOUR)}h ago`;
  const days = Math.floor(ms / MS_PER_DAY);
  if (days < 7) return `${days}d ago`;
  return new Date(target).toLocaleDateString();
}

export function useCountdown(target) {
  const [label, setLabel] = useState(() => formatCountdown(target));
  useEffect(() => {
    setLabel(formatCountdown(target));
    const id = setInterval(() => setLabel(formatCountdown(target)), 30 * MS_PER_SECOND);
    return () => clearInterval(id);
  }, [target]);
  return label;
}

// Match phase label, NOT a minute counter. football-data.org's plan doesn't
// expose `minute`, so the old kickoff-elapsed estimate drifted out of sync and
// showed minutes that didn't match reality. Instead we display the coarse
// phase, which leans on the signals we *can* trust:
//   - `phase` ('extra-time' / 'penalty-shootout') from upstream score.duration
//   - `halfTimeReached` flag (set when upstream writes the HT score)
// Only the half-time break still consults the wall clock, and that uses a
// deliberately loose 46-60 window so a few minutes of sync drift never
// mislabels it.
//
// Returns { label, minute } where:
//   - label is what to display ("First half", "Half time", "Second half",
//     "Extra time", "Penalties") or null before kickoff
//   - minute is kept for return-shape stability and is always null now
export function matchMinute(kickoff, opts = {}, now = Date.now()) {
  const { halfTimeReached = false, phase = null } = opts;

  // Reliable upstream phase signals win first — they never drift.
  if (phase === 'penalty-shootout') return { label: 'Penalties', minute: null };
  if (phase === 'extra-time') return { label: 'Extra time', minute: null };

  const start = new Date(kickoff).getTime();
  const elapsedMs = now - start;
  if (elapsedMs < 0) return { label: null, minute: null };

  const rawElapsed = Math.floor(elapsedMs / MS_PER_MINUTE) + 1; // 1-indexed

  // Half-time break: upstream confirmed the HT score AND the wall clock still
  // sits inside the generous 46-60 break window. Coarse on purpose so a few
  // minutes of sync drift never mislabels it. This is the only remaining
  // time-based check.
  if (halfTimeReached && rawElapsed >= 46 && rawElapsed <= 60) {
    return { label: 'Half time', minute: null };
  }
  // Past the break window once halftime was reached → second half. Before the
  // flag arrives we stay on "First half" regardless of elapsed (if sync lags,
  // briefly reading "First half" into the early second half is bounded by the
  // sync cadence and far less wrong than a bogus minute).
  if (halfTimeReached) return { label: 'Second half', minute: null };
  return { label: 'First half', minute: null };
}

export function useMatchMinute(kickoff, isLive, opts = {}) {
  // Spread opts into deps so a halftime/phase transition re-renders
  // without waiting for the 30s tick.
  const { halfTimeReached = false, phase = null } = opts;
  const [value, setValue] = useState(() => matchMinute(kickoff, { halfTimeReached, phase }));
  useEffect(() => {
    if (!isLive) return undefined;
    setValue(matchMinute(kickoff, { halfTimeReached, phase }));
    const id = setInterval(
      () => setValue(matchMinute(kickoff, { halfTimeReached, phase })),
      30 * MS_PER_SECOND,
    );
    return () => clearInterval(id);
  }, [kickoff, isLive, halfTimeReached, phase]);
  return value;
}
