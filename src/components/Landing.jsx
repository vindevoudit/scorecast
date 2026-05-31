// Tier 30 Phase 2 — Landing visual paint.
//
// Adds the refined-stadium identity on top of the Tier 11 / Tier 18 wordmark
// scaffold:
//   - Hero cascade reveal (kicker -> wordmark scale -> slogan -> CTAs) via
//     motion variants. Reduced-motion users land at the final state instantly.
//   - League-name ticker strip between hero + stats. Motion-driven horizontal
//     scroll on a two-up duplicate so the wrap is seamless. Reduced-motion
//     skips the animate prop entirely.
//   - Stats grid count-up — animate() integer interpolation, 1.4s out-expo.
//   - Asymmetric 3-col feature grid (cards 1, 4 tall via md:row-span-2;
//     cards 2, 3 short, centre column). FeatureIcon plaques replace the
//     four emoji.
//   - Steps numerals in .font-led (Orbitron + tabular-nums).
//
// Playwright sentinels preserved verbatim: `BANTRYX` h1, "Get started" /
// "Sign in" / "browse as a guest" CTAs. Auth helpers depend on these.

import { useEffect, useState } from 'react';
import { Button } from './ui';
import Footer from './Footer';
import FeatureIcon from './FeatureIcon';
import { m, animate, useReducedMotion } from '../lib/motion';
import {
  heroRevealTimeline,
  heroRevealItem,
  heroWordmark,
  featureCardHover,
  statsCountUp,
} from '../lib/motionVariants';

// 3 feature cards laid out symmetrically in a single row on md+. The
// previous 4-card 1+4-tall / 2+3-short asymmetric grid was visually
// unbalanced; user-confirmed cleanup drops the Badges card so all three
// remaining cards sit equal-height in one row.
const FEATURES = [
  {
    icon: 'target',
    title: 'Probability-weighted scoring',
    body: 'Underdog wins are worth more than favorite wins. A 38% upset pays +62 points; a 52% home win pays +48. Pick smart, not safe.',
  },
  {
    icon: 'group',
    title: 'Private groups & friends',
    body: 'Spin up an invite-only league for your group chat. Track friends, send requests, and race to the top of your own leaderboard.',
  },
  {
    icon: 'trophy',
    title: 'Live leaderboards',
    body: 'Standings update the moment a match result lands — no waiting until Monday morning. Climb in real time.',
  },
];

const STEPS = [
  {
    number: '01',
    title: 'Sign up free',
    body: 'Create an account in under 30 seconds. No credit card, no commitments, no ads.',
  },
  {
    number: '02',
    title: 'Pick your winners',
    body: 'Browse upcoming matches and lock in your picks before kickoff. Change your mind right up until first whistle.',
  },
  {
    number: '03',
    title: 'Climb the rankings',
    body: 'Earn points based on probability, unlock badges, and watch your name move up the live leaderboard.',
  },
];

// User-curated set — only competitions Bantryx actively tracks today are
// surfaced here so the ticker stays honest. Adding a new competition?
// Append after wiring it up in League Manager.
const TICKER_LEAGUES = [
  'WORLD CUP',
  'PREMIER LEAGUE',
  'LA LIGA',
  'SERIE A',
  'BUNDESLIGA',
  'LIGUE 1',
  'CHAMPIONS LEAGUE',
];

