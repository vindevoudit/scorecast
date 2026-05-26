// Tier 11 Chunk 2 — FriendsList migrated to Button + Input + tokens. Returns
// null for anon visitors (after all hooks run, per rules-of-hooks).
// Tier 19 Chunk 2 — input rewritten as a debounced autocomplete dropdown
// mirroring SearchBar's pattern. Each result row carries `friendStatus` +
// (when actionable) `friendshipId` from the search endpoint, driving the
// per-row CTA: Add friend / Request sent / Accept / Friends / You. The
// debounce hook (`useDebouncedValue`) is shared with SearchBar so both
// surfaces breathe the same 250 ms / 2-char-min rhythm.

import { useEffect, useRef, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import EmptyState from './EmptyState';
import { useFriends } from '../hooks/useFriends';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';
import { useRequest } from '../hooks/useRequest';
import { useNotifications } from '../hooks/useNotifications';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
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
  const request = useRequest();
  const { showStatus } = useNotifications();

  // Autocomplete state.
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [busyUserId, setBusyUserId] = useState(null); // disables the row's CTA mid-mutation
  // After a mutation (send request / accept incoming) the cached search
  // results are stale — bumping `searchToken` forces the useEffect below
  // to re-fetch with the current `debouncedQuery`, so the user re-typing
  // the same name immediately picks up the new `friendStatus` instead of
  // waiting for the debounce/cache to invalidate on its own. Without this,
  // a close→retype-same-value flow hits a race where the intermediate ''
  // debounce gets cancelled and `debouncedQuery` never changes, leaving
  // the effect dormant.
  const [searchToken, setSearchToken] = useState(0);
  const containerRef = useRef(null);

  const animateOpts = { duration: 180, easing: 'ease-out' };
  const [incomingRef] = useAutoAnimate(animateOpts);
  const [outgoingRef] = useAutoAnimate(animateOpts);
  const [friendsRef] = useAutoAnimate(animateOpts);

  // Fetch matches when the debounced query stabilizes. ≥ 2 chars trimmed.
  // We hit /api/search?type=users so we get the friendStatus enrichment
  // without paying for groups/games we won't render here.
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

  // Outside-click + Escape close. Mirrors SearchBar.
  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!user) return null;

  const term = debouncedQuery.trim();
  const showDropdown = open && term.length >= 2;
  const hasResults = results.length > 0;

  const closeDropdown = () => {
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  // After a successful Add / Accept the underlying useFriends hook
  // refreshes incoming/outgoing/friends, so the visual feedback shows up
  // in the existing sections below. We clear + close the dropdown to
  // signal "done" without leaving a stale row hanging.
  const handleAdd = async (entry) => {
    setBusyUserId(entry.id);
    try {
      await onSendRequest(entry.username);
      // Bump before closing so the just-firing useEffect picks up the new
      // server state and overwrites the stale `results[]` row before the
      // user has a chance to retype.
      setSearchToken((t) => t + 1);
      closeDropdown();
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
      closeDropdown();
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
    // 'none' or null — open invitation.
    return (
      <Button size="sm" disabled={busy} onClick={() => handleAdd(entry)}>
        Add friend
      </Button>
    );
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
        Start typing a username or display name — picks update as you type. Send a request from any
        match.
      </p>

      <div ref={containerRef} className="relative mt-4">
        <Input
          id="friend-search"
          aria-label="Search users"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search by username or display name…"
          autoComplete="off"
        />

        {showDropdown ? (
          <div className="absolute left-0 right-0 z-40 mt-2 rounded-3xl border border-default bg-elevated p-3 shadow-glow">
            {loading ? (
              <p className="text-xs text-fg-muted">Searching…</p>
            ) : !hasResults ? (
              <p className="text-xs text-fg-muted">No matches.</p>
            ) : (
              <ul className="space-y-1">
                {results.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 rounded-2xl px-2 py-2 hover:bg-overlay/70"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectUser?.(entry.username);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 truncate text-left text-sm text-fg hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {entry.displayName
                        ? `${entry.displayName} (@${entry.username})`
                        : entry.username}
                    </button>
                    <div className="shrink-0">{renderRowAction(entry)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

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
            <EmptyState
              title="No friends yet"
              description="Search above and send a request to get started."
            />
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
