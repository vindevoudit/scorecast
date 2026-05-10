import { useState } from 'react';

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

function GameCard({ game, existingPick, onPickSubmit }) {
  const upcoming = isUpcomingGame(game);

  return (
    <div className="group rounded-3xl border border-slate-800 bg-slate-900/85 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.32)] transition duration-300 hover:-translate-y-1 hover:border-cyan-500/40 hover:bg-slate-900">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.25em] text-cyan-400/80">
            <span>{formatDate(game.date)}</span>
            <span>{game.result ? 'Result' : upcoming ? 'Upcoming' : 'Closed'}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl bg-slate-950/70 p-4">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Home</p>
              <p className="mt-3 text-xl font-semibold text-white">{game.homeTeam}</p>
              <p className="mt-2 text-sm text-slate-400">Win chance: {formatProbability(game.homeProbability)}</p>
            </div>
            <div className="rounded-3xl bg-slate-950/70 p-4">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Away</p>
              <p className="mt-3 text-xl font-semibold text-white">{game.awayTeam}</p>
              <p className="mt-2 text-sm text-slate-400">Win chance: {formatProbability(game.awayProbability)}</p>
            </div>
          </div>
        </div>
        <div className="space-y-3 text-right">
          <p className="text-sm text-slate-400">Potential reward</p>
          <p className="text-lg font-semibold text-white">{scoreEstimate(game.homeProbability)} / {scoreEstimate(game.awayProbability)}</p>
          <p className="text-sm text-slate-500">Your pick: {existingPick ? (existingPick === 'home' ? game.homeTeam : game.awayTeam) : 'None'}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button
          className={`rounded-3xl border px-4 py-3 text-sm font-semibold transition duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${existingPick === 'home' ? 'border-cyan-300 bg-cyan-500/30 text-white' : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-100 hover:border-cyan-300 hover:bg-cyan-500/20'}`}
          disabled={!upcoming}
          onClick={() => onPickSubmit(game.id, 'home')}
        >
          Pick {game.homeTeam}
        </button>
        <button
          className={`rounded-3xl border px-4 py-3 text-sm font-semibold transition duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${existingPick === 'away' ? 'border-cyan-300 bg-cyan-500/30 text-white' : 'border-slate-700 bg-slate-950/90 text-slate-100 hover:border-slate-500 hover:bg-slate-900'}`}
          disabled={!upcoming}
          onClick={() => onPickSubmit(game.id, 'away')}
        >
          Pick {game.awayTeam}
        </button>
      </div>
    </div>
  );
}

export default GameCard;