function Landing({ onSignIn, onSignUp, onBrowseAsGuest }) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="space-y-20 pb-12 md:space-y-32">
      {/* Hero — orchestrated reveal cascade. Parent timeline staggers the
          children (kicker -> wordmark -> slogan -> tagline -> CTAs). */}
      <m.section
        className="relative overflow-hidden pt-8 md:pt-16"
        variants={heroRevealTimeline}
        initial={reduceMotion ? 'visible' : 'hidden'}
        animate="visible"
      >
        <div
          aria-hidden="true"
          className="bg-arena-grid pointer-events-none absolute inset-0 -z-20"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/4 top-0 -z-10 h-72 w-72 rounded-full bg-accent/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-1/4 top-24 -z-10 h-96 w-96 rounded-full bg-accent-strong/10 blur-3xl"
        />

        <div className="relative z-10 mx-auto max-w-4xl px-4 text-center">
          <m.p
            variants={heroRevealItem}
            className="flex items-center justify-center gap-3 text-xs font-light tracking-[0.5em] text-accent sm:gap-4 sm:text-sm"
            aria-label="Predict, Compete, Climb"
          >
            <span>PREDICT</span>
            <span aria-hidden="true" className="text-accent/40">
              ◆
            </span>
            <span>COMPETE</span>
            <span aria-hidden="true" className="text-accent/40">
              ◆
            </span>
            <span>CLIMB</span>
          </m.p>

          {/* Wordmark gets its own variant — heavier reveal (scale + blur
              unwrap) and the stronger four-layer cyan bloom from
              --shadow-brand-glow-strong (`.text-shadow-brand-glow-strong`).
              Tier 30 Phase 2 follow-up — typeface swap from Bebas Neue
              (font-display) to Orbitron (.font-led) so the hero matches
              the dashboard top-bar wordmark + the scoreboard digit
              treatment elsewhere. Clamp max trimmed 9rem → 7.5rem to
              compensate for Orbitron's wider geometric letters (Bebas
              Neue is condensed ~0.6em per glyph; Orbitron is ~0.85em),
              so BANTRYX still fits within the centred max-w-4xl
              container on a wide desktop. */}
          <m.h1
            variants={heroWordmark}
            className="text-shadow-brand-glow-strong font-led mt-7 select-none text-[clamp(3rem,11vw,7.5rem)] leading-[0.85] tracking-[0.02em] text-accent-soft"
          >
            BANTRYX
          </m.h1>

          <m.div variants={heroRevealItem} className="mt-7 flex items-center justify-center gap-4">
            <span
              aria-hidden="true"
              className="h-px w-10 bg-gradient-to-r from-transparent to-accent shadow-[0_0_8px_rgba(34,211,238,0.6)] sm:w-16"
            />
            <p className="flex items-center justify-center gap-3 text-xs font-light tracking-[0.5em] text-accent sm:gap-4 sm:text-sm">
              NO BETTING, JUST BANTRYX
            </p>
            <span
              aria-hidden="true"
              className="h-px w-10 bg-gradient-to-l from-transparent to-accent shadow-[0_0_8px_rgba(34,211,238,0.6)] sm:w-16"
            />
          </m.div>

          <m.p
            variants={heroRevealItem}
            className="mx-auto mt-10 max-w-2xl text-lg text-fg sm:text-xl"
          >
            Football prediction made <span className="font-semibold text-fg">social</span>,{' '}
            <span className="font-semibold text-fg">competitive</span>, and{' '}
            <span className="font-semibold text-fg">fun</span>. Pick winners, earn points for risky
            calls and underdog upsets, and climb the live leaderboards against your friends.
          </m.p>

          <m.div
            variants={heroRevealItem}
            className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center"
          >
            <Button
              variant="primary"
              size="lg"
              onClick={onSignUp}
              className="px-8 py-4 text-base shadow-brand-glow-strong"
            >
              Get started — it's free
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={onSignIn}
              className="px-8 py-4 text-base"
            >
              Sign in
            </Button>
          </m.div>
          {onBrowseAsGuest ? (
            <m.div variants={heroRevealItem}>
              <Button
                variant="link"
                onClick={onBrowseAsGuest}
                className="mt-6 text-sm text-fg-muted"
              >
                Or just browse as a guest →
              </Button>
            </m.div>
          ) : null}
        </div>
      </m.section>

      {/* League ticker — broadcast-style scroll between hero and stats. The
          inner row is duplicated; the parent translates by -50% to land at
          the start of the duplicate, creating a seamless loop. */}
      <LeagueTicker />

      <section className="mx-auto max-w-5xl px-4">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-default bg-divider sm:grid-cols-3">
          <Stat target={62} prefix="+" label="points for a 38% underdog upset" />
          <Stat infinity label="private groups you can build" />
          <Stat target={30} suffix="s" label="from sign-up to first pick" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4">
        <SectionHeader
          eyebrow="Why Bantryx"
          title="Built for people who don't just want to pick — they want to win."
        />
        {/* Symmetric 3-col layout on md+: three equal-height cards in a
            single row. On mobile the cards stack in source order. */}
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4">
        <SectionHeader eyebrow="How it works" title="Three steps. No catch. No paywall." />
        <ol className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((step) => (
            <Step key={step.number} {...step} />
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-3xl px-4">
        <div className="rounded-3xl border border-accent/30 bg-gradient-to-br from-accent/10 via-elevated/40 to-base/40 p-10 text-center shadow-glow md:p-14">
          <h2 className="text-3xl font-semibold text-fg sm:text-4xl">
            Ready to outpick your group chat?
          </h2>
          <p className="mt-4 text-fg">Sign up, pick a side, and let the math do the rest.</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button variant="primary" size="lg" onClick={onSignUp} className="px-8 py-4 text-base">
              Create your account
            </Button>
            <Button variant="link" onClick={onSignIn} className="text-sm">
              Or sign in →
            </Button>
          </div>
          {onBrowseAsGuest ? (
            <Button variant="link" onClick={onBrowseAsGuest} className="mt-6 text-xs text-fg-muted">
              Just browsing? Continue as a guest →
            </Button>
          ) : null}
        </div>
      </section>
      <Footer />
    </div>
  );
}

