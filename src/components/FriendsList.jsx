// Tier 11 Chunk 2 — FriendsList migrated to Button + Input + tokens. Returns
// null for anon visitors (after all hooks run, per rules-of-hooks).

import { useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import EmptyState from './EmptyState';
import { useFriends } from '../hooks/useFriends';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';
import { Button, Input } from './ui';

function FriendsList() {
  const { user } = useAuth();
  const {
    friends: friendsData,
    handleSendFriendRequest: onSendRequest,
    handleAcceptFriend: onAccept,
    handleDeclineFriend: onDecline,
    handleUnfriend,
  } = useFriends();
  const { friends, incoming, outgoing } = friendsData;
  const onCancel = handleUnfriend;
  const onUnfriend = handleUnfriend;
  const { openProfile: onSelectUser } = useData();
  const [username, setUsername] = useState('');
  const animateOpts = { duration: 180, easing: 'ease-out' };
  const [incomingRef] = useAutoAnimate(animateOpts);
  const [outgoingRef] = useAutoAnimate(animateOpts);
  const [friendsRef] = useAutoAnimate(animateOpts);

  if (!user) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!username.trim()) return;
    await onSendRequest(username.trim());
    setUsername('');
  };

  const renderRow = (entry, actions) => (
    <div
      key={entry.id}
      className="flex flex-col gap-2 rounded-2xl bg-overlay/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <button
        type="button"
        onClick={() => onSelectUser?.(entry.username)}
        className="min-w-0 truncate text-left text-sm font-semibold text-fg hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {entry.username}
      </button>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );

  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <h2 className="text-2xl font-semibold text-fg">Friends</h2>
      <p className="mt-2 text-sm text-fg-muted">
        Send a request by username. Once accepted, you'll see head-to-head records on profiles.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <Input
            id="friend-username"
            aria-label="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
          />
        </div>
        <Button type="submit" size="lg">
          Send request
        </Button>
      </form>

      {incoming.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-fg-muted">
            Incoming requests
          </h3>
          <div ref={incomingRef} className="mt-3 space-y-2">
            {incoming.map((entry) =>
              renderRow(entry, [
                <Button key="accept" size="sm" onClick={() => onAccept(entry.id)}>
                  Accept
                </Button>,
                <Button
                  key="decline"
                  size="sm"
                  variant="secondary"
                  onClick={() => onDecline(entry.id)}
                >
                  Decline
                </Button>,
              ]),
            )}
          </div>
        </div>
      ) : null}

      {outgoing.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-fg-muted">
            Outgoing requests
          </h3>
          <div ref={outgoingRef} className="mt-3 space-y-2">
            {outgoing.map((entry) =>
              renderRow(entry, [
                <Button
                  key="cancel"
                  size="sm"
                  variant="secondary"
                  onClick={() => onCancel(entry.id)}
                >
                  Cancel
                </Button>,
              ]),
            )}
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-fg-muted">Friends</h3>
        <div ref={friendsRef} className="mt-3 space-y-2">
          {friends.length === 0 ? (
            <EmptyState title="No friends yet" description="Send a request above to get started." />
          ) : (
            friends.map((entry) =>
              renderRow(entry, [
                <Button
                  key="unfriend"
                  size="sm"
                  variant="secondary"
                  onClick={() => onUnfriend(entry.id)}
                >
                  Unfriend
                </Button>,
              ]),
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default FriendsList;
