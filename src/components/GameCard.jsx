import { scorePick } from '../utils/scoring';
import { useCountdown } from '../utils/time';
import CommentThread from './CommentThread';

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
  if (!game.result) return `${base} bg-slate-950/70`;
  if (game.result === side) return `${base} border border-emerald-500/40 bg-emerald-500/10`;
  return `${base} bg-slate-950/70 opacity-60`;
}

function GameCard({ game, existingPick, onPickSubmit, onPickRemove, currentUserId, request, onError }) {
  const upcoming = isUpcomingGame(game);
  const countdown = useCountdown(game.date);

  const existingChoice = existingPick?.choice || null;
  const existingPickId = existingPick?.id || null;

  const pickedTeam = existingChoice === 'home' ? game.homeTeam : existingChoice === 'away' ? game.awayTeam : null;
  const pointsIfWon = game.result && existingChoice
    ? scorePick({ choice: existingChoice }, game)
    : 0;

  let outcomeBadge = null;
  if (game.result) {
    if (!existingChoice) {
      outcomeBadge = (
        <span className="inline-flex rounded-full bg-slate-700/60 px-3 py-1 text-xs font-semibold text-slate-200">
          No pick
        </span>
      );
    } else if (existingChoice === game.result) {
      outcomeBadge = (
        <span className="inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
          ✓ Correct +{pointsIfWon} pts
        </span>
      );
    } else {
      outcomeBadge = (
        <span className="inline-flex rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-300">
          ✗ Missed
        </span>
      );
    }
  }

  return (
    <div className="group rounded-3xl border border-slate-800 bg-slate-900/85 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.32)] transition duration-300 hover:-translate-y-1 hover:border-cyan-500/40 hover:bg-slate-900">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.25em] text-cyan-400/80">
            <span>{formatDate(game.date)}</span>
            <span>{statusLabel(game, upcoming)}</span>
            {upcoming && (
              <span className="rounded-full bg-slate-800/60 px-3 py-1 text-slate-300 normal-case tracking-normal">
                Picks lock in {countdown}
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={teamCardClass('home', game)}>
              <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Home</p>
              <p className="mt-3 truncate text-xl font-semibold text-white">{game.homeTeam}</p>
              <p className="mt-2 text-sm text-slate-400">Win chance: {formatProbability(game.homeProbability)}</p>
            </div>
            <div className={teamCardClass('away', game)}>
              <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Away</p>
              <p className="mt-3 truncate text-xl font-semibold text-white">{game.awayTeam}</p>
              <p className="mt-2 text-sm text-slate-400">Win chance: {formatProbability(game.awayProbability)}</p>
            </div>
          </div>
        </div>
        <div className="space-y-3 text-right">
          {game.result ? (
            <>
              <p className="text-sm text-slate-400">Result</p>
              <p className="text-lg font-semibold text-white">
                {game.result === 'home' ? game.homeTeam : game.awayTeam} won
              </p>
              <div className="flex justify-end">
                {outcomeBadge}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400">Potential reward</p>
              <p className="text-lg font-semibold text-white">{scoreEstimate(game.homeProbability)} / {scoreEstimate(game.awayProbability)}</p>
              <p className="text-sm text-slate-500">Your pick: {pickedTeam || 'None'}</p>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button
          className={`rounded-3xl border px-4 py-3 text-sm font-semibold transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 ${existingChoice === 'home' ? 'border-cyan-300 bg-cyan-500/30 text-white' : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-100 hover:border-cyan-300 hover:bg-cyan-500/20'}`}
          disabled={!upcoming}
          onClick={() => onPickSubmit(game.id, 'home')}
          aria-label={`Pick ${game.homeTeam} to win`}
        >
          Pick {game.homeTeam}
        </button>
        <button
          className={`rounded-3xl border px-4 py-3 text-sm font-semibold transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 ${existingChoice === 'away' ? 'border-cyan-300 bg-cyan-500/30 text-white' : 'border-slate-700 bg-slate-950/90 text-slate-100 hover:border-slate-500 hover:bg-slate-900'}`}
          disabled={!upcoming}
          onClick={() => onPickSubmit(game.id, 'away')}
          aria-label={`Pick ${game.awayTeam} to win`}
        >
          Pick {game.awayTeam}
        </button>
      </div>

      {upcoming && existingPickId && onPickRemove && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => onPickRemove(existingPickId)}
            className="text-xs text-slate-400 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Undo pick
          </button>
        </div>
      )}

      {request && (
        <CommentThread
          gameId={game.id}
          currentUserId={currentUserId}
          request={request}
          onError={onError}
        />
      )}
    </div>
  );
}

export default GameCard;
