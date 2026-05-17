// Tier 11 Chunk 2 — GameCard migrated to Card + Badge + tokens. The two
// pick buttons stay as custom-styled <button>s (Button primitive doesn't
// capture the selected/unselected tonal pair) but are tokenized + keep
// their aria-label="Pick {team} to win" contracts that Playwright relies
// on. The `gate('make a pick')` / `gate('undo a pick')` wiring is preserved.

import { scorePick } from '../utils/scoring';
import { useCountdown, useMatchMinute } from '../utils/time';
import CommentThread from './CommentThread';
import { usePicks } from '../hooks/usePicks';
import { useAuthGate } from '../hooks/useAuthGate';
import { Badge } from './ui';

function formatProbability(value) {
  return `${Math.round(value * 100)}%`;
}

function formatDate(dateText) {
  const date = new Date(dateText);
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function scoreEstimate(probability) {
  return `${100 - Math.round(probability * 100)} points if correct`;
}

// Status helpers — prefer the new `status` enum (Tier 4b) but fall back
// to the legacy result/date heuristic so hand-entered games whose status
// stayed at the 'scheduled' default still classify correctly.
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
  return 'Live'; // past-kickoff non-finished fallback (hand-entered legacy)
}

function teamCardClass(side, game) {
  const base = 'rounded-3xl p-4 transition duration-300';
  if (!game.result) return `${base} bg-overlay/70`;
  if (game.result === side) return `${base} border border-success/40 bg-success/10`;
  return `${base} bg-overlay/70 opacity-60`;
}

function hasScores(game) {
  return typeof game.homeScore === 'number' && typeof game.awayScore === 'number';
}

function pickButtonClass(active, side) {
  // Tier 11 Chunk 3 — `py-3.5` (≈48px tap height with text-sm) clears the
  // 44px touch-target floor on mobile. Was `py-3` (≈44px), which was right
  // at the boundary.
  const base =
    'rounded-3xl border px-4 py-3.5 text-sm font-semibold transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50';
  if (active) return `${base} border-accent-soft bg-accent/30 text-fg`;
  if (side === 'home') {
    return `${base} border-accent/20 bg-accent/10 text-accent-soft hover:border-accent-soft hover:bg-accent/20`;
  }
  return `${base} border-strong bg-overlay/90 text-fg hover:border-strong hover:bg-overlay`;
}

function GameCard({ game }) {
  const { pickMap, submitPick, removePick } = usePicks();
  const { gate } = useAuthGate();
  const existingPick = pickMap.get(game.id) || null;
  const live = isLiveGame(game);
  const finished = isFinishedGame(game);
  const upcoming = isUpcomingGame(game);
  const countdown = useCountdown(game.date);
  const liveTime = useMatchMinute(game.date, live, {
    halfTimeReached: game.halfTimeReached,
    phase: game.phase,
  });
  const showScores = hasScores(game) && (live || finished);

  const existingChoice = existingPick?.choice || null;
  const existingPickId = existingPick?.id || null;

  const pickedTeam =
    existingChoice === 'home' ? game.homeTeam : existingChoice === 'away' ? game.awayTeam : null;
  const pointsIfWon =
    game.result && existingChoice ? scorePick({ choice: existingChoice }, game) : 0;

  let outcomeBadge = null;
  if (game.result) {
    if (!existingChoice) {
      outcomeBadge = <Badge tone="neutral">No pick</Badge>;
    } else if (existingChoice === game.result) {
      outcomeBadge = <Badge tone="success">✓ Correct +{pointsIfWon} pts</Badge>;
    } else {
      outcomeBadge = <Badge tone="danger">✗ Missed</Badge>;
    }
  }

  return (
    <div className="group rounded-3xl border border-default bg-elevated/85 p-5 shadow-glow transition duration-300 hover:-translate-y-1 hover:border-accent/40 hover:bg-elevated">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.25em] text-accent/80">
            <span>{formatDate(game.date)}</span>
            {live ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/15 px-2.5 py-0.5 text-danger">
                <span
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-danger"
                  aria-hidden="true"
                />
                Live{liveTime?.label ? ` · ${liveTime.label}` : ''}
              </span>
            ) : (
              <span>{statusLabel(game)}</span>
            )}
            {upcoming ? (
              <span className="rounded-full bg-overlay/60 px-3 py-1 normal-case tracking-normal text-fg">
                Picks lock in {countdown}
              </span>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={teamCardClass('home', game)}>
              <p className="text-sm uppercase tracking-[0.24em] text-fg-muted">Home</p>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <p className="truncate text-xl font-semibold text-fg">{game.homeTeam}</p>
                {showScores ? (
                  <p
                    className="shrink-0 text-3xl font-bold tabular-nums text-fg"
                    aria-label={`Home score ${game.homeScore}`}
                  >
                    {game.homeScore}
                  </p>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-fg-muted">
                Win chance: {formatProbability(game.homeProbability)}
              </p>
            </div>
            <div className={teamCardClass('away', game)}>
              <p className="text-sm uppercase tracking-[0.24em] text-fg-muted">Away</p>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <p className="truncate text-xl font-semibold text-fg">{game.awayTeam}</p>
                {showScores ? (
                  <p
                    className="shrink-0 text-3xl font-bold tabular-nums text-fg"
                    aria-label={`Away score ${game.awayScore}`}
                  >
                    {game.awayScore}
                  </p>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-fg-muted">
                Win chance: {formatProbability(game.awayProbability)}
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-3 text-right">
          {finished ? (
            <>
              <p className="text-sm text-fg-muted">Result</p>
              <p className="text-lg font-semibold text-fg">
                {game.result === 'home'
                  ? `${game.homeTeam} won`
                  : game.result === 'away'
                    ? `${game.awayTeam} won`
                    : 'Draw'}
              </p>
              <div className="flex justify-end">{outcomeBadge}</div>
            </>
          ) : live ? (
            <>
              <p className="text-sm text-fg-muted">Live score</p>
              <p className="text-2xl font-bold tabular-nums text-fg">
                {showScores ? `${game.homeScore} – ${game.awayScore}` : '— – —'}
              </p>
              <p className="text-sm text-fg-subtle">
                Your pick: {pickedTeam || 'None'} · picks locked
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-fg-muted">Potential reward</p>
              <p className="text-lg font-semibold text-fg">
                {scoreEstimate(game.homeProbability)} / {scoreEstimate(game.awayProbability)}
              </p>
              <p className="text-sm text-fg-subtle">Your pick: {pickedTeam || 'None'}</p>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={pickButtonClass(existingChoice === 'home', 'home')}
          disabled={!upcoming}
          onClick={() => {
            if (!gate('make a pick')) return;
            submitPick(game.id, 'home');
          }}
          aria-label={`Pick ${game.homeTeam} to win`}
        >
          Pick {game.homeTeam}
        </button>
        <button
          type="button"
          className={pickButtonClass(existingChoice === 'away', 'away')}
          disabled={!upcoming}
          onClick={() => {
            if (!gate('make a pick')) return;
            submitPick(game.id, 'away');
          }}
          aria-label={`Pick ${game.awayTeam} to win`}
        >
          Pick {game.awayTeam}
        </button>
      </div>

      {upcoming && existingPickId ? (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => {
              if (!gate('undo a pick')) return;
              removePick(existingPickId);
            }}
            className="rounded-2xl px-3 py-2 text-xs text-fg-muted transition-colors duration-200 hover:bg-overlay/60 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Undo pick
          </button>
        </div>
      ) : null}

      <CommentThread gameId={game.id} />
    </div>
  );
}

export default GameCard;
