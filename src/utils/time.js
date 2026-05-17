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

// Elapsed match minute, computed from kickoff and refined with the
// phase signals we *can* get from football-data.org free tier
// (halftime-reached flag + duration phase). The free tier doesn't expose
// `minute` directly, so this is still an estimate — but the signals
// catch the cases where pure kickoff-elapsed math goes worst-wrong:
//   - between minutes 46 and ~50 (we'd report 46-50 when the match is
//     actually in halftime, or vice versa)
//   - past minute 90 in cup matches (we'd keep counting into ET as 95',
//     96' instead of labelling "ET")
//
// Returns { label, minute } where:
//   - label is what to display ("67'", "HT", "ET", "PEN", "1'")
//   - minute is the underlying integer (or null for non-numeric labels)
export function matchMinute(kickoff, opts = {}, now = Date.now()) {
  const { halfTimeReached = false, phase = null } = opts;

  // Non-numeric phases short-circuit — display the phase tag, not a
  // potentially-misleading minute counter.
  if (phase === 'penalty-shootout') return { label: 'PEN', minute: null };
  if (phase === 'extra-time') return { label: 'ET', minute: null };

  const start = new Date(kickoff).getTime();
  const elapsedMs = now - start;
  if (elapsedMs < 0) return { label: null, minute: null };

  const rawElapsed = Math.floor(elapsedMs / MS_PER_MINUTE) + 1; // 1-indexed

  // Halftime window: a real PL/BSA match clocks 45 + ~15 min HT + 45.
  // We can't pinpoint HT exactly without an authoritative timer, but:
  //   - if we know halftime was reached (upstream set halfTime score)
  //     AND raw elapsed is still in 46..60: show "HT" — better than a
  //     mid-50s minute that doesn't exist in a football match
  //   - if halftime was NOT reached and raw elapsed > 45: cap display at
  //     45 (the match is either still in 1st half or in HT — either way
  //     "45'" is the safer claim)
  if (halfTimeReached && rawElapsed >= 46 && rawElapsed <= 60) {
    return { label: 'HT', minute: null };
  }
  if (!halfTimeReached && rawElapsed > 45) {
    return { label: "45'", minute: 45 };
  }

  // Post-HT: shift the second half down by ~15 mins to compensate for
  // the break the wall clock kept ticking through.
  let displayed = rawElapsed;
  if (halfTimeReached && rawElapsed > 60) {
    displayed = Math.max(46, rawElapsed - 15);
  }
  // Cap at 90 in regular time. ET should have flipped phase by then —
  // if it didn't, we're probably mid-stoppage so "90'+" is honest.
  if (displayed > 90) {
    return { label: "90'+", minute: 90 };
  }
  return { label: `${displayed}'`, minute: displayed };
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
