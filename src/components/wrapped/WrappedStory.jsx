// World Cup Aftermatch (user-facing name; code keeps `wrapped`) — full-screen
// tappable story (Spotify/Instagram style).
// A slide state-machine: segmented progress bars up top, tap-left/back +
// tap-right/next zones, keyboard arrows, touch swipe, and a close button.
// Each slide reveals one big animated stat. The final slide offers Share
// (imperative capture via shareWrapped) and Done.
//
// Slides are config-driven (SLIDES below): every entry declares `when(data)`
// so stat-less sections auto-skip (a user who only picked the group stage
// never sees a "Deepest run" slide). Numbers count up on slide mount.
//
// Motion note: we call the RAW `useReducedMotion` from motion/react — NOT the
// wrapper in src/lib/motion.js, which treats mobile as reduced-motion. Wrapped
// is a mobile-first animated experience, so we want motion on phones and only
// fall back to instant reveals for a genuine OS reduced-motion preference.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { m, AnimatePresence, animate } from '../../lib/motion';
import { heroRevealTimeline, heroRevealItem, statsCountUp } from '../../lib/motionVariants';
import { displayTeamName } from '../../utils/teamNames';
import { MEDAL_EMOJI } from '../../utils/stages';
import { useNotifications } from '../../hooks/useNotifications';
import { useAuth } from '../../hooks/useAuth';
import { shareWrapped } from './shareWrapped';

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Count-up number. Animates 0 → value on mount; jumps straight to the value
// under reduced motion. Slides unmount/remount via AnimatePresence, so a fresh
// count-up fires each time a slide becomes active.
function CountUp({ value, reduce }) {
  const [display, setDisplay] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return undefined;
    }
    const controls = animate(0, value, {
      ...statsCountUp,
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, reduce]);
  return <>{display.toLocaleString('en-US')}</>;
}

// Shared slide chrome: a centred column with a staggered reveal. `pointer-
// events-none` on the wrapper lets empty areas fall through to the tap zones;
// interactive children re-enable pointer events themselves.
function Slide({ children }) {
  return (
    <m.div
      className="pointer-events-none flex h-full w-full max-w-xl flex-col items-center justify-center gap-6 px-8 text-center"
      variants={heroRevealTimeline}
      initial="hidden"
      animate="visible"
    >
      {children}
    </m.div>
  );
}

function Kicker({ children }) {
  return (
    <m.p variants={heroRevealItem} className="text-xs uppercase tracking-[0.35em] text-accent/80">
      {children}
    </m.p>
  );
}

function BigNumber({ children }) {
  return (
    <m.div
      variants={heroRevealItem}
      className="font-led text-shadow-brand-glow-strong text-7xl font-bold tabular-nums text-accent sm:text-8xl"
    >
      {children}
    </m.div>
  );
}

function Caption({ children }) {
  return (
    <m.p variants={heroRevealItem} className="text-lg text-fg sm:text-xl">
      {children}
    </m.p>
  );
}

function Subtle({ children }) {
  return (
    <m.p variants={heroRevealItem} className="text-sm text-fg-muted">
      {children}
    </m.p>
  );
}

