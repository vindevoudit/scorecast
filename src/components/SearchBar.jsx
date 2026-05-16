// Tier 11 Chunk 2 — SearchBar tokenized.
// Tier 11 Chunk 3 — Mobile redesign: on < md:, tapping the magnifying glass
// opens a full-width top-anchored overlay (input + close + dropdown) instead
// of inline-expanding inside the top utility bar. The previous inline-expand
// mode collided with the BANTRYX wordmark + right-column buttons because the
// `w-72` dropdown extended past the input's column. Desktop (md+) behavior is
// unchanged: inline `w-64` input with `focus:w-80` and a right-anchored
// dropdown.

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
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const desktopContainerRef = useRef(null);
  const mobileContainerRef = useRef(null);
  const mobileInputRef = useRef(null);

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

  // Outside click / Escape: only relevant for the desktop dropdown; the mobile
  // overlay has its own backdrop click + close button.
  useEffect(() => {
    if (!desktopOpen) return undefined;
    const handleClick = (event) => {
      if (desktopContainerRef.current && !desktopContainerRef.current.contains(event.target)) {
        setDesktopOpen(false);
      }
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setDesktopOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [desktopOpen]);

  // Mobile overlay: Escape closes it (backdrop click is wired below).
  useEffect(() => {
    if (!mobileExpanded) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') closeMobile();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mobileExpanded]);

  const closeMobile = () => {
    setMobileExpanded(false);
    setQ('');
  };

  const handleSelectDesktop = (fn) => {
    fn?.();
    setDesktopOpen(false);
    setQ('');
  };
  const handleSelectMobile = (fn) => {
    fn?.();
    closeMobile();
  };

  const showDesktopDropdown = desktopOpen && q.trim().length >= 2;
  const showMobileDropdown = mobileExpanded && q.trim().length >= 2;
  const hasResults = results.users.length || results.groups.length || results.games.length;

  const itemBtn =
    'block w-full truncate rounded-2xl px-2 py-2 text-left text-sm text-fg hover:bg-overlay/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  const renderResults = (onSelect) => {
    if (loading) return <p className="text-xs text-fg-subtle">Searching…</p>;
    if (!hasResults) return <p className="text-xs text-fg-subtle">No matches.</p>;
    return (
      <div className="space-y-3">
        {results.users.length > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Users</p>
            <ul className="mt-1 space-y-1">
              {results.users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(() => onSelectUser?.(u.username))}
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
                    onClick={() => onSelect(() => onSelectGroup?.(g))}
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
                    onClick={() => onSelect(() => onSelectGame?.(g))}
                    className={itemBtn}
                  >
                    {g.homeTeam} vs {g.awayTeam}
                    <span className="ml-2 text-xs text-fg-subtle">· {formatGameDate(g.date)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {/* Mobile (< md:): icon-only trigger that opens the overlay below */}
      <button
        type="button"
        aria-label="Search"
        onClick={() => {
          setMobileExpanded(true);
          setTimeout(() => mobileInputRef.current?.focus(), 0);
        }}
        className="flex h-12 w-12 items-center justify-center rounded-2xl border border-default bg-elevated/80 text-fg transition-colors duration-200 hover:bg-overlay hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden"
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

      {/* Mobile overlay: top-anchored full-bleed sheet. Replaces inline expand
          so the input + dropdown never overlap the BANTRYX wordmark or the
          right-column buttons. */}
      {mobileExpanded ? (
        <div
          ref={mobileContainerRef}
          className="fixed inset-x-0 top-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Search"
        >
          <button
            type="button"
            onClick={closeMobile}
            aria-label="Close search"
            className="absolute inset-0 -z-10 h-full w-full bg-base/70 backdrop-blur-sm"
            tabIndex={-1}
          />
          <div
            className="border-b border-default bg-elevated px-3 pb-3 shadow-glow"
            style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
          >
            <div className="flex items-center gap-2">
              <label htmlFor="search-input-mobile" className="sr-only">
                Search
              </label>
              <input
                ref={mobileInputRef}
                id="search-input-mobile"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search users, groups, games…"
                className="h-12 min-w-0 flex-1 rounded-2xl border border-default bg-overlay/70 px-4 text-sm text-fg outline-none transition duration-200 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
              />
              <button
                type="button"
                onClick={closeMobile}
                aria-label="Close search"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-fg-muted transition-colors duration-200 hover:bg-overlay/70 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {showMobileDropdown ? (
              <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-2xl border border-default bg-elevated p-3">
                {renderResults(handleSelectMobile)}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Desktop (md+): inline input with right-anchored dropdown */}
      <div ref={desktopContainerRef} className="relative hidden md:block">
        <label htmlFor="search-input" className="sr-only">
          Search
        </label>
        <input
          id="search-input"
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setDesktopOpen(true);
          }}
          onFocus={() => setDesktopOpen(true)}
          placeholder="Search users, groups, games…"
          className="h-12 w-64 rounded-3xl border border-default bg-elevated/80 px-4 text-sm text-fg outline-none transition duration-200 focus:w-80 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
        />
        {showDesktopDropdown ? (
          <div className="absolute right-0 z-40 mt-2 w-80 rounded-3xl border border-default bg-elevated p-3 shadow-glow">
            {renderResults(handleSelectDesktop)}
          </div>
        ) : null}
      </div>
    </>
  );
}

export default SearchBar;
