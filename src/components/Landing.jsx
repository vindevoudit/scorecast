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

import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import Footer from './Footer';
import FeatureIcon from './FeatureIcon';
import { m, animate, useInView, useReducedMotion } from '../lib/motion';
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
            <p
              className="flex items-center justify-center gap-3 text-xs font-light tracking-[0.5em] text-accent sm:gap-4 sm:text-sm"
              aria-label="No betting, just Bantryx"
            >
              <span>NO BETTING</span>
              <span aria-hidden="true" className="text-accent/40">
                ◆
              </span>
              <span>JUST BANTRYX</span>
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

      {/* Below-the-fold sections all share the same scroll-reveal pattern —
          `<m.section variants={heroRevealTimeline} whileInView="visible">`
          with the children participating in the cascade via
          `variants={heroRevealItem}`. `viewport.once: true` makes the
          reveal fire exactly once when the section first scrolls into
          view; `amount: 0.2` requires 20% of the section to be visible
          before triggering, so the cards animate as the user scrolls
          to them rather than instantly on first paint. Reduced-motion
          users get `initial="visible"` so everything lands at the final
          state immediately. */}
      <m.section
        className="mx-auto max-w-5xl px-4"
        variants={heroRevealTimeline}
        initial={reduceMotion ? 'visible' : 'hidden'}
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
      >
        {/* Stat cards are independent (gap-4) so each can lift on hover
            without being clipped by a shared rounded frame. Previous
            `gap-px overflow-hidden rounded-3xl border` "billboard" look
            gave hairline dividers but prevented the per-card hover lift
            from showing — the parent overflow-hidden clipped the top
            translate. The independent cards layout now matches the
            feature grid + steps grid hover behavior exactly. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat target={62} prefix="+" label="points for a 38% underdog upset" />
          <Stat infinity label="private groups you can build" />
          <Stat target={30} suffix="s" label="from sign-up to first pick" />
        </div>
      </m.section>

      <m.section
        className="mx-auto max-w-6xl px-4"
        variants={heroRevealTimeline}
        initial={reduceMotion ? 'visible' : 'hidden'}
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
      >
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
      </m.section>

      <m.section
        className="mx-auto max-w-5xl px-4"
        variants={heroRevealTimeline}
        initial={reduceMotion ? 'visible' : 'hidden'}
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
      >
        <SectionHeader eyebrow="How it works" title="Three steps. No catch. No paywall." />
        <ol className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((step) => (
            <Step key={step.number} {...step} />
          ))}
        </ol>
      </m.section>

      <m.section
        className="mx-auto max-w-3xl px-4"
        variants={heroRevealTimeline}
        initial={reduceMotion ? 'visible' : 'hidden'}
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
      >
        <m.div
          variants={heroRevealItem}
          whileHover={reduceMotion ? undefined : featureCardHover}
          className="group relative overflow-hidden rounded-3xl border border-accent/30 bg-gradient-to-br from-accent/10 via-elevated/40 to-base/40 p-10 text-center shadow-glow transition-colors duration-300 hover:border-accent/50 md:p-14"
        >
          {/* Corner glow blob — matches the feature/step/stat treatment.
              The existing `shadow-glow` halo on the card stays as the
              ambient bloom; the blob brightens that corner on hover. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-accent/5 blur-3xl transition duration-300 group-hover:bg-accent/20"
          />
          <h2 className="relative text-3xl font-semibold text-fg sm:text-4xl">
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
        </m.div>
      </m.section>
      <Footer />
    </div>
  );
}

// Number of times to repeat TICKER_LEAGUES in the marquee track. With
// `translateX(-50%)` as the loop endpoint, the seamless-wrap constraint
// is `viewport_width <= (REPEATS - 1) × copy_width` — at the loop point,
// the FIRST half of the track has scrolled off-left and the SECOND half
// must fully cover the viewport. With 7 leagues at ~150px each + 7×3rem
// margins, one copy ≈ 1000-1100px. So 2 copies (the natural minimum
// for the duplicate-row pattern) only covers viewports up to ~1100px;
// anything wider sees the visible "end of content then empty stretch"
// the user reported. 6 copies covers viewports up to ~5000px — comfortably
// past 4K ultrawide. DOM cost is trivial (42 simple spans).
const TICKER_REPEATS = 6;

function LeagueTicker() {
  // Pure-CSS marquee — the `animate-ticker-scroll` keyframe (defined in
  // tailwind.config.js) translates the row from 0% to -50% linearly over
  // 24s, infinitely. Track is repeated TICKER_REPEATS times so landing at
  // -50% lines up exactly halfway through the track (= identical content
  // to position 0), making the loop visually seamless. CSS animations
  // run on the compositor (GPU) — strictly smoother than motion's
  // JS-driven `animate={{x:[…]}}` path. `motion-safe:` gates the
  // animation against prefers-reduced-motion.
  // Negative top margin uses Tailwind's `!` prefix to win against the
  // parent `space-y-*` selector specificity.
  return (
    // Tier 30 Phase 2 follow-up — ticker hidden entirely below md.
    // User-confirmed: the marquee + masked fade reads as noise on a
    // narrow viewport (only 2-3 leagues visible at a time) and the
    // CSS animation was already silenced on mobile by the
    // `@media (max-width: 767px)` rule in index.css, leaving a
    // static stripe with no value. Cleaner to omit the element.
    <div className="relative !mt-10 hidden overflow-hidden border-y border-default py-3 md:!mt-16 md:block">
      <div className="mask-fade-x">
        {/* `w-max` (width: max-content) sizes the flex container to its
            content; without it `translateX(-50%)` would translate by
            half the parent width instead of half the content width. */}
        <div className="flex w-max whitespace-nowrap motion-safe:animate-ticker-scroll">
          {Array.from({ length: TICKER_REPEATS }).flatMap((_, copyIdx) =>
            TICKER_LEAGUES.map((name) => (
              <span
                key={`${copyIdx}-${name}`}
                aria-hidden={copyIdx > 0 ? 'true' : undefined}
                className="font-display mr-12 text-sm tracking-[0.3em] text-fg-muted"
              >
                {name}
              </span>
            )),
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ target, suffix = '', prefix = '', infinity = false, label }) {
  const reduceMotion = useReducedMotion();
  // `useInView` defers the count-up until the stat actually scrolls into
  // view. Previously the `animate()` call fired on mount, so the values
  // were already at their target by the time the user scrolled past the
  // hero — the count-up was effectively invisible. With `once: true` the
  // hook stays "true" once seen, so we don't re-run on subsequent scrolls.
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [display, setDisplay] = useState(infinity || reduceMotion ? (target ?? 0) : 0);

  useEffect(() => {
    if (infinity) return undefined;
    if (reduceMotion) {
      setDisplay(target);
      return undefined;
    }
    if (!inView) return undefined;
    const controls = animate(0, target, {
      ...statsCountUp,
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [target, infinity, reduceMotion, inView]);

  // Same hover signature as FeatureCard: motion lift via `featureCardHover`
  // spring + border highlight + corner glow blob that brightens
  // `bg-accent/5 → bg-accent/15` via group-hover.
  return (
    <m.div
      ref={ref}
      variants={heroRevealItem}
      whileHover={reduceMotion ? undefined : featureCardHover}
      className="group relative overflow-hidden rounded-3xl border border-default bg-elevated/60 p-8 text-center transition-colors duration-300 hover:border-accent/30 hover:bg-elevated/85"
    >
      {/* Tier 30 Phase 2 follow-up — `infinity` swaps off `.font-display`
          (Bebas Neue) onto the inherited Inter at font-black weight.
          Bebas Neue's ∞ glyph is either absent or poorly drawn (the
          mobile system-font fallback renders it as a different symbol
          entirely on some Android builds). Inter has a proper ∞ at
          weight 900 that renders consistently across browsers + OSes,
          and the visual weight is heavy enough to match the
          neighbouring Bebas Neue numerals at the same size. */}
      <p
        className={`text-shadow-brand-glow text-4xl text-accent-soft sm:text-5xl ${
          infinity ? 'font-black' : 'font-display'
        }`}
      >
        {infinity ? '∞' : `${prefix}${display}${suffix}`}
      </p>
      <p className="mt-3 text-xs uppercase tracking-[0.2em] text-fg-muted">{label}</p>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-accent/5 blur-2xl transition duration-300 group-hover:bg-accent/15"
      />
    </m.div>
  );
}

// SectionHeader's eyebrow + title participate in the parent `m.section`'s
// stagger timeline when one is present. When rendered standalone (no
// motion parent), motion treats the variants prop as a no-op and the
// elements render in their static state (opacity 1) — safe either way.
function SectionHeader({ eyebrow, title }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <m.p
        variants={heroRevealItem}
        className="text-xs font-semibold uppercase tracking-[0.4em] text-accent/80"
      >
        {eyebrow}
      </m.p>
      <m.h2
        variants={heroRevealItem}
        className="mt-4 text-3xl font-semibold leading-tight text-fg sm:text-4xl"
      >
        {title}
      </m.h2>
    </div>
  );
}

function FeatureCard({ icon, title, body }) {
  const reduceMotion = useReducedMotion();
  return (
    <m.div
      variants={heroRevealItem}
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
  const reduceMotion = useReducedMotion();
  return (
    <m.li
      variants={heroRevealItem}
      whileHover={reduceMotion ? undefined : featureCardHover}
      className="group relative overflow-hidden rounded-3xl border border-default bg-elevated/50 p-8 transition-colors duration-300 hover:border-accent/30 hover:bg-elevated/85"
    >
      {/* `.font-led` swaps the numeral to Orbitron + tabular-nums + the
          subtle led drop-shadow so the step number reads as a scoreboard
          digit instead of a generic display font. */}
      <p className="font-led text-shadow-led text-5xl text-accent/60">{number}</p>
      <h3 className="mt-4 text-xl font-semibold text-fg">{title}</h3>
      <p className="mt-3 text-sm text-fg">{body}</p>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-accent/5 blur-2xl transition duration-300 group-hover:bg-accent/15"
      />
    </m.li>
  );
}

export default Landing;
