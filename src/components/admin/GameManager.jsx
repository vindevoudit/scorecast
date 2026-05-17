// Tier 11 Chunk 2 — GameManager tokenized. Preserves all admin button
// labels (New game, Home won, Away won, Clear, Edit, Delete, Result → …)
// so Playwright selectors continue to resolve.

import { useEffect, useState } from 'react';
import ConfirmModal from '../ConfirmModal';
import { Button, Input } from '../ui';
import { useRequest } from '../../hooks/useRequest';
import { useNotifications } from '../../hooks/useNotifications';
import { useData } from '../../hooks/useData';
import { displayTeamName } from '../../utils/teamNames';

const EMPTY_FORM = {
  homeTeam: '',
  awayTeam: '',
  date: '',
  homeProbability: '0.5',
  drawProbability: '0',
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

function GameRow({ game, leagueName, onSave, onSetResult, onDelete, busy }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    date: toLocalInput(game.date),
    homeProbability: String(game.homeProbability),
    drawProbability: String(game.drawProbability ?? 0),
    awayProbability: String(game.awayProbability),
  });

  const submit = async (event) => {
    event.preventDefault();
    await onSave(game.id, {
      homeTeam: form.homeTeam.trim(),
      awayTeam: form.awayTeam.trim(),
      date: toIsoUtc(form.date),
      homeProbability: parseFloat(form.homeProbability),
      drawProbability: parseFloat(form.drawProbability),
      awayProbability: parseFloat(form.awayProbability),
    });
    setEditing(false);
  };

  return (
    <div className="rounded-2xl bg-overlay/70 p-4">
      {editing ? (
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Home team"
            value={form.homeTeam}
            onChange={(e) => setForm({ ...form, homeTeam: e.target.value })}
          />
          <Input
            label="Away team"
            value={form.awayTeam}
            onChange={(e) => setForm({ ...form, awayTeam: e.target.value })}
          />
          <div className="sm:col-span-2">
            <Input
              type="datetime-local"
              label="Date / time"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <Input
            type="number"
            step="0.01"
            min="0"
            max="1"
            label="Home probability (0–1)"
            value={form.homeProbability}
            onChange={(e) => setForm({ ...form, homeProbability: e.target.value })}
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            max="1"
            label="Draw probability (0–1)"
            value={form.drawProbability}
            onChange={(e) => setForm({ ...form, drawProbability: e.target.value })}
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            max="1"
            label="Away probability (0–1)"
            value={form.awayProbability}
            onChange={(e) => setForm({ ...form, awayProbability: e.target.value })}
          />
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={busy}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">
              {displayTeamName(game.homeTeam)} <span className="text-fg-subtle">vs</span>{' '}
              {displayTeamName(game.awayTeam)}
            </p>
            <p className="text-xs text-fg-muted">
              {new Date(game.date).toLocaleString()} ·{' '}
              <span className="tabular-nums">{Math.round(game.homeProbability * 100)}%</span> /{' '}
              <span className="tabular-nums">{Math.round((game.drawProbability ?? 0) * 100)}%</span>{' '}
              / <span className="tabular-nums">{Math.round(game.awayProbability * 100)}%</span>
              {leagueName ? (
                <span className="ml-2 rounded-full bg-overlay px-2 py-0.5 text-fg-subtle">
                  {leagueName}
                </span>
              ) : null}
              {game.result ? (
                <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-success">
                  Result:{' '}
                  {game.result === 'draw'
                    ? 'Draw'
                    : displayTeamName(game.result === 'home' ? game.homeTeam : game.awayTeam)}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onSetResult(game.id, 'home')}
              disabled={busy}
              className="border-success/30 bg-success/10 text-success"
            >
              Home won
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onSetResult(game.id, 'away')}
              disabled={busy}
              className="border-success/30 bg-success/10 text-success"
            >
              Away won
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onSetResult(game.id, 'draw')}
              disabled={busy}
              className="border-warning/30 bg-warning/10 text-warning"
            >
              Draw
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onSetResult(game.id, null)}
              disabled={busy}
            >
              Clear
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="destructive" onClick={() => onDelete(game)}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function GameManager() {
  const request = useRequest();
  const { showStatus } = useNotifications();
  const { refreshGames, refreshPicks, refreshLeaderboard } = useData();
  const onError = (msg) => {
    if (msg && msg !== 'Session expired') showStatus(msg);
  };
  const onSuccess = (msg) => msg && showStatus(msg);
  const onAfterChange = async () => {
    await Promise.all([refreshGames(), refreshPicks(), refreshLeaderboard()]);
  };

  const [games, setGames] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [leagueFilter, setLeagueFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [pendingBulk, setPendingBulk] = useState(null);

  // Map of leagueId -> league name for the per-row chip; built from the
  // admin leagues endpoint (which includes inactive leagues, so admins can
  // still filter + clean up games from a deactivated league like BSA).
  const leagueNameById = leagues.reduce((acc, l) => {
    acc[l.id] = l.name;
    return acc;
  }, {});

  const loadLeagues = async () => {
    try {
      const data = await request('/api/admin/leagues');
      setLeagues(data.leagues || []);
    } catch (error) {
      onError?.(error.message);
    }
  };

  const load = async () => {
    try {
      const url = leagueFilter
        ? `/api/games?leagueId=${encodeURIComponent(leagueFilter)}`
        : '/api/games';
      const data = await request(url);
      setGames([...data].sort((a, b) => new Date(b.date) - new Date(a.date)));
      setSelectedIds(new Set());
    } catch (error) {
      onError?.(error.message);
    }
  };

  const toggleOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = games.length > 0 && games.every((g) => selectedIds.has(g.id));
  const toggleAll = () => {
    setSelectedIds((prev) => (allSelected ? new Set() : new Set(games.map((g) => g.id))));
  };

  const performBulk = async (action, result) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBusy(true);
    setPendingBulk(null);
    try {
      const payload = { ids, action };
      if (action === 'setResult') payload.result = result;
      const response = await request('/api/admin/games/bulk', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await load();
      onAfterChange?.();
      const affected = response?.affected?.length || 0;
      onSuccess?.(`${action}: ${affected} game${affected === 1 ? '' : 's'}`);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  const runBulk = (action, result) => {
    if (action === 'delete') {
      setPendingBulk({ action, ids: [...selectedIds] });
      return;
    }
    performBulk(action, result);
  };

  useEffect(() => {
    loadLeagues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch the games list whenever the league filter changes (including
  // initial mount with the default '' = all).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueFilter]);

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
          drawProbability: parseFloat(form.drawProbability),
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
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-fg">Games</h3>
          <p className="text-sm text-fg-muted">Create, edit, set results, and delete fixtures.</p>
        </div>
        <Button onClick={() => setCreating((prev) => !prev)}>
          {creating ? 'Cancel' : 'New game'}
        </Button>
      </div>

      {leagues.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-overlay/60 px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
            Filter
          </span>
          <label className="flex items-center gap-2 text-sm text-fg">
            <span className="sr-only">League</span>
            <select
              value={leagueFilter}
              onChange={(e) => setLeagueFilter(e.target.value)}
              className="rounded-xl border border-default bg-elevated/90 px-3 py-2 text-sm text-fg outline-none transition focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="">All leagues</option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.active === false ? ' (inactive)' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-xs tabular-nums text-fg-subtle">
            {games.length} game{games.length === 1 ? '' : 's'}
          </span>
        </div>
      ) : null}

      {creating ? (
        <form
          onSubmit={handleCreate}
          className="mt-4 grid gap-3 rounded-2xl bg-overlay/70 p-4 sm:grid-cols-2"
        >
          <Input
            label="Home team"
            value={form.homeTeam}
            onChange={(e) => setForm({ ...form, homeTeam: e.target.value })}
            required
          />
          <Input
            label="Away team"
            value={form.awayTeam}
            onChange={(e) => setForm({ ...form, awayTeam: e.target.value })}
            required
          />
          <div className="sm:col-span-2">
            <Input
              type="datetime-local"
              label="Date / time"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </div>
          <Input
            type="number"
            step="0.01"
            min="0"
            max="1"
            label="Home probability (0–1)"
            value={form.homeProbability}
            onChange={(e) => setForm({ ...form, homeProbability: e.target.value })}
            required
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            max="1"
            label="Draw probability (0–1)"
            value={form.drawProbability}
            onChange={(e) => setForm({ ...form, drawProbability: e.target.value })}
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            max="1"
            label="Away probability (0–1)"
            value={form.awayProbability}
            onChange={(e) => setForm({ ...form, awayProbability: e.target.value })}
            required
          />
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              Create game
            </Button>
          </div>
        </form>
      ) : null}

      {games.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-overlay/70 px-3 py-2 text-xs text-fg">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              aria-label="Select all games"
            />
            Select all
          </label>
          {selectedIds.size > 0 ? (
            <>
              <span className="ml-2 text-fg-subtle">{selectedIds.size} selected</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => runBulk('setResult', 'home')}
                className="ml-auto border-success/30 bg-success/10 text-success"
              >
                Result → Home
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => runBulk('setResult', 'away')}
                className="border-success/30 bg-success/10 text-success"
              >
                Result → Away
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => runBulk('setResult', 'draw')}
                className="border-warning/30 bg-warning/10 text-warning"
              >
                Result → Draw
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => runBulk('setResult', null)}
              >
                Clear result
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => runBulk('delete')}
              >
                Delete
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {games.length === 0 ? (
          <p className="text-sm text-fg-subtle">No games yet.</p>
        ) : (
          games.map((game) => (
            <div key={game.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(game.id)}
                onChange={() => toggleOne(game.id)}
                aria-label={`Select ${displayTeamName(game.homeTeam)} vs ${displayTeamName(game.awayTeam)}`}
                className="mt-5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <GameRow
                  game={game}
                  leagueName={leagueNameById[game.leagueId]}
                  onSave={handleUpdate}
                  onSetResult={handleSetResult}
                  onDelete={(g) => setPendingDelete(g)}
                  busy={busy}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title="Delete game?"
        description={
          pendingDelete
            ? `${displayTeamName(pendingDelete.homeTeam)} vs ${displayTeamName(pendingDelete.awayTeam)} and all picks/comments on it will be removed.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmModal
        open={Boolean(pendingBulk)}
        title="Bulk delete games?"
        description={
          pendingBulk
            ? `${pendingBulk.ids.length} game${pendingBulk.ids.length === 1 ? '' : 's'} and their picks/comments will be removed. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => pendingBulk && performBulk('delete')}
        onCancel={() => setPendingBulk(null)}
      />
    </div>
  );
}

export default GameManager;
