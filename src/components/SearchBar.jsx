// Tier 11 Chunk 2 — SearchBar tokenized.
// Tier 11 Chunk 3 — Always-visible input. Mobile: full-width on its own row
// (placed by DashboardView's 3-row top bar). Desktop: inline `w-64` that
// focuses to `w-80`. Dropdown anchors below the input — full-width on mobile,
// right-aligned `w-80` on desktop. The previous fullscreen-overlay mode is
// gone (the input no longer competes for space with other top-bar items).

import { useEffect, useId, useRef, useState } from 'react';
import { useRequest } from '../hooks/useRequest';
import { useNotifications } from '../hooks/useNotifications';
import { useData } from '../hooks/useData';

function formatGameDate(value) {
  return new Date(value).toLocaleString([], { dateStyle: 'medium' });
}

function SearchBar({ onSelectGroup, onSelectGame }) {
  const request = useRequest();
  const { showStatus } = useNotifications();
  const { openProfile } = useData();
  const onSelectUser = openProfile;
  const onError = (msg) => {
    if (msg && msg !== 'Session expired') showStatus(msg);
  };
  // Tier 11 Chunk 3 — DashboardView renders SearchBar twice (once per
  // mobile/desktop layout, CSS-hidden via md:hidden / hidden md:flex). useId
  // guarantees each instance has a unique input id so the <label htmlFor>
  // association doesn't collide.
  const inputId = useId();
  const [q, setQ] = useState('');
  const [results, setResults] = useState({ users: [], groups: [], games: [] });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults({ users: [], groups: [], games: [] });
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await request(`/api/search?q=${encodeURIComponent(term)}`);
        setResults(data);
      } catch (error) {
        onError?.(error.message);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

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

  const close = () => {
    setOpen(false);
    setQ('');
  };

  const hasResults = results.users.length || results.groups.length || results.games.length;
  const showDropdown = open && q.trim().length >= 2;

  const itemBtn =
    'block w-full truncate rounded-2xl px-2 py-2 text-left text-sm text-fg hover:bg-overlay/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <div ref={containerRef} className="relative w-full md:w-auto">
      <label htmlFor={inputId} className="sr-only">
        Search
      </label>
      <input
        id={inputId}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search users, groups, games…"
        className="h-12 w-full rounded-3xl border border-default bg-elevated/80 px-4 text-sm text-fg outline-none transition duration-200 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent md:w-64 md:focus:w-80"
      />

      {showDropdown ? (
        <div className="absolute left-0 right-0 z-40 mt-2 rounded-3xl border border-default bg-elevated p-3 shadow-glow md:left-auto md:right-0 md:w-80">
          {loading ? (
            <p className="text-xs text-fg-subtle">Searching…</p>
          ) : !hasResults ? (
            <p className="text-xs text-fg-subtle">No matches.</p>
          ) : (
            <div className="space-y-3">
              {results.users.length > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Users</p>
                  <ul className="mt-1 space-y-1">
                    {results.users.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectUser?.(u.username);
                            close();
                          }}
                          className={itemBtn}
                        >
                          {u.displayName ? `${u.displayName} (@${u.username})` : u.username}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {results.groups.length > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Groups</p>
                  <ul className="mt-1 space-y-1">
                    {results.groups.map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectGroup?.(g);
                            close();
                          }}
                          className={`${itemBtn} flex items-center justify-between gap-2`}
                        >
                          <span className="truncate">{g.name}</span>
                          <span className="shrink-0 text-xs text-fg-subtle">
                            {g.visibility === 'public' ? 'public' : 'private'}
                            {g.isMember ? ' · joined' : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {results.games.length > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Games</p>
                  <ul className="mt-1 space-y-1">
                    {results.games.map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectGame?.(g);
                            close();
                          }}
                          className={itemBtn}
                        >
                          {g.homeTeam} vs {g.awayTeam}
                          <span className="ml-2 text-xs text-fg-subtle">
                            · {formatGameDate(g.date)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default SearchBar;
