// Tier 11 Chunk 2 — GroupCard migrated to tokens + Button + Badge.
// Tier 19 Chunks 1+3 — visibility badge handles 3 tiers; owner sees a
// pending-join-requests panel + a "Set/change password" surface when the
// group is private.

import { useEffect, useState } from 'react';
import InviteRow from './InviteRow';
import Avatar from './Avatar';
import CommentThread from './CommentThread';
import ConfirmModal from './ConfirmModal';
import GroupNameDisplay from './GroupNameDisplay';
import { Badge, Button, Input } from './ui';
import { useData } from '../hooks/useData';

function VisibilityBadge({ visibility, hasPassword }) {
  // Three-tier visibility badge with tone + label per level.
  if (visibility === 'public') return <Badge tone="success">Public</Badge>;
  if (visibility === 'secret') return <Badge tone="neutral">Secret</Badge>;
  // private
  return <Badge tone="accent">{hasPassword ? 'Private · Password' : 'Private'}</Badge>;
}

function GroupCard({ group, currentUserId, onInvite, onLeave, onTransfer, onDelete }) {
  const isOwner = group.ownerId === currentUserId;
  const isMember = group.members.some((m) => (m.userId || m) === currentUserId);

  const {
    fetchGroupJoinRequests,
    handleApproveJoinRequest,
    handleDeclineJoinRequest,
    handleSetGroupPassword,
    openProfile,
  } = useData();

  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');

  // Tier 19 Chunk 3 — owner-side pending requests. Loaded lazily on mount
  // for owners of private groups (the only case where the endpoint
  // returns anything meaningful). Re-fetched after approve/decline so
  // the local list stays in sync without a full DataContext refresh.
  const [joinRequests, setJoinRequests] = useState([]);
  const isPrivateOwner = isOwner && group.visibility === 'private';
  useEffect(() => {
    if (!isPrivateOwner) return;
    let cancelled = false;
    fetchGroupJoinRequests(group.id)
      .then((items) => {
        if (!cancelled) setJoinRequests(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isPrivateOwner, group.id, fetchGroupJoinRequests]);

  const refreshJoinRequests = async () => {
    try {
      const items = await fetchGroupJoinRequests(group.id);
      setJoinRequests(items);
    } catch {
      // best-effort — the list will refresh on next mount
    }
  };

  const onApprove = async (request) => {
    await handleApproveJoinRequest(group.id, request.id);
    await refreshJoinRequests();
  };
  const onDecline = async (request) => {
    await handleDeclineJoinRequest(group.id, request.id);
    await refreshJoinRequests();
  };

  // Password rotation (private groups only). Empty input = clear password.
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const onSubmitPassword = async (event) => {
    event.preventDefault();
    setSavingPassword(true);
    try {
      await handleSetGroupPassword(group.id, newPassword || null);
      setNewPassword('');
      setShowPasswordPanel(false);
    } catch {
      // Toast already shown by DataContext
    } finally {
      setSavingPassword(false);
    }
  };

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
          <h2 className="truncate text-xl font-semibold text-fg">
            <GroupNameDisplay group={group} />
          </h2>
          <p className="text-sm text-fg-muted">
            {group.members.length} member{group.members.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <VisibilityBadge visibility={group.visibility} hasPassword={Boolean(group.hasPassword)} />
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
              // Phase 0 follow-up — member names render as profile links so
              // behavior matches FriendsList, LeaderboardCard, ProfileDrawer
              // results everywhere else in the app. Self + Tier 8.6-masked
              // rows stay as static <span>s — the profile drawer would
              // either 404 (masked friends/private) or render the same user
              // already on screen.
              const isMasked = Boolean(member && typeof member === 'object' && member.isMasked);
              const isSelf = userId === currentUserId;
              const clickable = !isMasked && !isSelf && Boolean(openProfile);
              const inner = (
                <>
                  <Avatar username={username} size={22} />
                  <span className="min-w-0 truncate">{username}</span>
                  {userId === group.ownerId ? (
                    <span className="ml-auto text-[10px] uppercase tracking-widest text-accent">
                      owner
                    </span>
                  ) : null}
                </>
              );
              if (clickable) {
                return (
                  <button
                    key={userId}
                    type="button"
                    onClick={() => openProfile(username)}
                    className="flex min-w-0 items-center gap-2 rounded-2xl bg-elevated/80 px-3 py-2 text-left transition-colors duration-150 hover:bg-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {inner}
                  </button>
                );
              }
              return (
                <span
                  key={userId}
                  className="flex min-w-0 items-center gap-2 rounded-2xl bg-elevated/80 px-3 py-2"
                >
                  {inner}
                </span>
              );
            })}
          </div>
        </div>

        <InviteRow groupId={group.id} onInvite={onInvite} />

        {/* Tier 19 Chunk 3 — owner's pending-requests panel. Hidden when
            empty; rendered only for private groups (public/secret have no
            request flow). Each row carries the requester username + their
            optional 160-char message + Approve/Decline buttons. */}
        {isPrivateOwner && joinRequests.length > 0 ? (
          <div className="rounded-3xl bg-overlay/70 p-4">
            <p className="text-sm uppercase tracking-[0.24em] text-fg-muted">
              Pending requests ({joinRequests.length})
            </p>
            <div className="mt-3 space-y-2 text-sm">
              {joinRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex flex-col gap-2 rounded-2xl bg-elevated/80 px-3 py-2 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Avatar
                        username={request.username}
                        displayName={request.displayName}
                        size={22}
                      />
                      {openProfile ? (
                        <button
                          type="button"
                          onClick={() => openProfile(request.username)}
                          className="truncate text-left font-medium text-fg hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {request.displayName || request.username}
                        </button>
                      ) : (
                        <span className="truncate font-medium text-fg">
                          {request.displayName || request.username}
                        </span>
                      )}
                    </div>
                    {request.message ? (
                      <p className="mt-1 text-xs text-fg-muted">{request.message}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" onClick={() => onApprove(request)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => onDecline(request)}>
                      Decline
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Tier 19 Chunk 1 — owner-only password rotation. Visible only on
            private groups (passwords are a private-tier feature). The form
            is collapsed behind a toggle so the card stays compact for
            groups that don't use the feature. Submitting an empty field
            clears the password (group reverts to invite + request only). */}
        {isOwner && group.visibility === 'private' ? (
          <div className="rounded-3xl bg-overlay/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm uppercase tracking-[0.24em] text-fg-muted">Group password</p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setShowPasswordPanel((prev) => !prev);
                  if (showPasswordPanel) setNewPassword('');
                }}
              >
                {showPasswordPanel
                  ? 'Cancel'
                  : group.hasPassword
                    ? 'Change password'
                    : 'Set password'}
              </Button>
            </div>
            {showPasswordPanel ? (
              <form onSubmit={onSubmitPassword} className="mt-3 flex flex-col gap-2 sm:flex-row">
                <div className="flex-1">
                  <Input
                    id={`group-${group.id}-new-password`}
                    type="password"
                    aria-label="New group password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder={
                      group.hasPassword
                        ? 'Leave blank to clear (min 4 chars to set)'
                        : 'Min 4 characters'
                    }
                    autoComplete="off"
                  />
                </div>
                <Button type="submit" size="sm" disabled={savingPassword}>
                  {savingPassword
                    ? 'Saving…'
                    : newPassword
                      ? 'Save'
                      : group.hasPassword
                        ? 'Clear password'
                        : 'Save'}
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}

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

        {/* Tier 18 Chunk 5 — group running comments. Only renders for
            members + owner (the GET requires membership for private
            groups; for public groups it would technically work for
            non-members too, but a non-member wouldn't be inside this
            card via the My Groups list anyway). */}
        {isMember || isOwner ? <CommentThread scope="group" scopeId={group.id} /> : null}

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
        title={`Leave "${group.name}${group.discriminator ? ` #${group.discriminator}` : ''}"?`}
        description="You'll need a new invite to rejoin if it's private."
        confirmLabel="Leave"
        cancelLabel="Stay"
        onConfirm={handleConfirmLeave}
        onCancel={() => setConfirmingLeave(false)}
      />

      <ConfirmModal
        open={confirmingDelete}
        title={`Delete "${group.name}${group.discriminator ? ` #${group.discriminator}` : ''}"?`}
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
