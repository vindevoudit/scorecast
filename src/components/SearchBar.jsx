// Tier 11 Chunk 2 — SearchBar tokenized. Responsive icon-only mobile state
// preserved (Wave D contract from the pre-tier sidebar work).

import { useEffect, useRef, useState } from 'react';
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
  const [q, setQ] = useState('');
  const [results, setResults] = useState({ users: [], groups: [], games: [] });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

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
    if (!open && !mobileExpanded) return undefined;
    const handleClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
        setMobileExpanded(false);
      }
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setMobileExpanded(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open, mobileExpanded]);

  const close = () => {
    setOpen(false);
    setMobileExpanded(false);
    setQ('');
  };

  const hasResults = results.users.length || results.groups.length || results.games.length;

  const itemBtn =
    'block w-full truncate rounded-2xl px-2 py-1 text-left text-sm text-fg hover:bg-overlay/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Search"
        onClick={() => {
          setMobileExpanded(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className={`flex h-12 w-12 items-center justify-center rounded-2xl border border-default bg-elevated/80 text-fg transition-colors duration-200 hover:bg-overlay hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden ${mobileExpanded ? 'hidden' : ''}`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      </button>
      <label htmlFor="search-input" className="sr-only">
        Search
      </label>
      <input
        ref={inputRef}
        id="search-input"
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search users, groups, games…"
        className={`h-12 rounded-3xl border border-default bg-elevated/80 px-4 text-sm text-fg outline-none transition duration-200 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent md:inline-block md:w-64 md:focus:w-80 ${
          mobileExpanded ? 'block w-44 focus:w-48' : 'hidden'
        }`}
      />

      {open && q.trim().length >= 2 ? (
        <div className="absolute left-0 z-40 mt-2 w-72 max-w-[calc(100vw-6rem)] rounded-3xl border border-default bg-elevated p-3 shadow-glow md:left-auto md:right-0 md:w-80 md:max-w-none">
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
