import { useState } from 'react';
import { scorePick, expectedWinPoints, expectedDrawPoints } from '../utils/scoring';
import { displayTeamName } from '../utils/teamNames';
import { useCountdown, useMatchMinute } from '../utils/time';
import CommentThread from './CommentThread';
import ConfirmModal from './ConfirmModal';
import { usePicks } from '../hooks/usePicks';
import { useAuthGate } from '../hooks/useAuthGate';
import { Badge } from './ui';

function formatDate(dateText) {
  const date = new Date(dateText);
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
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
  const base =
    'rounded-3xl border px-4 py-3.5 text-sm font-semibold transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50';
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
          <p
            className="text-4xl font-extrabold tabular-nums tracking-tight text-fg sm:text-5xl"
            aria-label={`Score ${game.homeScore} to ${game.awayScore}`}
          >
            <span className={leadingSide === 'home' ? 'text-accent' : ''}>{game.homeScore}</span>
            <span className="px-2 text-fg-subtle" aria-hidden="true">
              -
            </span>
            <span className={leadingSide === 'away' ? 'text-accent' : ''}>{game.awayScore}</span>
          </p>
        ) : live ? (
          <p
            className="text-4xl font-extrabold tabular-nums tracking-tight text-fg-muted sm:text-5xl"
            aria-label="Awaiting first score"
          >
            <span>-</span>
            <span className="px-2 text-fg-subtle" aria-hidden="true">
              -
            </span>
            <span>-</span>
          </p>
        ) : (
          <>
            <p className="text-sm font-bold tabular-nums tracking-tight text-fg sm:text-3xl">
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

function PayoutMatrix({ game }) {
  const homeWin = expectedWinPoints('home', game);
  const awayWin = expectedWinPoints('away', game);
  const homeDraw = expectedDrawPoints('home', game);
  const awayDraw = expectedDrawPoints('away', game);
  // `+x` / `+y` are visible placeholders until the draw-scoring tier writes
  // game.drawProbability. They resolve to real numbers automatically.
  const homeDrawDisplay = homeDraw === null ? '+x' : `+${homeDraw}`;
  const awayDrawDisplay = awayDraw === null ? '+y' : `+${awayDraw}`;

  const labelClass =
    'px-2 text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-fg-muted';
  const valueClass = 'text-base font-semibold tabular-nums text-fg sm:text-lg';

  return (
    <div className="mt-5 rounded-2xl bg-overlay/70 p-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
        <p className={valueClass}>+{homeWin}</p>
        <p className={labelClass}>Win</p>
        <p className={`${valueClass} text-right`}>+{awayWin}</p>
        <p className={`${valueClass} mt-1`}>{homeDrawDisplay}</p>
        <p className={`${labelClass} mt-1`}>Draw</p>
        <p className={`${valueClass} mt-1 text-right`}>{awayDrawDisplay}</p>
      </div>
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
  const existingPick = pickMap.get(game.id) || null;
  const live = isLiveGame(game);
  const finished = isFinishedGame(game);
  const upcoming = isUpcomingGame(game);
  const isHalted = game.status === 'cancelled' || game.status === 'postponed';
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

      {upcoming ? <PayoutMatrix game={game} /> : null}

      {upcoming ? (
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
          {existingPickId ? (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={handleUndoClick}
                className="rounded-2xl px-3 py-2 text-xs text-fg-muted transition-colors duration-200 hover:bg-overlay/60 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Undo pick
              </button>
            </div>
          ) : null}
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
