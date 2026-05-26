// Tier 11 Chunk 2 — InviteRow migrated.
// Tier 19 follow-up — input rewritten as a debounced autocomplete dropdown
// mirroring FriendsList / SearchBar's pattern. Anyone matching the term
// can be invited (the backend already accepts any username); per-row CTA
// is "Invite". Re-using `useDebouncedValue` keeps the 250 ms / 2-char-min
// rhythm consistent across every autocomplete surface.

import { useEffect, useRef, useState } from 'react';
import { Button, Input } from './ui';
import { useRequest } from '../hooks/useRequest';
import { useNotifications } from '../hooks/useNotifications';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

function InviteRow({ groupId, onInvite }) {
  const request = useRequest();
  const { showStatus } = useNotifications();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [busyUserId, setBusyUserId] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
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
  }, [debouncedQuery]);

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

  const term = debouncedQuery.trim();
  const showDropdown = open && term.length >= 2;
  const hasResults = results.length > 0;

  const closeDropdown = () => {
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  const handleInvite = async (entry) => {
    setBusyUserId(entry.id);
    try {
      await onInvite(groupId, entry.username);
      closeDropdown();
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div ref={containerRef} className="relative rounded-3xl bg-overlay/70 p-4">
      <label
        htmlFor={`invite-${groupId}`}
        className="text-sm uppercase tracking-[0.24em] text-fg-muted"
      >
        Invite a friend
      </label>
      <div className="mt-3">
        <Input
          id={`invite-${groupId}`}
          aria-label="Search users to invite"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search by username or display name…"
          autoComplete="off"
        />
      </div>

      {showDropdown ? (
        <div className="absolute left-4 right-4 z-40 mt-2 rounded-3xl border border-default bg-elevated p-3 shadow-glow">
          {loading ? (
            <p className="text-xs text-fg-subtle">Searching…</p>
          ) : !hasResults ? (
            <p className="text-xs text-fg-subtle">No matches.</p>
          ) : (
            <ul className="space-y-1">
              {results.map((entry) => {
                const busy = busyUserId === entry.id;
                const isSelf = entry.friendStatus === 'self';
                return (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 rounded-2xl px-2 py-2 hover:bg-overlay/70"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">
                      {entry.displayName
                        ? `${entry.displayName} (@${entry.username})`
                        : entry.username}
                    </span>
                    <div className="shrink-0">
                      {isSelf ? (
                        <Button size="sm" variant="secondary" disabled>
                          You
                        </Button>
                      ) : (
                        <Button size="sm" disabled={busy} onClick={() => handleInvite(entry)}>
                          {busy ? 'Inviting…' : 'Invite'}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default InviteRow;
