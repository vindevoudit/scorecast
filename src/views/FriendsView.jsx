// Tier 30 Phase 1 Chunk 1.2 — FriendsView. New top-level surface. Splits
// the previous all-in-one FriendsList into three sub-tabs:
//
//   All           → accepted friends only (action: Unfriend)
//   Requests      → incoming + outgoing pending rows
//   Find people   → debounced autocomplete over /api/search?type=users
//
// Sidebar entry id: `'friends'`. View id keeps the SETTINGS / GROUPS deep-
// link enum extensible; legacy notifications carrying `/?view=groups` (the
// pre-Phase-1 link emitted by routes/friends.js) are redirected to this
// view inside DataContext.consumeDeepLinks.

import { useEffect, useRef, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import EmptyState from '../components/EmptyState';
import SubTabs from '../components/SubTabs';
import { useFriends } from '../hooks/useFriends';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';
import { useRequest } from '../hooks/useRequest';
import { useNotifications } from '../hooks/useNotifications';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Button, Input } from '../components/ui';

// Shared row presentation across all three sub-tabs. Clicking the username
// opens the ProfileDrawer (consistency with GroupCard's member tiles
// landed in Phase 0).
function FriendRow({ entry, actions, onSelectUser }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-overlay/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
}

function AllFriendsSection() {
  const {
    friends: { friends },
    handleUnfriend: onUnfriend,
  } = useFriends();
  const { openProfile: onSelectUser } = useData();
  const [friendsRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-fg-muted">Friends</h3>
      <div ref={friendsRef} className="mt-3 space-y-2">
        {friends.length === 0 ? (
          <EmptyState
            title="No friends yet"
            description="Switch to Find people above to search and send a request."
          />
        ) : (
          friends.map((entry) => (
            <FriendRow
              key={entry.id}
              entry={entry}
              onSelectUser={onSelectUser}
              actions={[
                <Button
                  key="unfriend"
                  size="sm"
                  variant="secondary"
                  onClick={() => onUnfriend(entry.id)}
                >
                  Unfriend
                </Button>,
              ]}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RequestsSection() {
  const {
    friends: { incoming, outgoing },
    handleAcceptFriend: onAccept,
    handleDeclineFriend: onDecline,
    handleUnfriend,
  } = useFriends();
  const { openProfile: onSelectUser } = useData();
  const onCancel = handleUnfriend; // outgoing cancel reuses unfriend semantics
  const [incomingRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });
  const [outgoingRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });

  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <EmptyState
        title="No pending requests"
        description="When someone sends you a friend request, it'll show up here."
      />
    );
  }

  return (
    <div className="space-y-6">
      {incoming.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-fg-muted">
            Incoming requests
          </h3>
          <div ref={incomingRef} className="mt-3 space-y-2">
            {incoming.map((entry) => (
              <FriendRow
                key={entry.id}
                entry={entry}
                onSelectUser={onSelectUser}
                actions={[
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
                ]}
              />
            ))}
          </div>
        </div>
      ) : null}

      {outgoing.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-fg-muted">
            Outgoing requests
          </h3>
          <div ref={outgoingRef} className="mt-3 space-y-2">
            {outgoing.map((entry) => (
              <FriendRow
                key={entry.id}
                entry={entry}
                onSelectUser={onSelectUser}
                actions={[
                  <Button
                    key="cancel"
                    size="sm"
                    variant="secondary"
                    onClick={() => onCancel(entry.id)}
                  >
                    Cancel
                  </Button>,
                ]}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Find people: debounced autocomplete over /api/search?type=users. Mirrors
// the old FriendsList autocomplete behavior — same row-level CTA states
// (Add friend / Request sent / Accept / Friends / You).
function FindPeopleSection() {
  const { user } = useAuth();
  const { handleSendFriendRequest: onSendRequest, handleAcceptFriend: onAccept } = useFriends();
  const { openProfile: onSelectUser } = useData();
  const request = useRequest();
  const { showStatus } = useNotifications();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState(null);
  // searchToken: same cache-bust trick as the old FriendsList — bump after
  // a successful add/accept so the next debounced fire re-pulls the row's
  // updated friendStatus instead of serving the stale cached payload.
  const [searchToken, setSearchToken] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!user) return undefined;
    const term = debouncedQuery.trim();
    if (term.length < 2) {
      setResults([]);
      return undefined;
    }
    setLoading(true);
    let cancelled = false;
    request(`/api/search?q=${encodeURIComponent(term)}&type=users`)
      .then((data) => {
        if (!cancelled) setResults(data?.users || []);
      })
      .catch((error) => {
        if (!cancelled && error.message && error.message !== 'Session expired') {
          showStatus(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, user, searchToken]);

  const handleAdd = async (entry) => {
    setBusyUserId(entry.id);
    try {
      await onSendRequest(entry.username);
      setSearchToken((t) => t + 1);
    } finally {
      setBusyUserId(null);
    }
  };

  const handleAcceptIncoming = async (entry) => {
    if (!entry.friendshipId) return;
    setBusyUserId(entry.id);
    try {
      await onAccept(entry.friendshipId);
      setSearchToken((t) => t + 1);
    } finally {
      setBusyUserId(null);
    }
  };

  const renderRowAction = (entry) => {
    const busy = busyUserId === entry.id;
    if (entry.friendStatus === 'self') {
      return (
        <Button size="sm" variant="secondary" disabled>
          You
        </Button>
      );
    }
    if (entry.friendStatus === 'friends') {
      return (
        <Button size="sm" variant="secondary" disabled>
          Friends
        </Button>
      );
    }
    if (entry.friendStatus === 'pending-out') {
      return (
        <Button size="sm" variant="secondary" disabled>
          Request sent
        </Button>
      );
    }
    if (entry.friendStatus === 'pending-in') {
      return (
        <Button size="sm" disabled={busy} onClick={() => handleAcceptIncoming(entry)}>
          Accept
        </Button>
      );
    }
    return (
      <Button size="sm" disabled={busy} onClick={() => handleAdd(entry)}>
        Add friend
      </Button>
    );
  };

  const term = debouncedQuery.trim();
  const hasTerm = term.length >= 2;
  const hasResults = results.length > 0;

  return (
    <div>
      <p className="text-sm text-fg-muted">
        Start typing a username or display name — picks update as you type.
      </p>
      <div ref={containerRef} className="relative mt-4">
        <Input
          id="friend-search"
          aria-label="Search users"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by username or display name…"
          autoComplete="off"
        />
      </div>

      <div className="mt-4">
        {!hasTerm ? (
          <p className="text-xs text-fg-muted">Type at least 2 characters to begin searching.</p>
        ) : loading ? (
          <p className="text-xs text-fg-muted">Searching…</p>
        ) : !hasResults ? (
          <p className="text-xs text-fg-muted">No matches.</p>
        ) : (
          <ul className="space-y-1">
            {results.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-overlay/70 px-3 py-2 hover:bg-overlay"
              >
                <button
                  type="button"
                  onClick={() => onSelectUser?.(entry.username)}
                  className="min-w-0 flex-1 truncate text-left text-sm text-fg hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {entry.displayName ? `${entry.displayName} (@${entry.username})` : entry.username}
                </button>
                <div className="shrink-0">{renderRowAction(entry)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FriendsView() {
  const { user } = useAuth();

  if (!user) return null;

  const tabs = [
    { value: 'all', label: 'All', content: <AllFriendsSection /> },
    { value: 'requests', label: 'Requests', content: <RequestsSection /> },
    { value: 'find', label: 'Find people', content: <FindPeopleSection /> },
  ];

  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
      <div className="mb-5 flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.25em] text-accent/80">Social</p>
        <h2 className="text-2xl font-semibold text-fg">Friends</h2>
        <p className="text-sm text-fg-muted">
          Send and accept friend requests, and find people to follow your picks.
        </p>
      </div>
      <SubTabs tabs={tabs} defaultValue="all" ariaLabel="Friends sections" />
    </div>
  );
}

export default FriendsView;