// ---------------------------------------------------------------------------
// Slide definitions. Each `render(data, reduce)` returns the slide body.
// ---------------------------------------------------------------------------
const SLIDES = [
  {
    key: 'intro',
    when: () => true,
    render: () => (
      <Slide>
        <Kicker>Bantryx</Kicker>
        <m.div variants={heroRevealItem} className="text-5xl font-semibold text-fg sm:text-6xl">
          Your World Cup 2026
        </m.div>
        <m.div
          variants={heroRevealItem}
          className="font-led text-shadow-brand-glow-strong text-6xl font-bold text-accent sm:text-7xl"
        >
          AFTERMATCH
        </m.div>
        <Subtle>Tap to relive your tournament →</Subtle>
      </Slide>
    ),
  },
  {
    key: 'picks',
    when: (d) => d.summary.picks > 0,
    render: (d, reduce) => (
      <Slide>
        <Kicker>You showed up</Kicker>
        <BigNumber>
          <CountUp value={d.summary.picks} reduce={reduce} />
        </BigNumber>
        <Caption>predictions across the tournament</Caption>
      </Slide>
    ),
  },
  {
    key: 'points',
    when: () => true,
    render: (d, reduce) => (
      <Slide>
        <Kicker>Your haul</Kicker>
        <BigNumber>
          <CountUp value={d.summary.points} reduce={reduce} />
        </BigNumber>
        <Caption>points earned</Caption>
      </Slide>
    ),
  },
  {
    key: 'accuracy',
    when: (d) => d.summary.scored > 0,
    render: (d, reduce) => (
      <Slide>
        <Kicker>Sharp eye</Kicker>
        <BigNumber>
          <CountUp value={Math.round(d.summary.winRate * 100)} reduce={reduce} />%
        </BigNumber>
        <Caption>of your matches called right</Caption>
        <Subtle>
          {d.summary.wins} of {d.summary.scored} settled picks
        </Subtle>
      </Slide>
    ),
  },
  {
    key: 'boldest',
    when: (d) => Boolean(d.boldestCall),
    render: (d) => {
      const b = d.boldestCall;
      return (
        <Slide>
          <Kicker>Your boldest call</Kicker>
          <m.div variants={heroRevealItem} className="text-4xl font-bold text-accent sm:text-5xl">
            {displayTeamName(b.pickedTeam)}
          </m.div>
          <Caption>You backed them at {Math.round(b.probability * 100)}% — and nailed it.</Caption>
          <m.p variants={heroRevealItem} className="font-led text-2xl tabular-nums text-fg">
            +{b.points} pts · {b.stageLabel}
          </m.p>
        </Slide>
      );
    },
  },
  {
    key: 'team',
    when: (d) => Boolean(d.teamOfTournament),
    render: (d) => {
      const t = d.teamOfTournament;
      return (
        <Slide>
          <Kicker>Your team of the tournament</Kicker>
          <m.div variants={heroRevealItem} className="text-4xl font-bold text-fg sm:text-5xl">
            {displayTeamName(t.team)}
          </m.div>
          <Caption>
            You rode with them {t.picks} time{t.picks === 1 ? '' : 's'}
            {t.wins > 0 ? ` · ${t.wins} win${t.wins === 1 ? '' : 's'}` : ''}
          </Caption>
        </Slide>
      );
    },
  },
  {
    key: 'upsets',
    when: (d) => d.upsetsCalled > 0,
    render: (d, reduce) => (
      <Slide>
        <Kicker>Against the odds</Kicker>
        <BigNumber>
          <CountUp value={d.upsetsCalled} reduce={reduce} />
        </BigNumber>
        <Caption>upsets you called that the model didn&apos;t</Caption>
      </Slide>
    ),
  },
  {
    key: 'stage',
    when: (d) => Boolean(d.bestStage),
    render: (d) => {
      const s = d.bestStage;
      const medal = s.medal ? MEDAL_EMOJI[s.medal] : null;
      return (
        <Slide>
          <Kicker>Your deepest run</Kicker>
          {medal ? (
            <m.div variants={heroRevealItem} className="text-6xl" aria-hidden="true">
              {medal}
            </m.div>
          ) : null}
          <m.div variants={heroRevealItem} className="text-3xl font-semibold text-fg sm:text-4xl">
            {s.label}
          </m.div>
          <Caption>
            {ordinal(s.rank)} of {s.total} · Top {s.topPercent}%
          </Caption>
        </Slide>
      );
    },
  },
  {
    key: 'standing',
    when: (d) => Boolean(d.overall),
    render: (d) => {
      const parts = [];
      if (d.groups.friendsBeaten > 0) {
        parts.push(`You beat ${d.groups.friendsBeaten} of your friends`);
      }
      if (d.groups.bestFinish) {
        parts.push(
          `${ordinal(d.groups.bestFinish.rank)} of ${d.groups.bestFinish.total} in ${d.groups.bestFinish.groupName}`,
        );
      }
      return (
        <Slide>
          <Kicker>Where you finished</Kicker>
          <BigNumber>Top {d.overall.topPercent}%</BigNumber>
          <Caption>
            {ordinal(d.overall.rank)} of {d.overall.total} predictors worldwide
          </Caption>
          {parts.length > 0 ? <Subtle>{parts.join(' · ')}</Subtle> : null}
        </Slide>
      );
    },
  },
  {
    key: 'archetype',
    when: (d) => Boolean(d.archetype),
    render: (d) => (
      <Slide>
        <Kicker>Your prediction personality</Kicker>
        <m.div variants={heroRevealItem} className="text-7xl" aria-hidden="true">
          {d.archetype.emoji}
        </m.div>
        <m.div variants={heroRevealItem} className="text-4xl font-bold text-accent sm:text-5xl">
          {d.archetype.title}
        </m.div>
        <Caption>{d.archetype.blurb}</Caption>
      </Slide>
    ),
  },
  {
    key: 'finale',
    when: () => true,
    isFinale: true,
    render: (d) => (
      <Slide>
        <Kicker>Final whistle</Kicker>
        <m.div variants={heroRevealItem} className="text-3xl font-semibold text-fg sm:text-4xl">
          {d.summary.points.toLocaleString('en-US')} points · {Math.round(d.summary.winRate * 100)}%
          accuracy
        </m.div>
        {d.overall ? <Caption>Top {d.overall.topPercent}% worldwide</Caption> : null}
      </Slide>
    ),
  },
];

