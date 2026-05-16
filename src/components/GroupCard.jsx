// Tier 11 Chunk 2 — GroupCard migrated to tokens + Button + Badge.

import { useState } from 'react';
import InviteRow from './InviteRow';
import Avatar from './Avatar';
import ConfirmModal from './ConfirmModal';
import { Badge, Button } from './ui';

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
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold text-fg">{group.name}</h2>
          <p className="text-sm text-fg-muted">
            {group.members.length} member{group.members.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={group.visibility === 'public' ? 'success' : 'neutral'}>
            {group.visibility === 'public' ? 'Public' : 'Private'}
          </Badge>
          {isOwner ? <Badge tone="accent">Owner</Badge> : null}
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="rounded-3xl bg-overlay/70 p-4">
          <p className="text-sm uppercase tracking-[0.24em] text-fg-muted">Members</p>
          <div className="mt-3 grid gap-2 text-sm text-fg sm:grid-cols-2">
            {group.members.map((member) => {
              const userId =
                (member && typeof member === 'object' ? member.userId : member) || member;
              const username =
                (member && typeof member === 'object' ? member.username : member) || member;
              return (
                <span
                  key={userId}
                  className="flex min-w-0 items-center gap-2 rounded-2xl bg-elevated/80 px-3 py-2"
                >
                  <Avatar username={username} size={22} />
                  <span className="min-w-0 truncate">{username}</span>
                  {userId === group.ownerId ? (
                    <span className="ml-auto text-[10px] uppercase tracking-widest text-accent">
                      owner
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>

        <InviteRow groupId={group.id} onInvite={onInvite} />

        {(isMember || isOwner) && (onLeave || onTransfer || onDelete) ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {isOwner && onTransfer && transferCandidates.length > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setTransferring((prev) => !prev)}
              >
                {transferring ? 'Cancel' : 'Transfer ownership'}
              </Button>
            ) : null}
            {isMember && !isOwner && onLeave ? (
              <Button size="sm" variant="secondary" onClick={() => setConfirmingLeave(true)}>
                Leave group
              </Button>
            ) : null}
            {isOwner && onDelete ? (
              <Button size="sm" variant="destructive" onClick={() => setConfirmingDelete(true)}>
                Delete group
              </Button>
            ) : null}
          </div>
        ) : null}

        {transferring ? (
          <form
            onSubmit={handleSubmitTransfer}
            className="flex flex-col gap-2 rounded-2xl bg-overlay/70 p-3 sm:flex-row sm:items-center"
          >
            <label
              htmlFor={`transfer-${group.id}`}
              className="text-xs uppercase tracking-[0.25em] text-fg-muted"
            >
              Transfer to
            </label>
            <select
              id={`transfer-${group.id}`}
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
              required
              className="flex-1 rounded-2xl border border-default bg-overlay/60 px-3 py-2 text-sm text-fg outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
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
            <Button type="submit" size="sm" disabled={!transferTarget}>
              Transfer
            </Button>
          </form>
        ) : null}
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
