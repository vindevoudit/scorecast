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

export function useCountdown(target) {
  const [label, setLabel] = useState(() => formatCountdown(target));
  useEffect(() => {
    setLabel(formatCountdown(target));
    const id = setInterval(() => setLabel(formatCountdown(target)), 30 * MS_PER_SECOND);
    return () => clearInterval(id);
  }, [target]);
  return label;
}
