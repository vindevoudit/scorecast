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

const STRONG_GLOW = {
  textShadow:
    '0 0 30px rgba(56, 189, 248, 0.85), 0 0 70px rgba(56, 189, 248, 0.55), 0 0 120px rgba(56, 189, 248, 0.3)',
};

const SOFT_GLOW = { textShadow: '0 0 24px rgba(56, 189, 248, 0.4)' };

const STEP_GLOW = { textShadow: '0 0 30px rgba(56, 189, 248, 0.25)' };

function Landing({ onSignIn, onSignUp, onBrowseAsGuest }) {
  return (
    <div className="space-y-20 pb-12 md:space-y-32">
      <section className="relative pt-8 md:pt-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/4 top-0 -z-10 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-1/4 top-24 -z-10 h-96 w-96 rounded-full bg-sky-600/10 blur-3xl"
        />

        <div className="relative z-10 mx-auto max-w-4xl px-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.5em] text-cyan-400/80">
            Predict · Compete · Climb
          </p>
          <h1
            className="mt-6 select-none text-[clamp(3.25rem,12vw,8rem)] font-black uppercase leading-[0.95] tracking-[0.04em] text-cyan-50"
            style={STRONG_GLOW}
          >
            BANTRYX
          </h1>
          <p className="mt-5 text-sm italic tracking-[0.08em] text-cyan-200/80 sm:text-base">
            no betting, just Bantryx
          </p>
          <p className="mx-auto mt-8 max-w-2xl text-lg text-slate-300 sm:text-xl">
            Football prediction made <span className="font-semibold text-white">social</span>,{' '}
            <span className="font-semibold text-white">competitive</span>, and{' '}
            <span className="font-semibold text-white">fun</span>. Pick winners, earn points for
            risky calls and underdog upsets, and climb the live leaderboards against your friends.
          </p>
          <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onSignUp}
              className="rounded-3xl bg-cyan-400 px-8 py-4 text-base font-semibold text-slate-950 shadow-[0_20px_50px_rgba(56,189,248,0.25)] transition duration-200 hover:bg-cyan-300 hover:shadow-[0_24px_60px_rgba(56,189,248,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              Get started — it's free
            </button>
            <button
              type="button"
              onClick={onSignIn}
              className="rounded-3xl border border-slate-700 bg-slate-900/80 px-8 py-4 text-base font-semibold text-cyan-300 transition duration-200 hover:border-slate-500 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Sign in
            </button>
          </div>
          {onBrowseAsGuest && (
            <button
              type="button"
              onClick={onBrowseAsGuest}
              className="mt-6 text-sm font-medium text-slate-400 underline-offset-4 transition duration-200 hover:text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Or just browse as a guest →
            </button>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-slate-800 bg-slate-800 sm:grid-cols-3">
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
        <div className="rounded-3xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-slate-900/40 to-slate-950/40 p-10 text-center shadow-[0_30px_80px_rgba(6,182,212,0.18)] md:p-14">
          <h2 className="text-3xl font-semibold text-white sm:text-4xl">
            Ready to outpick your group chat?
          </h2>
          <p className="mt-4 text-slate-300">Sign up, pick a side, and let the math do the rest.</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              type="button"
              onClick={onSignUp}
              className="rounded-3xl bg-cyan-400 px-8 py-4 text-base font-semibold text-slate-950 transition duration-200 hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Create your account
            </button>
            <button
              type="button"
              onClick={onSignIn}
              className="text-sm font-semibold text-cyan-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Or sign in →
            </button>
          </div>
          {onBrowseAsGuest && (
            <button
              type="button"
              onClick={onBrowseAsGuest}
              className="mt-6 text-xs font-medium text-slate-400 underline-offset-4 transition duration-200 hover:text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Just browsing? Continue as a guest →
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ number, label }) {
  return (
    <div className="bg-slate-900/85 p-8 text-center">
      <p className="text-4xl font-black text-cyan-50 sm:text-5xl" style={SOFT_GLOW}>
        {number}
      </p>
      <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
    </div>
  );
}

function SectionHeader({ eyebrow, title }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.4em] text-cyan-400/80">{eyebrow}</p>
      <h2 className="mt-4 text-3xl font-semibold leading-tight text-white sm:text-4xl">{title}</h2>
    </div>
  );
}

function FeatureCard({ icon, title, body }) {
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/60 p-8 transition duration-300 hover:border-cyan-500/30 hover:bg-slate-900/85">
      <div className="flex items-center gap-3">
        <span className="text-3xl" aria-hidden="true">
          {icon}
        </span>
        <h3 className="text-xl font-semibold text-white">{title}</h3>
      </div>
      <p className="mt-4 text-slate-300">{body}</p>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-cyan-500/5 blur-2xl transition duration-300 group-hover:bg-cyan-500/15"
      />
    </div>
  );
}

function Step({ number, title, body }) {
  return (
    <li className="rounded-3xl border border-slate-800 bg-slate-900/50 p-8">
      <p className="text-5xl font-black text-cyan-400/40" style={STEP_GLOW}>
        {number}
      </p>
      <h3 className="mt-4 text-xl font-semibold text-white">{title}</h3>
      <p className="mt-3 text-sm text-slate-300">{body}</p>
    </li>
  );
}

export default Landing;
