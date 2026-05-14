import { useEffect, useRef, useState } from 'react';

function formatGameDate(value) {
  return new Date(value).toLocaleString([], { dateStyle: 'medium' });
}

function SearchBar({ request, onSelectUser, onSelectGroup, onSelectGame, onError }) {
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

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor="search-input" className="sr-only">
        Search
      </label>
      <input
        id="search-input"
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search users, groups, games…"
        className="h-12 w-48 rounded-3xl border border-slate-700 bg-slate-900/80 px-4 text-sm text-white outline-none transition duration-200 focus:w-64 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
      />

      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-3xl border border-slate-800 bg-slate-900/95 p-3 shadow-[0_30px_80px_rgba(15,23,42,0.65)]">
          {loading ? (
            <p className="text-xs text-slate-500">Searching…</p>
          ) : !hasResults ? (
            <p className="text-xs text-slate-500">No matches.</p>
          ) : (
            <div className="space-y-3">
              {results.users.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Users</p>
                  <ul className="mt-1 space-y-1">
                    {results.users.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectUser?.(u.username);
                            close();
                          }}
                          className="block w-full truncate rounded-2xl px-2 py-1 text-left text-sm text-slate-200 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                        >
                          {u.displayName ? `${u.displayName} (@${u.username})` : u.username}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {results.groups.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Groups</p>
                  <ul className="mt-1 space-y-1">
                    {results.groups.map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectGroup?.(g);
                            close();
                          }}
                          className="flex w-full items-center justify-between gap-2 rounded-2xl px-2 py-1 text-left text-sm text-slate-200 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                        >
                          <span className="truncate">{g.name}</span>
                          <span className="shrink-0 text-xs text-slate-500">
                            {g.visibility === 'public' ? 'public' : 'private'}
                            {g.isMember ? ' · joined' : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {results.games.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Games</p>
                  <ul className="mt-1 space-y-1">
                    {results.games.map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectGame?.(g);
                            close();
                          }}
                          className="block w-full truncate rounded-2xl px-2 py-1 text-left text-sm text-slate-200 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                        >
                          {g.homeTeam} vs {g.awayTeam}
                          <span className="ml-2 text-xs text-slate-500">
                            · {formatGameDate(g.date)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
