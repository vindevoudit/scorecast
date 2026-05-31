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
import { m, useReducedMotion } from '../lib/motion';

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
  const yesterday = addDays(t, -1);
  if (startOfDay(d).getTime() === yesterday.getTime()) return 'Yesterday';
  // Tier 20 follow-up — dropped the weekday from the long-form label.
  // The chip strip directly below already carries the weekday for the
  // selected date, so repeating it in the header was redundant and ate
  // the limited mobile width. Now just "May 27" (no leading "Wednesday, ").
  return d.toLocaleDateString([], { month: 'long', day: 'numeric' });
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
  // Tier 30 Phase 2 — arrow icon nudges ±2 px on hover for micro-feedback
  // (`whileHover` on the inner <m.svg>, so the surrounding button hit-area
  // stays static). Reduced-motion skips the nudge.
  const reduceMotion = useReducedMotion();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="group inline-flex shrink-0 items-center justify-center self-stretch rounded-2xl border border-default bg-overlay/40 px-2 text-fg-muted transition duration-200 hover:border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <m.svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
        whileHover={reduceMotion ? undefined : { x: isPrev ? -2 : 2 }}
        transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      >
        <path d={isPrev ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'} />
      </m.svg>
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

  // Tier 20 follow-up — listen for in-app URL changes from
  // DataContext.consumeDeepLinks (search-tap on a game, in-app
  // NotificationBell click, etc.). pushState/replaceState don't fire
  // popstate, so without this listener the GamesCalendar would stay on
  // its mount-time selectedKey whenever the user is already on the Games
  // tab when the URL changes. Re-read `?date=` from the URL and snap the
  // window to the new selection. Cold loads + cross-tab navigation are
  // unaffected — they still hit the useState initializer above.
  useEffect(() => {
    const onUrlChange = () => {
      const fromUrl = readDateFromUrl();
      const nextKey = fromUrl || todayKey;
      setSelectedKey((prev) => (prev === nextKey ? prev : nextKey));
      const nextDate = new Date(`${nextKey}T00:00:00`);
      if (!Number.isNaN(nextDate.getTime())) {
        const nextWindow = windowIndexForOffset(diffInDays(today, nextDate));
        setWindowIndex((prev) => (prev === nextWindow ? prev : nextWindow));
      }
    };
    window.addEventListener('scorecast:url-changed', onUrlChange);
    return () => window.removeEventListener('scorecast:url-changed', onUrlChange);
  }, [today, todayKey]);

  const selectedDateObj = useMemo(() => new Date(`${selectedKey}T00:00:00`), [selectedKey]);

  const goToToday = () => {
    setWindowIndex(0);
    setSelectedKey(todayKey);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-default bg-elevated/80 p-4 shadow-glow">
        {/* Tier 20 Chunk 4 — three-column grid so the count is always
            right-aligned and the "Back to today" pill centers between the
            heading and the count whenever it's present. The center column
            stays reserved (empty) when on today, keeping the heading +
            count alignment stable. `min-w-0` on the heading + count prevents
            the long-form fullDayLabel (e.g. "Wednesday, May 27") from
            blowing out the layout at 360px — it truncates with ellipsis. */}
        <div className="grid grid-cols-3 items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold uppercase tracking-[0.16em] text-fg-muted sm:tracking-[0.24em]">
            {fullDayLabel(selectedDateObj)}
          </h3>
          <div className="flex justify-center">
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
          <span className="min-w-0 truncate text-right text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted sm:text-sm sm:tracking-[0.24em]">
            {selectedGames.length} {selectedGames.length === 1 ? 'game' : 'games'}
          </span>
        </div>

        {/* Fixed 7-cell strip with arrow buttons at the ends. Arrows page
            the visible window by ±7 days; chips share the available width
            equally via `grid grid-cols-7`. No horizontal scroll. Tier 19
            Chunk 4b — narrowed chip padding + scaled day-num font on mobile
            so the day number fits on 360-px viewports without truncating the
            border on the right side of the rightmost chip. */}
        <div
          className="mt-4 flex items-stretch gap-1 sm:gap-1.5"
          role="tablist"
          aria-label="Pick a day"
        >
          <ArrowButton
            direction="prev"
            label="Previous 7 days"
            onClick={() => setWindowIndex((prev) => prev - 1)}
          />
          <div className="grid flex-1 grid-cols-7 gap-1 sm:gap-1.5">
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
                  className={`flex min-w-0 flex-col items-center gap-0.5 rounded-2xl border px-0.5 py-2 text-center transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-1 ${
                    isSelected
                      ? 'border-accent bg-accent/15 text-accent'
                      : isTodayChip
                        ? 'border-accent/40 bg-overlay/40 text-fg hover:border-accent hover:text-accent'
                        : 'border-default bg-overlay/40 text-fg-muted hover:border-strong hover:text-fg'
                  }`}
                >
                  {/* Tier 20 follow-up — at < 360px the 7-col grid leaves
                      ~40px per chip and "Today" (any casing) still
                      overflows the truncate boundary on some viewport /
                      font combos, surfacing as a clipped "Toda…". The
                      chip's accent border + accent day-number color
                      already communicate "this is today" without the
                      word, so drop it entirely on mobile and keep just
                      the weekday label. At sm+ the chip is wide enough
                      that we can put "TODAY" back for explicit
                      labeling. */}
                  <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em]">
                    <span className="sm:hidden">{weekday}</span>
                    <span className="hidden sm:inline">{isTodayChip ? 'TODAY' : weekday}</span>
                  </span>
                  {/* The CSS conflict the Chunk-3 inline-style hack was guarding against
                      DID resurface (intermittently, after Chunk 4b swapped to `text-accent`).
                      Restoring the inline style for highest-specificity guarantee, but
                      using `rgb(var(--c-accent))` so the day number still tracks the active
                      theme (the original hardcoded `rgb(34, 211, 238)` would have looked
                      wrong in light mode).
                      Tier 30 Phase 2 — today's chip switches to `.font-led`
                      (Orbitron tabular-nums) so the day number reads as a
                      scoreboard digit; non-today chips stay on the default
                      Inter face so the contrast itself anchors today. */}
                  <span
                    className={`text-sm font-semibold tabular-nums sm:text-base ${
                      isTodayChip ? 'font-led' : ''
                    }`}
                    style={{ color: 'rgb(var(--c-accent))' }}
                  >
                    {dayNum}
                  </span>
                  <span className="flex h-3 items-center gap-0.5 sm:gap-1">
                    {meta.hasLive ? (
                      <span className="relative inline-flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
                        {/* Tier 30 Phase 2 — inner dot picks up the
                            `led-flicker` keyframe so it reads as a live
                            broadcast indicator rather than a plain
                            circle. `motion-safe:` keeps reduced-motion
                            users on a steady dot. */}
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-danger motion-safe:animate-led-flicker" />
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
