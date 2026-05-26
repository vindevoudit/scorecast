// Tier 4b Chunk 1 — LeagueManager. Manage which football-data.org
// competitions ScoreCast tracks and trigger a manual fixture sync. PL and
// WC are seeded by migration; admin can add other free-tier competitions
// (La Liga `PD`, Champions League `CL`, etc.) via the form.

import { useEffect, useState } from 'react';
import ConfirmModal from '../ConfirmModal';
import { Badge, Button, Input } from '../ui';
import { useRequest } from '../../hooks/useRequest';
import { useNotifications } from '../../hooks/useNotifications';
import { useData } from '../../hooks/useData';

const EMPTY_FORM = {
  name: '',
  sourceLeagueId: '',
  country: '',
};

function LeagueRow({ league, busy, onToggleActive, onSync, onDelete, syncing }) {
  return (
    <div className="rounded-2xl bg-overlay/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-fg">{league.name}</p>
            <Badge tone={league.active ? 'success' : 'neutral'}>
              {league.active ? 'Active' : 'Inactive'}
            </Badge>
            <span className="rounded-full bg-overlay px-2 py-0.5 font-mono text-xs text-fg-muted">
              {league.sourceLeagueId}
            </span>
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            {league.country || 'No country set'} · {league.sourceProvider}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onToggleActive(league)}
            disabled={busy}
          >
            {league.active ? 'Deactivate' : 'Activate'}
          </Button>
          <Button size="sm" onClick={() => onSync(league)} disabled={busy || syncing}>
            {syncing ? 'Syncing…' : 'Sync fixtures'}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onDelete(league)} disabled={busy}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function LeagueManager() {
  const request = useRequest();
  const { showStatus } = useNotifications();
  const { refreshGames } = useData();

  const onError = (msg) => {
    if (msg && msg !== 'Session expired') showStatus(msg);
  };
  const onSuccess = (msg) => msg && showStatus(msg);

  const [leagues, setLeagues] = useState([]);
  const [apiConfigured, setApiConfigured] = useState(true);
  const [apiBudget, setApiBudget] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const load = async () => {
    try {
      const data = await request('/api/admin/leagues');
      setLeagues(data.leagues || []);
      setApiConfigured(Boolean(data.apiConfigured));
      setApiBudget(typeof data.apiBudget === 'number' ? data.apiBudget : null);
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
      const payload = {
        name: form.name.trim(),
        sourceLeagueId: form.sourceLeagueId.trim().toUpperCase(),
      };
      if (form.country.trim()) payload.country = form.country.trim();
      await request('/api/admin/leagues', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setForm(EMPTY_FORM);
      setCreating(false);
      await load();
      onSuccess?.('League added');
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (league) => {
    setBusy(true);
    try {
      await request(`/api/admin/leagues/${league.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !league.active }),
      });
      await load();
      onSuccess?.(`${league.name} ${!league.active ? 'activated' : 'deactivated'}`);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async (league) => {
    setSyncingId(league.id);
    try {
      const result = await request(`/api/admin/leagues/${league.id}/sync`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await Promise.all([load(), refreshGames?.()]);
      const created = result?.created ?? 0;
      const updated = result?.updated ?? 0;
      onSuccess?.(
        `${league.name}: ${created} new, ${updated} updated (${result?.totalUpstream ?? 0} upstream)`,
      );
    } catch (error) {
      onError?.(error.message);
    } finally {
      setSyncingId(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const league = pendingDelete;
    setPendingDelete(null);
    setBusy(true);
    try {
      await request(`/api/admin/leagues/${league.id}`, { method: 'DELETE' });
      await load();
      onSuccess?.('League deleted');
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
          <h3 className="text-xl font-semibold text-fg">Leagues</h3>
          <p className="text-sm text-fg-muted">
            Manage the competitions ScoreCast tracks via football-data.org.
          </p>
        </div>
        <Button onClick={() => setCreating((prev) => !prev)}>
          {creating ? 'Cancel' : 'Add league'}
        </Button>
      </div>

      {!apiConfigured ? (
        <div className="mt-4 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <p className="font-semibold">FOOTBALL_DATA_API_KEY is not set.</p>
          <p className="mt-1 text-xs">
            Sign up at football-data.org/client/register and set the key in your environment. Sync
            calls will return 503 until then.
          </p>
        </div>
      ) : apiBudget !== null ? (
        <p className="mt-2 text-xs text-fg-muted">
          API budget: ~{apiBudget} / 10 requests available this minute.
        </p>
      ) : null}

      {creating ? (
        <form
          onSubmit={handleCreate}
          className="mt-4 grid gap-3 rounded-2xl bg-overlay/70 p-4 sm:grid-cols-2"
        >
          <Input
            label="Display name"
            placeholder="e.g. La Liga"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <Input
            label="football-data.org code"
            placeholder="e.g. PD"
            value={form.sourceLeagueId}
            onChange={(e) => setForm({ ...form, sourceLeagueId: e.target.value })}
            required
            maxLength={40}
          />
          <div className="sm:col-span-2">
            <Input
              label="Country (optional)"
              placeholder="e.g. Spain"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              Add league
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-5 space-y-3">
        {leagues.length === 0 ? (
          <p className="text-sm text-fg-muted">No leagues yet.</p>
        ) : (
          leagues.map((league) => (
            <LeagueRow
              key={league.id}
              league={league}
              busy={busy}
              syncing={syncingId === league.id}
              onToggleActive={handleToggleActive}
              onSync={handleSync}
              onDelete={(l) => setPendingDelete(l)}
            />
          ))
        )}
      </div>

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title="Delete league?"
        description={
          pendingDelete
            ? `${pendingDelete.name} will be removed. Existing games stay but lose their league attribution.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default LeagueManager;
