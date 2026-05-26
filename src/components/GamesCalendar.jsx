'use strict';

// Tier 18 Chunk 3 — fixed 7-cell calendar viewer.
// Renders a 7-day window (today − 3 → today + 3 by default) as equally
// sized chips with prev/next arrow buttons at the ends. Arrows page the
// window by ±7 days at a time; chips stay equal-width — no horizontal
// scroll. Tap a chip to filter the list to that day's games. URL-synced
// via `?date=YYYY-MM-DD` so shared/refreshed links land on the same
// day; if the URL date sits outside the default centered-on-today
// window, the window pre-shifts so the selected chip is visible.
//
// Live games can only be on today's date, so we don't surface them
// in a separate bucket; the chip for today carries a pulsing red dot
// when any game is in-progress, and a "Live now →" pill at the top
// jumps the selection back to today regardless of window position.

import { useEffect, useMemo, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import GameCard from './GameCard';
import EmptyState from './EmptyState';
import { dayKey } from '../hooks/useGames';

const WINDOW_DAYS = 7;
const HALF_WINDOW = (WINDOW_DAYS - 1) / 2; // 3

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function diffInDays(from, to) {
  const a = startOfDay(from).getTime();
  const b = startOfDay(to).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function isToday(d) {
  return diffInDays(new Date(), d) === 0;
}

function chipLabels(d) {
  const weekday = d.toLocaleDateString([], { weekday: 'short' });
  const dayNum = d.toLocaleDateString([], { day: 'numeric' });
  return { weekday, dayNum };
}

function fullDayLabel(d) {
  if (isToday(d)) return 'Today';
  const t = startOfDay(new Date());
  const tomorrow = addDays(t, 1);
  if (startOfDay(d).getTime() === tomorrow.getTime()) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function readDateFromUrl() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('date');
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return raw;
}

function writeDateToUrl(key) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const todayKey = dayKey(new Date());
  if (key === todayKey) {
    params.delete('date');
  } else {
    params.set('date', key);
  }
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', next);
}

// Snap a target day-offset (relative to today) to the nearest 7-day
// window. Window N covers days [N*7 - 3, N*7 + 3] relative to today;
// window 0 is today − 3 → today + 3. `Math.round(offset/7)` lands the
// target within ±3 days of the window's center.
function windowIndexForOffset(offsetDays) {
  return Math.round(offsetDays / WINDOW_DAYS);
}

function ArrowButton({ direction, onClick, label }) {
  const isPrev = direction === 'prev';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex shrink-0 items-center justify-center self-stretch rounded-2xl border border-default bg-overlay/40 px-2 text-fg-muted transition duration-200 hover:border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d={isPrev ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'} />
      </svg>
    </button>
  );
}

function GamesCalendar({ byDay }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const todayKey = dayKey(today);

  const [selectedKey, setSelectedKey] = useState(() => readDateFromUrl() || todayKey);

  // Window offset in 7-day chunks. 0 = today − 3 → today + 3. ±1 = next
  // / previous block of 7 days. Initial value snaps to whichever window
  // contains the selected date so the chip is visible on first paint.
  const [windowIndex, setWindowIndex] = useState(() => {
    const initialKey = readDateFromUrl() || todayKey;
    const initialDate = new Date(`${initialKey}T00:00:00`);
    if (Number.isNaN(initialDate.getTime())) return 0;
    return windowIndexForOffset(diffInDays(today, initialDate));
  });

  const [listRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });

  // The 7 days currently displayed. Window center = today + windowIndex*7.
  const days = useMemo(() => {
    const center = addDays(today, windowIndex * WINDOW_DAYS);
    const out = [];
    for (let i = -HALF_WINDOW; i <= HALF_WINDOW; i += 1) {
      const d = addDays(center, i);
      out.push({ date: d, key: dayKey(d) });
    }
    return out;
  }, [today, windowIndex]);

  // Per-day count + live indicator for the chips.
  const dayMeta = useMemo(() => {
    const meta = new Map();
    for (const day of days) {
      const list = byDay.get(day.key) || [];
      meta.set(day.key, {
        count: list.length,
        hasLive: list.some((g) => g.status === 'in-progress'),
      });
    }
    return meta;
  }, [days, byDay]);

  // Live indicator on the top-bar pill — independent of window. Checks
  // every game for today regardless of whether today's chip is visible.
  const liveToday = useMemo(() => {
    const list = byDay.get(todayKey) || [];
    return list.some((g) => g.status === 'in-progress');
  }, [byDay, todayKey]);

  const selectedGames = useMemo(() => {
    const list = byDay.get(selectedKey) || [];
    return [...list].sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [byDay, selectedKey]);

  useEffect(() => {
    writeDateToUrl(selectedKey);
  }, [selectedKey]);

  const selectedDateObj = useMemo(() => new Date(`${selectedKey}T00:00:00`), [selectedKey]);

  const goToToday = () => {
    setWindowIndex(0);
    setSelectedKey(todayKey);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-default bg-elevated/80 p-4 shadow-glow">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-fg-muted">
            {fullDayLabel(selectedDateObj)}
            <span className="ml-2 text-fg-subtle">
              {selectedGames.length} {selectedGames.length === 1 ? 'game' : 'games'}
            </span>
          </h3>
          {selectedKey !== todayKey ? (
            <button
              type="button"
              onClick={goToToday}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent transition duration-200 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {liveToday ? (
                <span className="relative inline-flex h-2 w-2" aria-label="Live games today">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
                </span>
              ) : null}
              Back to today
            </button>
          ) : null}
        </div>

        {/* Fixed 7-cell strip with arrow buttons at the ends. Arrows page
            the visible window by ±7 days; chips share the available width
            equally via `grid grid-cols-7`. No horizontal scroll. */}
        <div className="mt-4 flex items-stretch gap-1.5" role="tablist" aria-label="Pick a day">
          <ArrowButton
            direction="prev"
            label="Previous 7 days"
            onClick={() => setWindowIndex((prev) => prev - 1)}
          />
          <div className="grid flex-1 grid-cols-7 gap-1.5">
            {days.map((day) => {
              const meta = dayMeta.get(day.key) || { count: 0, hasLive: false };
              const isSelected = day.key === selectedKey;
              const isTodayChip = day.key === todayKey;
              const { weekday, dayNum } = chipLabels(day.date);
              return (
                <button
                  key={day.key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setSelectedKey(day.key)}
                  className={`flex min-w-0 flex-col items-center gap-0.5 rounded-2xl border px-1 py-2 text-center transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    isSelected
                      ? 'border-accent bg-accent/15 text-accent'
                      : isTodayChip
                        ? 'border-accent/40 bg-overlay/40 text-fg hover:border-accent hover:text-accent'
                        : 'border-default bg-overlay/40 text-fg-muted hover:border-strong hover:text-fg'
                  }`}
                >
                  <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em]">
                    {isTodayChip ? 'Today' : weekday}
                  </span>
                  <span
                    className="text-base font-semibold tabular-nums"
                    style={{ color: 'rgb(34, 211, 238)' }}
                  >
                    {dayNum}
                  </span>
                  <span className="flex h-3 items-center gap-1">
                    {meta.hasLive ? (
                      <span className="relative inline-flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-danger" />
                      </span>
                    ) : null}
                    {meta.count > 0 ? (
                      <span className="text-[10px] font-semibold tabular-nums text-fg-subtle">
                        {meta.count}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          <ArrowButton
            direction="next"
            label="Next 7 days"
            onClick={() => setWindowIndex((prev) => prev + 1)}
          />
        </div>
      </div>

      <div ref={listRef} className="space-y-4">
        {selectedGames.length === 0 ? (
          <EmptyState
            title="No games this day"
            description={
              isToday(selectedDateObj)
                ? 'Nothing kicking off today. Pick another day from the strip above.'
                : 'Pick another day, or page through with the arrows.'
            }
          />
        ) : (
          selectedGames.map((game) => <GameCard key={game.id} game={game} />)
        )}
      </div>
    </div>
  );
}

export default GamesCalendar;
