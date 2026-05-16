// Tier 11 Chunk 2 — GameCard migrated to Card + Badge + tokens. The two
// pick buttons stay as custom-styled <button>s (Button primitive doesn't
// capture the selected/unselected tonal pair) but are tokenized + keep
// their aria-label="Pick {team} to win" contracts that Playwright relies
// on. The `gate('make a pick')` / `gate('undo a pick')` wiring is preserved.

import { scorePick } from '../utils/scoring';
import { useCountdown } from '../utils/time';
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

function isUpcomingGame(game) {
  return !game.result && new Date(game.date) > new Date();
}

function statusLabel(game, upcoming) {
  if (game.result) return 'Final';
  if (upcoming) return 'Upcoming';
  return 'Live';
}

function teamCardClass(side, game) {
  const base = 'rounded-3xl p-4 transition duration-300';
  if (!game.result) return `${base} bg-overlay/70`;
  if (game.result === side) return `${base} border border-success/40 bg-success/10`;
  return `${base} bg-overlay/70 opacity-60`;
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
  const upcoming = isUpcomingGame(game);
  const countdown = useCountdown(game.date);

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
            <span>{statusLabel(game, upcoming)}</span>
            {upcoming ? (
              <span className="rounded-full bg-overlay/60 px-3 py-1 normal-case tracking-normal text-fg">
                Picks lock in {countdown}
              </span>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={teamCardClass('home', game)}>
              <p className="text-sm uppercase tracking-[0.24em] text-fg-muted">Home</p>
              <p className="mt-3 truncate text-xl font-semibold text-fg">{game.homeTeam}</p>
              <p className="mt-2 text-sm text-fg-muted">
                Win chance: {formatProbability(game.homeProbability)}
              </p>
            </div>
            <div className={teamCardClass('away', game)}>
              <p className="text-sm uppercase tracking-[0.24em] text-fg-muted">Away</p>
              <p className="mt-3 truncate text-xl font-semibold text-fg">{game.awayTeam}</p>
              <p className="mt-2 text-sm text-fg-muted">
                Win chance: {formatProbability(game.awayProbability)}
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-3 text-right">
          {game.result ? (
            <>
              <p className="text-sm text-fg-muted">Result</p>
              <p className="text-lg font-semibold text-fg">
                {game.result === 'home' ? game.homeTeam : game.awayTeam} won
              </p>
              <div className="flex justify-end">{outcomeBadge}</div>
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
