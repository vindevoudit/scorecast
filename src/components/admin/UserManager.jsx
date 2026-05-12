import { useEffect, useState } from 'react';
import ConfirmModal from '../ConfirmModal';

function UserManager({ request, currentUserId, onError, onSuccess }) {
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const load = async () => {
    try {
      const data = await request('/api/admin/users');
      setUsers(data);
    } catch (error) {
      onError?.(error.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.32)]">
      <h3 className="text-xl font-semibold text-white">Users</h3>
      <p className="text-sm text-slate-400">Promote, demote, or delete users.</p>

      <div className="mt-5 space-y-2">
        {users.length === 0 ? (
          <p className="text-sm text-slate-500">No users.</p>
        ) : (
          users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <div key={u.id} className="flex flex-col gap-2 rounded-2xl bg-slate-950/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">
                    {u.username}
                    {isSelf && <span className="ml-2 text-xs uppercase tracking-widest text-cyan-300">you</span>}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${u.role === 'admin' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-700/60 text-slate-300'}`}>
                      {u.role}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Joined {new Date(u.createdAt).toLocaleDateString()} · {u.picksCount} picks · {u.groupsCount} groups
                  </p>
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
        description={pendingDelete ? `${pendingDelete.username} and all their picks, comments, groups they own, and friendships will be removed.` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default UserManager;
