import { useEffect, useMemo, useState } from 'react';
import ConfirmModal from '../ConfirmModal';
import { useRequest } from '../../hooks/useRequest';
import { useAuth } from '../../hooks/useAuth';
import { useNotifications } from '../../hooks/useNotifications';

function UserManager() {
  // Tier 13 Chunk 5 — context-driven.
  const request = useRequest();
  const { user } = useAuth();
  const { showStatus } = useNotifications();
  const currentUserId = user?.id;
  const onError = (msg) => {
    if (msg && msg !== 'Session expired') showStatus(msg);
  };
  const onSuccess = (msg) => msg && showStatus(msg);

  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [pendingBulk, setPendingBulk] = useState(null);

  const load = async () => {
    try {
      const data = await request('/api/admin/users');
      setUsers(data);
      setSelectedIds(new Set());
    } catch (error) {
      onError?.(error.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectableUsers = useMemo(
    () => users.filter((u) => u.id !== currentUserId),
    [users, currentUserId],
  );
  const allSelected =
    selectableUsers.length > 0 && selectableUsers.every((u) => selectedIds.has(u.id));

  const toggleOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (allSelected) return new Set();
      return new Set(selectableUsers.map((u) => u.id));
    });
  };

  const toggleRole = async (user) => {
    setBusy(true);
    try {
      const nextRole = user.role === 'admin' ? 'user' : 'admin';
      await request(`/api/admin/users/${user.id}/role`, {
        method: 'POST',
        body: JSON.stringify({ role: nextRole }),
      });
      await load();
      onSuccess?.(`${user.username} is now ${nextRole}`);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const user = pendingDelete;
    setPendingDelete(null);
    setBusy(true);
    try {
      await request(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      await load();
      onSuccess?.(`${user.username} deleted`);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  const runBulk = async (action) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (action === 'delete') {
      setPendingBulk({ action, ids });
      return;
    }
    await performBulk(action, ids);
  };

  const performBulk = async (action, ids) => {
    setBusy(true);
    setPendingBulk(null);
    try {
      const result = await request('/api/admin/users/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, action }),
      });
      await load();
      const affected = result?.affected?.length || 0;
      const skipped = result?.skipped?.length || 0;
      onSuccess?.(
        `${action}: ${affected} user${affected === 1 ? '' : 's'}${skipped ? ` (skipped ${skipped})` : ''}`,
      );
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.32)]">
      <h3 className="text-xl font-semibold text-white">Users</h3>
      <p className="text-sm text-slate-400">Promote, demote, or delete users.</p>

      {selectableUsers.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              aria-label="Select all users"
            />
            Select all
          </label>
          {selectedIds.size > 0 && (
            <>
              <span className="ml-2 text-slate-500">{selectedIds.size} selected</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => runBulk('promote')}
                className="ml-auto rounded-2xl border border-slate-600 bg-slate-900/90 px-3 py-1 font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
              >
                Promote
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => runBulk('demote')}
                className="rounded-2xl border border-slate-600 bg-slate-900/90 px-3 py-1 font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
              >
                Demote
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => runBulk('delete')}
                className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-1 font-semibold text-rose-200 hover:border-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}

      <div className="mt-5 space-y-2">
        {users.length === 0 ? (
          <p className="text-sm text-slate-500">No users.</p>
        ) : (
          users.map((u) => {
            const isSelf = u.id === currentUserId;
            const checked = selectedIds.has(u.id);
            return (
              <div
                key={u.id}
                className="flex flex-col gap-2 rounded-2xl bg-slate-950/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOne(u.id)}
                    disabled={isSelf}
                    aria-label={`Select ${u.username}`}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {u.username}
                      {isSelf && (
                        <span className="ml-2 text-xs uppercase tracking-widest text-cyan-300">
                          you
                        </span>
                      )}
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-xs ${u.role === 'admin' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-700/60 text-slate-300'}`}
                      >
                        {u.role}
                      </span>
                    </p>
                    <p className="text-xs text-slate-400">
                      Joined {new Date(u.createdAt).toLocaleDateString()} · {u.picksCount} picks ·{' '}
                      {u.groupsCount} groups
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => toggleRole(u)}
                    disabled={busy || isSelf}
                    className="rounded-2xl border border-slate-600 bg-slate-900/90 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {u.role === 'admin' ? 'Demote' : 'Promote'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(u)}
                    disabled={busy || isSelf}
                    className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200 hover:border-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title="Delete user?"
        description={
          pendingDelete
            ? `${pendingDelete.username} and all their picks, comments, groups they own, and friendships will be removed.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmModal
        open={Boolean(pendingBulk)}
        title="Bulk delete users?"
        description={
          pendingBulk
            ? `${pendingBulk.ids.length} user${pendingBulk.ids.length === 1 ? '' : 's'} (and all their data) will be removed. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => pendingBulk && performBulk(pendingBulk.action, pendingBulk.ids)}
        onCancel={() => setPendingBulk(null)}
      />
    </div>
  );
}

export default UserManager;
