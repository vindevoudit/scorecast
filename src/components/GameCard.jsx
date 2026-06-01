import { useState } from 'react';
import { scorePick, expectedWinPoints, expectedDrawPoints } from '../utils/scoring';
import { displayTeamName, isPlaceholderGame } from '../utils/teamNames';
import { useCountdown, useMatchMinute } from '../utils/time';
import CommentThread from './CommentThread';
import FriendPicksPanel from './FriendPicksPanel';
import ConfirmModal from './ConfirmModal';
import { usePicks } from '../hooks/usePicks';
import { useAuthGate } from '../hooks/useAuthGate';
import { useNotifications } from '../hooks/useNotifications';
import { Badge } from './ui';
import { m, AnimatePresence, useReducedMotion } from '../lib/motion';
import { scoreboardFlip } from '../lib/motionVariants';

// Tier 30 Phase 3 A4 — direct share without a confirmation dialog.
// captureAndShare dynamically imports html-to-image + react-dom/client +
// ShareableCard so the dependency chunks only load on first share. The
// imperative createRoot dance mounts the capture-source off-screen,
// snapshots it, then unmounts — no modal, no extra render commit on
// the host GameCard.
async function captureAndShare({ game, choice, points, ratio }) {
  const [{ createRoot }, ShareableCardModule, shareLib] = await Promise.all([
    import('react-dom/client'),
    import('./ShareableCard'),
    import('../lib/share'),
  ]);
  const ShareableCard = ShareableCardModule.default;
  const { captureNodeToPng, shareBlob } = shareLib;

  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; top: 0; left: -20000px; pointer-events: none; opacity: 0;';
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `width: 1080px; height: ${ratio === 'story' ? 1920 : 1080}px;`;
  host.appendChild(wrapper);
  document.body.appendChild(host);

  const root = createRoot(wrapper);
  try {
    root.render(<ShareableCard game={game} choice={choice} points={points} ratio={ratio} />);
    // Give React one commit + the browser one paint frame before snapshot
    // so html-to-image sees the fully-resolved layout.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // CRITICAL: wait for Orbitron to actually finish downloading before the
    // raster. Browsers lazy-load web fonts when glyphs first hit the layout
    // tree, and html-to-image will snapshot whatever the browser is painting
    // at that instant — which is Courier New (the fallback in our font stack)
    // until Orbitron lands. Two RAFs cover paint, not font load. Explicit
    // `document.fonts.load` for every weight the ShareableCard uses kicks
    // off + awaits the fetches; the trailing `document.fonts.ready` is a
    // belt-and-suspenders settle that catches any weight we missed.
    if (typeof document !== 'undefined' && document.fonts?.load) {
      await Promise.all([
        document.fonts.load("500 38px 'Orbitron'"),
        document.fonts.load("600 28px 'Orbitron'"),
        document.fonts.load("600 36px 'Orbitron'"),
        document.fonts.load("700 56px 'Orbitron'"),
        document.fonts.load("800 88px 'Orbitron'"),
        document.fonts.load("800 160px 'Orbitron'"),
        document.fonts.load("900 56px 'Orbitron'"),
      ]).catch(() => {});
      if (document.fonts.ready) await document.fonts.ready;
    }
    const blob = await captureNodeToPng(wrapper);
    const pickedTeam = choice === 'home' ? game.homeTeam : game.awayTeam;
    const text = choice
      ? `I picked ${pickedTeam} for ${game.homeTeam} vs ${game.awayTeam} on Bantryx.`
      : 'Bantryx — predict, compete, climb.';
    return shareBlob(blob, {
      filename: `bantryx-${game.id}-${ratio}.png`,
      title: 'Bantryx pick',
      text,
      url: typeof window !== 'undefined' ? window.location.origin : 'https://bantryx.com',
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

// Inline SVG icons — Lucide-style strokes. Keep currentColor so the
// icon picks up the surrounding text colour and theme tokens through
// CSS like every other icon in the codebase.
function ShareIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function UndoIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
    </svg>
  );
}

function formatDate(dateText) {
  // Date-only — the kickoff time is already shown prominently in the
  // ScoreboardBody (the large `.font-led` `Kickoff` block), so repeating
  // it in the header just produces noise like "May 31, 2026 at 6:00 PM".
  // `dateStyle: 'medium'` renders the date cleanly across locales
  // ("May 31, 2026" en-US, "31 May 2026" en-GB) without the locale's
  // "at" / "," date-time joiner.
  const date = new Date(dateText);
  return date.toLocaleDateString([], { dateStyle: 'medium' });
}

function formatKickoffTime(dateText) {
  return new Date(dateText).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isLiveGame(game) {
  return game.status === 'in-progress';
}
function isFinishedGame(game) {
  return game.status === 'finished' || Boolean(game.result);
}
function isUpcomingGame(game) {
  if (isLiveGame(game) || isFinishedGame(game)) return false;
  if (game.status === 'postponed' || game.status === 'cancelled') return false;
  return new Date(game.date) > new Date();
}

function statusLabel(game) {
  if (game.status === 'cancelled') return 'Cancelled';
  if (game.status === 'postponed') return 'Postponed';
  if (isFinishedGame(game)) return 'Final';
  if (isLiveGame(game)) return 'Live';
  if (isUpcomingGame(game)) return 'Upcoming';
  return 'Live';
}

function hasScores(game) {
  return typeof game.homeScore === 'number' && typeof game.awayScore === 'number';
}

function pickButtonClass(active) {
  // No CSS transition on the active/inactive swap — combined with the
  // optimistic update in DataContext.submitPick, the button flips state
  // the instant the user taps. The hover styles still get Tailwind's
  // default 150 ms ease on desktop because they're applied through
  // `hover:` variants (CSS native), not through this state class swap.
  const base =
    'rounded-3xl border px-4 py-3.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50';
  if (active) return `${base} border-accent-soft bg-accent/30 text-fg`;
  return `${base} border-accent/20 bg-accent/10 text-accent-soft hover:border-accent-soft hover:bg-accent/20`;
}

function cardShellClass(live) {
  const base =
    'group rounded-3xl border bg-elevated/85 p-5 shadow-glow transition duration-300 hover:-translate-y-1 hover:bg-elevated';
  if (live) return `${base} border-danger/30 ring-1 ring-danger/15 hover:border-danger/50`;
  return `${base} border-default hover:border-accent/40`;
}

function ScoreboardHeader({
  game,
  live,
  finished,
  upcoming,
  isHalted,
  countdown,
  liveTime,
  outcomeBadge,
  pickedTeam,
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-accent/80">
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/15 px-3 py-1 text-danger">
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger"
              aria-hidden="true"
            />
            Live{liveTime?.label ? ` · ${liveTime.label}` : ''}
          </span>
        ) : (
          <>
            <span className="text-fg-muted">{formatDate(game.date)}</span>
            <span className="text-fg-subtle" aria-hidden="true">
              ·
            </span>
            <span>{statusLabel(game)}</span>
          </>
        )}
      </div>
      <div className="flex items-center">
        {finished && outcomeBadge}
        {live ? (
          <span className="rounded-full bg-overlay/70 px-3 py-1 text-[11px] font-medium normal-case tracking-normal text-fg-muted">
            {pickedTeam ? (
              <>
                Your pick: <span className="text-fg">{pickedTeam}</span>
              </>
            ) : (
              'No pick'
            )}
          </span>
        ) : null}
        {upcoming ? (
          <span className="rounded-full bg-overlay/60 px-3 py-1 text-[11px] font-medium normal-case tracking-normal text-fg">
            {pickedTeam ? (
              <>
                Your pick: <span className="text-fg">{pickedTeam}</span> · locks in {countdown}
              </>
            ) : (
              <>Picks lock in {countdown}</>
            )}
          </span>
        ) : null}
        {isHalted ? (
          <Badge tone={game.status === 'cancelled' ? 'danger' : 'warning'}>
            {statusLabel(game)}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

// Tier 30 Phase 2 — scoreboard digit tile. Each side's score sits on a
// `bg-overlay/60` rounded plate with the `.font-led` (Orbitron + tabular-
// nums) treatment + a subtle `shadow-led` inner glow. When the score
// changes the inner `<m.span key={score}>` rotates out on the X axis as
// the next digit rotates in — `AnimatePresence mode="popLayout"` makes
// the swap visually continuous. `initial={false}` suppresses the
// animation on first mount so a static card doesn't flash on render.
// Tier 30 Phase 2 follow-up — on mobile (or prefers-reduced-motion) the
// AnimatePresence wrapper is skipped entirely; the digit renders as a
// plain span. Motion overhead is unnecessary at the small screen sizes
// where the user reported lag.
function ScoreTile({ score, highlight }) {
  const reduceMotion = useReducedMotion();
  const colorClass = highlight ? 'text-accent' : 'text-fg';
  const tileClass = `font-led inline-flex h-12 min-w-[2.75rem] items-center justify-center overflow-hidden rounded-lg bg-overlay/60 px-2 text-3xl tabular-nums shadow-led sm:h-14 sm:min-w-[3.25rem] sm:text-4xl ${colorClass}`;
  if (reduceMotion) {
    return <span className={tileClass}>{score}</span>;
  }
  return (
    <span className={tileClass}>
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span key={String(score)} {...scoreboardFlip} className="inline-block">
          {score}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

function ScoreboardBody({ game, live, finished, isHalted }) {
  const showScores = hasScores(game) && (live || finished);
  const leadingSide =
    live && showScores
      ? game.homeScore > game.awayScore
        ? 'home'
        : game.awayScore > game.homeScore
          ? 'away'
          : null
      : null;
  // Narrow to home/away so the draw case leaves both sides un-dimmed and
  // un-ringed (a draw has no winning side; the outcome badge + locked-pick
  // chip carry the "Drew +N pts" framing instead).
  const winningSide =
    finished && (game.result === 'home' || game.result === 'away') ? game.result : null;

  const teamBoxClass = (side, alignRight = false) => {
    const base = `min-w-0 rounded-2xl px-2 py-2.5 transition sm:px-3 ${alignRight ? 'text-right' : ''}`;
    if (winningSide === side) return `${base} ring-1 ring-success/40 bg-success/5`;
    if (winningSide && winningSide !== side) return `${base} opacity-60`;
    return base;
  };

  const secondaryLine = (side) => {
    if (winningSide === side) {
      return <span className="text-success">Winner</span>;
    }
    return null;
  };

  return (
    <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
      <div className={teamBoxClass('home')}>
        <p className="break-words text-sm font-bold leading-tight text-fg [text-wrap:balance] sm:text-lg">
          {displayTeamName(game.homeTeam)}
        </p>
        {secondaryLine('home') ? (
          <p className="mt-1.5 text-xs font-semibold uppercase tracking-wider">
            {secondaryLine('home')}
          </p>
        ) : null}
      </div>

      <div className="px-1 text-center sm:px-3">
        {isHalted ? (
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-fg-muted">
            {statusLabel(game)}
          </p>
        ) : showScores ? (
          <div
            className="flex items-center justify-center gap-2 sm:gap-3"
            aria-label={`Score ${game.homeScore} to ${game.awayScore}`}
          >
            <ScoreTile score={game.homeScore} highlight={leadingSide === 'home'} />
            <span className="text-2xl text-fg-subtle sm:text-3xl" aria-hidden="true">
              -
            </span>
            <ScoreTile score={game.awayScore} highlight={leadingSide === 'away'} />
          </div>
        ) : live ? (
          <div
            className="flex items-center justify-center gap-2 sm:gap-3"
            aria-label="Awaiting first score"
          >
            <ScoreTile score="–" />
            <span className="text-2xl text-fg-subtle sm:text-3xl" aria-hidden="true">
              -
            </span>
            <ScoreTile score="–" />
          </div>
        ) : (
          <>
            {/* Kickoff time matches the team-name typography (text-sm
                sm:text-lg, font-bold) so the three middle-row elements
                read as a balanced triplet rather than the time
                dominating. .font-led keeps the digital readout feel
                without inflating the size. */}
            <p className="font-led text-sm font-bold tabular-nums tracking-tight text-fg sm:text-lg">
              {formatKickoffTime(game.date)}
            </p>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-fg-subtle sm:text-[10px] sm:tracking-[0.3em]">
              Kickoff
            </p>
          </>
        )}
      </div>

      <div className={teamBoxClass('away', true)}>
        <p className="break-words text-sm font-bold leading-tight text-fg [text-wrap:balance] sm:text-lg">
          {displayTeamName(game.awayTeam)}
        </p>
        {secondaryLine('away') ? (
          <p className="mt-1.5 text-xs font-semibold uppercase tracking-wider">
            {secondaryLine('away')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// Tier 30 Phase 3 A3 — voice-of-the-crowd indicator. The `crowd` field
// is server-gated: only present when the viewer has already picked OR
// the game has locked (status !== 'scheduled'), so this component can
// render unconditionally. Hidden when there are no picks yet.
function CrowdMeter({ crowd }) {
  if (!crowd || !crowd.total) return null;
  const total = crowd.total;
  const homePct = Math.round((crowd.home / total) * 100);
  // Force the bar to sum to exactly 100 even after rounding so the
  // segments meet without a sliver of background showing through.
  const awayPct = 100 - homePct;
  return (
    <div className="mt-4 rounded-2xl border border-default bg-overlay/40 px-3 py-2.5">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
        <span>Wisdom of the crowd</span>
        <span className="tabular-nums">
          {total.toLocaleString()} pick{total === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-2 flex h-7 overflow-hidden rounded-full bg-overlay/60">
        <div
          className="flex items-center justify-start px-2 text-[11px] font-bold tabular-nums text-fg"
          style={{ width: `${homePct}%`, background: 'rgb(var(--c-accent) / 0.45)' }}
          aria-label={`Home ${homePct}%`}
        >
          {homePct >= 12 ? `${homePct}%` : null}
        </div>
        <div
          className="ml-auto flex items-center justify-end px-2 text-[11px] font-bold tabular-nums text-fg"
          style={{ width: `${awayPct}%`, background: 'rgb(var(--c-warning) / 0.35)' }}
          aria-label={`Away ${awayPct}%`}
        >
          {awayPct >= 12 ? `${awayPct}%` : null}
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] font-medium text-fg-muted">
        <span>Home</span>
        <span>Away</span>
      </div>
    </div>
  );
}

function PayoutMatrix({ game }) {
  const homeWin = expectedWinPoints('home', game);
  const awayWin = expectedWinPoints('away', game);
  const homeDraw = expectedDrawPoints('home', game);
  const awayDraw = expectedDrawPoints('away', game);
  // `+x` / `+y` are visible placeholders until the draw-scoring tier writes
  // game.drawProbability. They resolve to real numbers automatically.
  const homeDrawDisplay = homeDraw === null ? '+x' : `+${homeDraw}`;
  const awayDrawDisplay = awayDraw === null ? '+y' : `+${awayDraw}`;

  // Tier 30 Phase 2 — scoreboard-grid restyle. The 6 payout cells sit on
  // `bg-overlay/70` plates separated by 1 px `bg-divider` strips (achieved
  // via `gap-px` against the parent's `bg-divider`). Each value uses the
  // `.font-led` digit treatment so the grid reads as a stadium broadcast
  // payout board. The dual draw payouts (+x for picking home, +y for
  // picking away) are preserved — collapsing to a single Draw cell would
  // hide the difference in expected value between sides.
  const valueClass = 'font-led tabular-nums text-base text-fg sm:text-lg';
  const labelClass =
    'flex items-center justify-center px-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-fg-muted';

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-default bg-divider">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-px">
        <div className="bg-overlay/70 px-3 py-2.5 text-center">
          <p className={valueClass}>+{homeWin}</p>
        </div>
        <div className={`bg-overlay/70 ${labelClass}`}>Win</div>
        <div className="bg-overlay/70 px-3 py-2.5 text-center">
          <p className={valueClass}>+{awayWin}</p>
        </div>
        <div className="bg-overlay/70 px-3 py-2.5 text-center">
          <p className={valueClass}>{homeDrawDisplay}</p>
        </div>
        <div className={`bg-overlay/70 ${labelClass}`}>Draw</div>
        <div className="bg-overlay/70 px-3 py-2.5 text-center">
          <p className={valueClass}>{awayDrawDisplay}</p>
        </div>
      </div>
      {/* Tier 19 Chunk 5 — the payout numbers above are the model's current
          read, NOT what the user has locked. Every pick on the same game
          re-snaps to the game's probabilities at kickoff, so the
          displayed payout will be what actually scores for whoever picks
          this side — regardless of when in the week they picked. */}
      <p className="bg-overlay/40 px-3 py-2 text-center text-[10px] font-medium normal-case tracking-normal text-fg-muted">
        Points allocation locks in at kickoff.
      </p>
    </div>
  );
}

function LockedPickChip({
  live,
  pickedTeam,
  existingChoice,
  game,
  pointsIfWon,
  potentialPoints,
  oddsShiftedHint,
}) {
  let suffix = null;
  if (live) {
    suffix = `locked · ${potentialPoints} pts on the line`;
  } else if (game.result === 'draw') {
    suffix = `drew · +${pointsIfWon} pts`;
  } else if (game.result === null) {
    // Legacy pre-tier draws (status=finished but result was never set).
    suffix = 'drew';
  } else if (game.result === existingChoice) {
    suffix = `won · +${pointsIfWon} pts`;
  } else {
    suffix = 'lost';
  }

  return (
    <div className="mt-5 border-t border-default pt-3 text-center text-[11px] font-semibold uppercase tracking-[0.25em]">
      {pickedTeam ? (
        <>
          <span className="text-fg-muted">Your pick: </span>
          <span className="text-fg">{pickedTeam}</span>
          <span className="text-fg-subtle"> · {suffix}</span>
          {oddsShiftedHint ? (
            <div className="mt-1 text-[10px] font-medium normal-case tracking-normal text-fg-muted">
              {oddsShiftedHint}
            </div>
          ) : null}
        </>
      ) : (
        <span className="text-fg-subtle">No pick made</span>
      )}
    </div>
  );
}

function GameCard({ game }) {
  const { pickMap, submitPick, removePick } = usePicks();
  const { gate } = useAuthGate();
  const { showStatus } = useNotifications();
  // null when idle, 'square' or 'story' while a capture+share is in flight.
  // Doubles as the disabled flag on both share buttons.
  const [sharing, setSharing] = useState(null);
  const existingPick = pickMap.get(game.id) || null;
  const live = isLiveGame(game);
  const finished = isFinishedGame(game);
  const upcoming = isUpcomingGame(game);
  const isHalted = game.status === 'cancelled' || game.status === 'postponed';
  // Placeholder games are knockout-stage fixtures whose participants haven't
  // advanced yet — football-data.org returns "TBD" / "Winner of QF1" / etc.
  // until the bracket resolves. Cascade leaves them at the sentinel
  // (0.50, 0.00, 0.50) by design (CLAUDE.md "intl-model"). On the GameCard
  // we hide the payout matrix + disable pick buttons until real teams + real
  // probabilities populate, so the user isn't tempted to commit a pick
  // against a meaningless 50/50 fixture.
  const isPlaceholder = isPlaceholderGame(game);
  const countdown = useCountdown(game.date);
  const liveTime = useMatchMinute(game.date, live, {
    halfTimeReached: game.halfTimeReached,
    phase: game.phase,
  });

  const existingChoice = existingPick?.choice || null;
  const existingPickId = existingPick?.id || null;

  const pickedTeam =
    existingChoice === 'home'
      ? displayTeamName(game.homeTeam)
      : existingChoice === 'away'
        ? displayTeamName(game.awayTeam)
        : null;
  // Pass the full existingPick (not a synthesized {choice} stub) so scorePick
  // honors the pick-time snapshot when present. Legacy NULL-snapshot picks
  // fall through to game.* via the all-or-nothing read in scoring.js.
  const pointsIfWon = game.result && existingPick ? scorePick(existingPick, game) : 0;
  const potentialPoints = existingPick
    ? scorePick(existingPick, { ...game, result: existingPick.choice })
    : 0;

  // Locked vs current payout for the user's chosen side. `lockedPayout` is
  // null on legacy NULL-snapshot picks (nothing to compare against, so no
  // "odds shifted" hint and no undo warning fires). currentPayout always
  // computable from game.*.
  const usesSnapshot = existingPick?.pickedHomeProbability != null;
  const lockedPayout = usesSnapshot
    ? Math.round(
        (1 -
          parseFloat(
            existingChoice === 'home'
              ? existingPick.pickedHomeProbability
              : existingPick.pickedAwayProbability,
          )) *
          100,
      )
    : null;
  const currentPayout = existingChoice ? expectedWinPoints(existingChoice, game) : null;
  const oddsShifted =
    lockedPayout != null && currentPayout != null && lockedPayout !== currentPayout;
  // Hint shown under the chip on live games — informational only. Skip on
  // finished games (the outcome is settled; comparing to "current" is noise)
  // and on draws (chip's "drew +N pts" already tells the locked story).
  const oddsShiftedHint = oddsShifted && live ? `Current odds would pay +${currentPayout}` : null;

  const [confirmingUndo, setConfirmingUndo] = useState(false);

  let outcomeBadge = null;
  if (game.result) {
    if (!existingChoice) {
      outcomeBadge = <Badge tone="neutral">No pick</Badge>;
    } else if (game.result === 'draw') {
      outcomeBadge = <Badge tone="warning">Drew +{pointsIfWon} pts</Badge>;
    } else if (existingChoice === game.result) {
      outcomeBadge = <Badge tone="success">✓ Correct +{pointsIfWon} pts</Badge>;
    } else {
      outcomeBadge = <Badge tone="danger">✗ Missed</Badge>;
    }
  }

  function handleUndoClick() {
    if (!gate('undo a pick')) return;
    // Only warn when re-picking right now would pay strictly less. If locked
    // is null (legacy) or locked <= current, undoing isn't a downgrade — fire
    // immediately.
    if (lockedPayout != null && currentPayout != null && lockedPayout > currentPayout) {
      setConfirmingUndo(true);
    } else {
      removePick(existingPickId);
    }
  }

  async function handleShare(ratio) {
    if (sharing) return;
    setSharing(ratio);
    try {
      const result = await captureAndShare({
        game,
        choice: existingChoice,
        points: pointsIfWon,
        ratio,
      });
      if (result.method === 'shared') showStatus('Shared');
      else if (result.method === 'downloaded') showStatus('Image saved');
      // cancelled → no toast (user chose to back out)
    } catch (err) {
      showStatus("Couldn't generate the image — try again");
      console.error('share failed', err);
    } finally {
      setSharing(null);
    }
  }

  return (
    <div className={cardShellClass(live)}>
      <ScoreboardHeader
        game={game}
        live={live}
        finished={finished}
        upcoming={upcoming}
        isHalted={isHalted}
        countdown={countdown}
        liveTime={liveTime}
        outcomeBadge={outcomeBadge}
        pickedTeam={pickedTeam}
      />
      <ScoreboardBody game={game} live={live} finished={finished} isHalted={isHalted} />

      {upcoming && !isPlaceholder ? <PayoutMatrix game={game} /> : null}

      {upcoming && isPlaceholder ? (
        <div
          role="status"
          className="mt-5 rounded-2xl border border-default bg-overlay/40 px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted"
        >
          Picks open once both teams advance
        </div>
      ) : null}

      {upcoming && !isPlaceholder ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className={pickButtonClass(existingChoice === 'home')}
              onClick={() => {
                if (!gate('make a pick')) return;
                submitPick(game.id, 'home');
              }}
              aria-label={`Pick ${displayTeamName(game.homeTeam)} to win`}
            >
              Pick {displayTeamName(game.homeTeam)}
            </button>
            <button
              type="button"
              className={pickButtonClass(existingChoice === 'away')}
              onClick={() => {
                if (!gate('make a pick')) return;
                submitPick(game.id, 'away');
              }}
              aria-label={`Pick ${displayTeamName(game.awayTeam)} to win`}
            >
              Pick {displayTeamName(game.awayTeam)}
            </button>
          </div>
        </>
      ) : null}

      {(live || finished) && !isHalted ? (
        <LockedPickChip
          live={live}
          pickedTeam={pickedTeam}
          existingChoice={existingChoice}
          game={game}
          pointsIfWon={pointsIfWon}
          potentialPoints={potentialPoints}
          oddsShiftedHint={oddsShiftedHint}
        />
      ) : null}

      {/* Tier 30 Phase 3 A4 (revised) — action row. Share (Square,
          default) + a small Instagram-glyph button that goes straight
          to Story format live in the left cluster; Undo (only on
          upcoming with a pick) sits in the right cluster so the icons
          face their natural directions (share-up on left, undo-back on
          right). No dialog — captureAndShare resolves to navigator.share
          on mobile or a PNG download on desktop. */}
      {existingPickId ? (
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => handleShare('story')}
            disabled={Boolean(sharing)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-default bg-overlay/40 px-3.5 text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            aria-label="Share this pick as an image"
          >
            <ShareIcon />
            {sharing ? 'Sharing…' : 'Share'}
          </button>
          {upcoming ? (
            <button
              type="button"
              onClick={handleUndoClick}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-default bg-overlay/40 px-3.5 text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted transition hover:border-danger/40 hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Undo this pick"
            >
              Undo
              <UndoIcon />
            </button>
          ) : null}
        </div>
      ) : null}

      <CrowdMeter crowd={game.crowd} />

      <FriendPicksPanel game={game} />

      {/* CommentThread self-separates with its own `mt-4 border-t pt-4`
          root, so an additional wrapper here would stack a redundant
          divider directly below FriendPicksPanel's identical
          `border-t pt-3` — that's where the dead-space gap used to come
          from. Render bare. */}
      <CommentThread gameId={game.id} />

      <ConfirmModal
        open={confirmingUndo}
        title="Undo your pick?"
        description={
          lockedPayout != null && currentPayout != null
            ? `Your locked-in payout for this pick is +${lockedPayout} pts. The current odds would only give +${currentPayout} pts if you re-pick. Continue with undo?`
            : 'Continue with undo?'
        }
        confirmLabel="Undo anyway"
        cancelLabel="Keep my pick"
        onConfirm={() => {
          setConfirmingUndo(false);
          removePick(existingPickId);
        }}
        onCancel={() => setConfirmingUndo(false)}
      />
    </div>
  );
}

export default GameCard;
