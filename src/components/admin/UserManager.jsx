// Tier 11 Chunk 2 — UserManager tokenized.

import { useEffect, useMemo, useState } from 'react';
import ConfirmModal from '../ConfirmModal';
import { Badge, Button } from '../ui';
import { useRequest } from '../../hooks/useRequest';
import { useAuth } from '../../hooks/useAuth';
import { useNotifications } from '../../hooks/useNotifications';

function UserManager() {
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

  const toggleRole = async (target) => {
    setBusy(true);
    try {
      const nextRole = target.role === 'admin' ? 'user' : 'admin';
      await request(`/api/admin/users/${target.id}/role`, {
        method: 'POST',
        body: JSON.stringify({ role: nextRole }),
      });
      await load();
      onSuccess?.(`${target.username} is now ${nextRole}`);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setBusy(true);
    try {
      await request(`/api/admin/users/${target.id}`, { method: 'DELETE' });
      await load();
      onSuccess?.(`${target.username} deleted`);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
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

  const runBulk = async (action) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (action === 'delete') {
      setPendingBulk({ action, ids });
      return;
    }
    await performBulk(action, ids);
  };

  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <h3 className="text-xl font-semibold text-fg">Users</h3>
      <p className="text-sm text-fg-muted">Promote, demote, or delete users.</p>

      {selectableUsers.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-overlay/70 px-3 py-2 text-xs text-fg">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              aria-label="Select all users"
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
                onClick={() => runBulk('promote')}
                className="ml-auto"
              >
                Promote
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => runBulk('demote')}
              >
                Demote
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

      <div className="mt-5 space-y-2">
        {users.length === 0 ? (
          <p className="text-sm text-fg-muted">No users.</p>
        ) : (
          users.map((u) => {
            const isSelf = u.id === currentUserId;
            const checked = selectedIds.has(u.id);
            return (
              <div
                key={u.id}
                className="flex flex-col gap-2 rounded-2xl bg-overlay/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
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
                    <p className="flex flex-wrap items-center gap-2 truncate text-sm font-semibold text-fg">
                      {u.username}
                      {isSelf ? (
                        <span className="text-xs uppercase tracking-widest text-accent">you</span>
                      ) : null}
                      <Badge tone={u.role === 'admin' ? 'warning' : 'neutral'}>{u.role}</Badge>
                    </p>
                    <p className="text-xs text-fg-muted">
                      Joined {new Date(u.createdAt).toLocaleDateString()} · {u.picksCount} picks ·{' '}
                      {u.groupsCount} groups
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => toggleRole(u)}
                    disabled={busy || isSelf}
                  >
                    {u.role === 'admin' ? 'Demote' : 'Promote'}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setPendingDelete(u)}
                    disabled={busy || isSelf}
                  >
                    Delete
                  </Button>
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
