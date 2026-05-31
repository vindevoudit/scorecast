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
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { displayTeamName } from '../utils/teamNames';

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
  const debouncedQ = useDebouncedValue(q, 250);
  const [results, setResults] = useState({ users: [], groups: [], games: [] });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  // Tier 19 Chunk 2 — the inline `setTimeout` debounce previously here
  // lives in `useDebouncedValue` now. Behavior preserved: fetch only fires
  // for ≥ 2-char trimmed queries, ≥ 250 ms after the user stops typing.
  useEffect(() => {
    const term = debouncedQ.trim();
    if (term.length < 2) {
      setResults({ users: [], groups: [], games: [] });
      return undefined;
    }
    setLoading(true);
    let cancelled = false;
    request(`/api/search?q=${encodeURIComponent(term)}`)
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch((error) => {
        if (!cancelled) onError?.(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

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
        placeholder="Find users, groups..."
        className="h-12 w-full rounded-3xl border border-default bg-elevated/80 px-4 text-sm text-fg outline-none transition duration-200 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent md:w-64 md:focus:w-80"
      />

      {showDropdown ? (
        <div className="absolute left-0 right-0 z-40 mt-2 rounded-3xl border border-default bg-elevated p-3 shadow-glow md:left-auto md:right-0 md:w-80">
          {loading ? (
            <p className="text-xs text-fg-muted">Searching…</p>
          ) : !hasResults ? (
            <p className="text-xs text-fg-muted">No matches.</p>
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
                    {/* Tier 19 — per-row CTA driven by `canJoin` /
                        `canJoinWithPassword` / `canRequestJoin` /
                        `hasPendingRequest` / `isMember` flags from the
                        search response. The name button still opens /
                        navigates; the small right-side label communicates
                        the actionable state, and we pass the full result
                        row to `onSelectGroup` so DashboardView can route
                        to the right dialog. */}
                    {results.groups.map((g) => {
                      let cta = null;
                      if (g.isMember) cta = { label: 'Joined', tone: 'success' };
                      else if (g.canJoin) cta = { label: 'Public — tap to join', tone: 'accent' };
                      else if (g.canJoinWithPassword)
                        cta = { label: 'Password required', tone: 'accent' };
                      else if (g.hasPendingRequest)
                        cta = { label: 'Request pending', tone: 'muted' };
                      else if (g.canRequestJoin) cta = { label: 'Request to join', tone: 'accent' };
                      else cta = { label: g.visibility, tone: 'muted' }; // fallback
                      const toneClass =
                        cta.tone === 'success'
                          ? 'text-success'
                          : cta.tone === 'accent'
                            ? 'text-accent'
                            : 'text-fg-subtle';
                      return (
                        <li key={g.id}>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectGroup?.(g);
                              close();
                            }}
                            className={`${itemBtn} flex items-center justify-between gap-2`}
                          >
                            <span className="truncate">
                              {g.name}
                              {g.discriminator ? (
                                <span className="ml-1 font-mono text-[0.85em] text-fg-muted/70">
                                  #{g.discriminator}
                                </span>
                              ) : null}
                            </span>
                            <span className={`shrink-0 text-xs ${toneClass}`}>{cta.label}</span>
                          </button>
                        </li>
                      );
                    })}
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
                          {displayTeamName(g.homeTeam)} vs {displayTeamName(g.awayTeam)}
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