function WrappedStory({ wrapped, onClose }) {
  const reduce = useReducedMotion();
  const { showStatus } = useNotifications();
  const { user } = useAuth();
  const [index, setIndex] = useState(0);
  const [sharing, setSharing] = useState(false);
  const touchStartX = useRef(null);

  const slides = SLIDES.filter((s) => s.when(wrapped));
  const count = slides.length;
  const active = slides[Math.min(index, count - 1)];
  const isFinale = Boolean(active?.isFinale);

  const next = useCallback(() => {
    setIndex((i) => (i < count - 1 ? i + 1 : i));
  }, [count]);
  const prev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  const onTouchStart = (e) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e) => {
    if (touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 50) return;
    if (dx < 0) next();
    else prev();
  };

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const name = user?.displayName || user?.username;
      const { method } = await shareWrapped({ wrapped, name });
      if (method === 'shared') showStatus('Shared');
      else if (method === 'downloaded') showStatus('Image saved');
    } catch {
      showStatus("Couldn't generate the image — try again");
    } finally {
      setSharing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-base"
      role="dialog"
      aria-modal="true"
      aria-label="World Cup Aftermatch"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="bg-stadium-vignette pointer-events-none absolute inset-0"
        aria-hidden="true"
      />

      {/* Segmented progress bars. */}
      <div className="relative z-20 flex gap-1.5 px-4 pt-4">
        {slides.map((s, i) => (
          <div key={s.key} className="h-1 flex-1 overflow-hidden rounded-full bg-overlay">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: i <= index ? '100%' : '0%' }}
            />
          </div>
        ))}
      </div>

      {/* Close button. */}
      <div className="relative z-20 flex justify-end px-4 pt-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Aftermatch"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-overlay/70 text-fg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-5 w-5"
          >
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Slide stage. */}
      <div className="relative flex-1">
        <button
          type="button"
          onClick={prev}
          aria-label="Previous"
          className="absolute inset-y-0 left-0 z-0 w-[35%] cursor-default focus:outline-none"
        />
        <button
          type="button"
          onClick={next}
          aria-label="Next"
          className="absolute inset-y-0 right-0 z-0 w-[65%] cursor-default focus:outline-none"
        />
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <m.div
              key={active?.key}
              className="flex h-full w-full items-center justify-center"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              {active?.render(wrapped, reduce)}
            </m.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Finale action bar. */}
      {isFinale ? (
        <div className="relative z-20 flex items-center justify-center gap-3 px-6 pb-8">
          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-accent px-6 py-3 font-semibold text-accent-fg shadow-brand-glow-strong hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-5 w-5"
            >
              <path d="M12 16V4M8 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" strokeLinecap="round" />
            </svg>
            {sharing ? 'Preparing…' : 'Share your Aftermatch'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center rounded-2xl border border-default bg-overlay/60 px-5 py-3 font-medium text-fg hover:bg-overlay focus-visible:ring-2 focus-visible:ring-accent"
          >
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default WrappedStory;