function LeagueTicker() {
  // Pure-CSS marquee — the `animate-ticker-scroll` keyframe (defined in
  // tailwind.config.js) translates the row from 0% to -50% linearly over
  // 24s, infinitely. The row's content is doubled so that landing at
  // -50% lines up exactly with the start of the duplicate, making the
  // loop visually seamless. CSS animations run on the compositor (GPU)
  // — strictly smoother than motion's JS-driven `animate={{x:[…]}}`
  // path, which can hiccup under React render pressure or main-thread
  // contention. `motion-safe:` gates the animation so prefers-reduced-
  // motion users see a static ticker (the global @media rule in
  // index.css would also collapse it to 0.01ms regardless).
  // Negative top margin uses Tailwind's `!` prefix to win against the
  // parent `space-y-*` margin-top (`space-y-X > :not([hidden]) ~
  // :not([hidden])` has higher specificity than a single `mt-*` class,
  // so plain `mt-*` would lose).
  return (
    <div className="bg-arena-grid-bold relative !mt-10 overflow-hidden border-y border-default py-3 md:!mt-16">
      <div className="mask-fade-x">
        <div className="flex whitespace-nowrap motion-safe:animate-ticker-scroll">
          {TICKER_LEAGUES.map((name) => (
            <span
              key={`a-${name}`}
              className="font-display mr-12 text-sm tracking-[0.3em] text-fg-muted"
            >
              {name}
            </span>
          ))}
          {TICKER_LEAGUES.map((name) => (
            <span
              key={`b-${name}`}
              aria-hidden="true"
              className="font-display mr-12 text-sm tracking-[0.3em] text-fg-muted"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ target, suffix = '', prefix = '', infinity = false, label }) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(infinity || reduceMotion ? (target ?? 0) : 0);

  useEffect(() => {
    if (infinity) return undefined;
    if (reduceMotion) {
      setDisplay(target);
      return undefined;
    }
    const controls = animate(0, target, {
      ...statsCountUp,
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [target, infinity, reduceMotion]);

  return (
    <div className="bg-elevated/85 p-8 text-center">
      <p className="text-shadow-brand-glow font-display text-4xl text-accent-soft sm:text-5xl">
        {infinity ? '∞' : `${prefix}${display}${suffix}`}
      </p>
      <p className="mt-3 text-xs uppercase tracking-[0.2em] text-fg-muted">{label}</p>
    </div>
  );
}

function SectionHeader({ eyebrow, title }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.4em] text-accent/80">{eyebrow}</p>
      <h2 className="mt-4 text-3xl font-semibold leading-tight text-fg sm:text-4xl">{title}</h2>
    </div>
  );
}

function FeatureCard({ icon, title, body }) {
  const reduceMotion = useReducedMotion();
  return (
    <m.div
      whileHover={reduceMotion ? undefined : featureCardHover}
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-default bg-elevated/60 p-8 transition-colors duration-300 hover:border-accent/30 hover:bg-elevated/85"
    >
      <div className="flex items-center gap-4">
        <FeatureIcon name={icon} />
        <h3 className="text-xl font-semibold text-fg">{title}</h3>
      </div>
      <p className="mt-4 text-fg">{body}</p>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-accent/5 blur-2xl transition duration-300 group-hover:bg-accent/15"
      />
    </m.div>
  );
}

function Step({ number, title, body }) {
  return (
    <li className="rounded-3xl border border-default bg-elevated/50 p-8">
      {/* `.font-led` swaps the numeral to Orbitron + tabular-nums + the
          subtle led drop-shadow so the step number reads as a scoreboard
          digit instead of a generic display font. */}
      <p className="font-led text-shadow-led text-5xl text-accent/60">{number}</p>
      <h3 className="mt-4 text-xl font-semibold text-fg">{title}</h3>
      <p className="mt-3 text-sm text-fg">{body}</p>
    </li>
  );
}

export default Landing;
