import { useEffect, useState } from 'react';
import ConfirmModal from '../ConfirmModal';

const EMPTY_FORM = {
  homeTeam: '',
  awayTeam: '',
  date: '',
  homeProbability: '0.5',
  awayProbability: '0.5',
};

function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIsoUtc(localValue) {
  if (!localValue) return null;
  return new Date(localValue).toISOString();
}

function GameRow({ game, onSave, onSetResult, onDelete, busy }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    date: toLocalInput(game.date),
    homeProbability: String(game.homeProbability),
    awayProbability: String(game.awayProbability),
  });

  const submit = async (event) => {
    event.preventDefault();
    await onSave(game.id, {
      homeTeam: form.homeTeam.trim(),
      awayTeam: form.awayTeam.trim(),
      date: toIsoUtc(form.date),
      homeProbability: parseFloat(form.homeProbability),
      awayProbability: parseFloat(form.awayProbability),
    });
    setEditing(false);
  };

  return (
    <div className="rounded-2xl bg-slate-950/70 p-4">
      {editing ? (
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">
            Home team
            <input
              value={form.homeTeam}
              onChange={(e) => setForm({ ...form, homeTeam: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            Away team
            <input
              value={form.awayTeam}
              onChange={(e) => setForm({ ...form, awayTeam: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
          <label className="text-xs text-slate-400 sm:col-span-2">
            Date / time
            <input
              type="datetime-local"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            Home probability (0–1)
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={form.homeProbability}
              onChange={(e) => setForm({ ...form, homeProbability: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            Away probability (0–1)
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={form.awayProbability}
              onChange={(e) => setForm({ ...form, awayProbability: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-2xl bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-2xl border border-slate-600 bg-slate-900/90 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {game.homeTeam} <span className="text-slate-500">vs</span> {game.awayTeam}
            </p>
            <p className="text-xs text-slate-400">
              {new Date(game.date).toLocaleString()} ·{' '}
              <span className="tabular-nums">{Math.round(game.homeProbability * 100)}%</span> /{' '}
              <span className="tabular-nums">{Math.round(game.awayProbability * 100)}%</span>
              {game.result && (
                <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                  Result: {game.result === 'home' ? game.homeTeam : game.awayTeam}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSetResult(game.id, 'home')}
              disabled={busy}
              className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200 hover:border-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
            >
              Home won
            </button>
            <button
              type="button"
              onClick={() => onSetResult(game.id, 'away')}
              disabled={busy}
              className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200 hover:border-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
            >
              Away won
            </button>
            <button
              type="button"
              onClick={() => onSetResult(game.id, null)}
              disabled={busy}
              className="rounded-2xl border border-slate-600 bg-slate-900/90 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-2xl border border-slate-600 bg-slate-900/90 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(game)}
              className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200 hover:border-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GameManager({ request, onAfterChange, onError, onSuccess }) {
  const [games, setGames] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const load = async () => {
    try {
      const data = await request('/api/games');
      setGames([...data].sort((a, b) => new Date(b.date) - new Date(a.date)));
    } catch (error) {
      onError?.(error.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await request('/api/admin/games', {
        method: 'POST',
        body: JSON.stringify({
          homeTeam: form.homeTeam.trim(),
          awayTeam: form.awayTeam.trim(),
          date: toIsoUtc(form.date),
          homeProbability: parseFloat(form.homeProbability),
          awayProbability: parseFloat(form.awayProbability),
        }),
      });
      setForm(EMPTY_FORM);
      setCreating(false);
      await load();
      onAfterChange?.();
      onSuccess?.('Game created');
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (id, body) => {
    setBusy(true);
    try {
      await request(`/api/admin/games/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      await load();
      onAfterChange?.();
      onSuccess?.('Game updated');
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSetResult = async (id, result) => {
    setBusy(true);
    try {
      await request(`/api/games/${id}/result`, {
        method: 'POST',
        body: JSON.stringify({ result }),
      });
      await load();
      onAfterChange?.();
      onSuccess?.(result ? 'Result set' : 'Result cleared');
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const game = pendingDelete;
    setPendingDelete(null);
    setBusy(true);
    try {
      await request(`/api/admin/games/${game.id}`, { method: 'DELETE' });
      await load();
      onAfterChange?.();
      onSuccess?.('Game deleted');
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.32)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-white">Games</h3>
          <p className="text-sm text-slate-400">Create, edit, set results, and delete fixtures.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((prev) => !prev)}
          className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {creating ? 'Cancel' : 'New game'}
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="mt-4 grid gap-3 rounded-2xl bg-slate-950/70 p-4 sm:grid-cols-2">
          <label className="text-xs text-slate-400">
            Home team
            <input
              value={form.homeTeam}
              onChange={(e) => setForm({ ...form, homeTeam: e.target.value })}
              required
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            Away team
            <input
              value={form.awayTeam}
              onChange={(e) => setForm({ ...form, awayTeam: e.target.value })}
              required
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
          <label className="text-xs text-slate-400 sm:col-span-2">
            Date / time
            <input
              type="datetime-local"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            Home probability (0–1)
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={form.homeProbability}
              onChange={(e) => setForm({ ...form, homeProbability: e.target.value })}
              required
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            Away probability (0–1)
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={form.awayProbability}
              onChange={(e) => setForm({ ...form, awayProbability: e.target.value })}
              required
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
            >
              Create game
            </button>
          </div>
        </form>
      )}

      <div className="mt-5 space-y-3">
        {games.length === 0 ? (
          <p className="text-sm text-slate-500">No games yet.</p>
        ) : (
          games.map((game) => (
            <GameRow
              key={game.id}
              game={game}
              onSave={handleUpdate}
              onSetResult={handleSetResult}
              onDelete={(g) => setPendingDelete(g)}
              busy={busy}
            />
          ))
        )}
      </div>

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title="Delete game?"
        description={pendingDelete ? `${pendingDelete.homeTeam} vs ${pendingDelete.awayTeam} and all picks/comments on it will be removed.` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default GameManager;
