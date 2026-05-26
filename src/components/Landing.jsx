// Tier 11 Chunk 2 — Landing tokenized. The BANTRYX wordmark uses the
// `text-shadow-brand-glow` utility from index.css (so light mode dials the
// bloom down via tokens) rather than the inline three-layer style.

import { Button } from './ui';
import Footer from './Footer';

const FEATURES = [
  {
    icon: '🎯',
    title: 'Probability-weighted scoring',
    body: 'Underdog wins are worth more than favorite wins. A 38% upset pays +62 points; a 52% home win pays +48. Pick smart, not safe.',
  },
  {
    icon: '👥',
    title: 'Private groups & friends',
    body: 'Spin up an invite-only league for your group chat. Track friends, send requests, and race to the top of your own leaderboard.',
  },
  {
    icon: '🏆',
    title: 'Live leaderboards',
    body: 'Standings update the moment a match result lands — no waiting until Monday morning. Climb in real time.',
  },
  {
    icon: '🎖️',
    title: 'Badges & milestones',
    body: 'Unlock achievements for streaks, upsets, perfect weekends, and 100-point picks. Bragging rights, codified.',
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

function Landing({ onSignIn, onSignUp, onBrowseAsGuest }) {
  return (
    <div className="space-y-20 pb-12 md:space-y-32">
      <section className="relative overflow-hidden pt-8 md:pt-16">
        {/* Layered atmosphere: arena grid backdrop + two cyan blooms +
            a horizon line that anchors the wordmark on a "field" */}
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
          {/* Kicker — thin spaced-out sans for a refined ticker-tape feel.
              The diamond separators are dimmer than the words for rhythm. */}
          <p
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
          </p>

          <h1 className="text-shadow-brand-glow font-display mt-7 select-none text-[clamp(3.5rem,13vw,9rem)] leading-[0.85] tracking-[0.02em] text-accent-soft">
            BANTRYX
          </h1>

          {/* Slogan: editorial italic serif, framed by short neon accent
              lines. No glow on the text itself — the surrounding lines do
              the brand work so the letters read crisply white. */}
          <div className="mt-7 flex items-center justify-center gap-4">
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
          </div>

          <p className="mx-auto mt-10 max-w-2xl text-lg text-fg sm:text-xl">
            Football prediction made <span className="font-semibold text-fg">social</span>,{' '}
            <span className="font-semibold text-fg">competitive</span>, and{' '}
            <span className="font-semibold text-fg">fun</span>. Pick winners, earn points for risky
            calls and underdog upsets, and climb the live leaderboards against your friends.
          </p>

          <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Button
              variant="primary"
              size="lg"
              onClick={onSignUp}
              className="px-8 py-4 text-base shadow-[0_0_30px_-4px_rgba(34,211,238,0.6)]"
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
          </div>
          {onBrowseAsGuest ? (
            <Button variant="link" onClick={onBrowseAsGuest} className="mt-6 text-sm text-fg-muted">
              Or just browse as a guest →
            </Button>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-default bg-divider sm:grid-cols-3">
          <Stat number="+62" label="points for a 38% underdog upset" />
          <Stat number="∞" label="private groups you can build" />
          <Stat number="30s" label="from sign-up to first pick" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4">
        <SectionHeader
          eyebrow="Why Bantryx"
          title="Built for people who don't just want to pick — they want to win."
        />
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
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

function Stat({ number, label }) {
  return (
    <div className="bg-elevated/85 p-8 text-center">
      <p className="text-shadow-brand-glow text-4xl font-black text-accent-soft sm:text-5xl">
        {number}
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
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-default bg-elevated/60 p-8 transition duration-300 hover:border-accent/30 hover:bg-elevated/85">
      <div className="flex items-center gap-3">
        <span className="text-3xl" aria-hidden="true">
          {icon}
        </span>
        <h3 className="text-xl font-semibold text-fg">{title}</h3>
      </div>
      <p className="mt-4 text-fg">{body}</p>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-accent/5 blur-2xl transition duration-300 group-hover:bg-accent/15"
      />
    </div>
  );
}

function Step({ number, title, body }) {
  return (
    <li className="rounded-3xl border border-default bg-elevated/50 p-8">
      <p className="text-5xl font-black text-accent/40">{number}</p>
      <h3 className="mt-4 text-xl font-semibold text-fg">{title}</h3>
      <p className="mt-3 text-sm text-fg">{body}</p>
    </li>
  );
}

export default Landing;
