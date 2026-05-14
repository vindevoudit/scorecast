import { useState } from 'react';
import InviteRow from './InviteRow';
import Avatar from './Avatar';
import ConfirmModal from './ConfirmModal';

function GroupCard({ group, currentUserId, onInvite, onLeave, onTransfer, onDelete }) {
  const isOwner = group.ownerId === currentUserId;
  const isMember = group.members.some((m) => (m.userId || m) === currentUserId);

  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');

  const transferCandidates = group.members.filter((m) => (m.userId || m) !== group.ownerId);

  const handleConfirmLeave = () => {
    setConfirmingLeave(false);
    onLeave?.(group.id);
  };

  const handleConfirmDelete = () => {
    setConfirmingDelete(false);
    onDelete?.(group.id);
  };

  const handleSubmitTransfer = (event) => {
    event.preventDefault();
    if (!transferTarget) return;
    onTransfer?.(group.id, transferTarget);
    setTransferring(false);
    setTransferTarget('');
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.32)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold text-white">{group.name}</h2>
          <p className="text-sm text-slate-400">
            {group.members.length} member{group.members.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest ${
              group.visibility === 'public'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-slate-700/60 text-slate-300'
            }`}
          >
            {group.visibility === 'public' ? 'Public' : 'Private'}
          </span>
          {isOwner && (
            <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-300">
              Owner
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="rounded-3xl bg-slate-950/70 p-4">
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Members</p>
          <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
            {group.members.map((member) => {
              const userId =
                (member && typeof member === 'object' ? member.userId : member) || member;
              const username =
                (member && typeof member === 'object' ? member.username : member) || member;
              return (
                <span
                  key={userId}
                  className="flex min-w-0 items-center gap-2 rounded-2xl bg-slate-900/80 px-3 py-2"
                >
                  <Avatar username={username} size={22} />
                  <span className="min-w-0 truncate">{username}</span>
                  {userId === group.ownerId && (
                    <span className="ml-auto text-[10px] uppercase tracking-widest text-cyan-300">
                      owner
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>

        <InviteRow groupId={group.id} onInvite={onInvite} />

        {(isMember || isOwner) && (onLeave || onTransfer || onDelete) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {isOwner && onTransfer && transferCandidates.length > 0 && (
              <button
                type="button"
                onClick={() => setTransferring((prev) => !prev)}
                className="rounded-2xl border border-slate-600 bg-slate-900/90 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {transferring ? 'Cancel' : 'Transfer ownership'}
              </button>
            )}
            {isMember && !isOwner && onLeave && (
              <button
                type="button"
                onClick={() => setConfirmingLeave(true)}
                className="rounded-2xl border border-slate-600 bg-slate-900/90 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                Leave group
              </button>
            )}
            {isOwner && onDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200 hover:border-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                Delete group
              </button>
            )}
          </div>
        )}

        {transferring && (
          <form
            onSubmit={handleSubmitTransfer}
            className="flex flex-col gap-2 rounded-2xl bg-slate-950/70 p-3 sm:flex-row sm:items-center"
          >
            <label
              htmlFor={`transfer-${group.id}`}
              className="text-xs uppercase tracking-[0.25em] text-slate-400"
            >
              Transfer to
            </label>
            <select
              id={`transfer-${group.id}`}
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
              required
              className="flex-1 rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <option value="">Choose a member…</option>
              {transferCandidates.map((m) => {
                const userId = (m && typeof m === 'object' ? m.userId : m) || m;
                const username = (m && typeof m === 'object' ? m.username : m) || m;
                return (
                  <option key={userId} value={userId}>
                    {username}
                  </option>
                );
              })}
            </select>
            <button
              type="submit"
              disabled={!transferTarget}
              className="rounded-2xl bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
            >
              Transfer
            </button>
          </form>
        )}
      </div>

      <ConfirmModal
        open={confirmingLeave}
        title={`Leave "${group.name}"?`}
        description="You'll need a new invite to rejoin if it's private."
        confirmLabel="Leave"
        cancelLabel="Stay"
        onConfirm={handleConfirmLeave}
        onCancel={() => setConfirmingLeave(false)}
      />

      <ConfirmModal
        open={confirmingDelete}
        title={`Delete "${group.name}"?`}
        description="All members will be removed and the group will be gone. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}

export default GroupCard;
