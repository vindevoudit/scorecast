// Tier 18 Chunk 4 — friends' picks inline expand for GameCard.
// Mirrors the existing CommentThread toggle pattern: a chip header that
// flips an `aria-expanded` state and reveals a vertical list. Data comes
// from DataContext via useFriendsPicks() — single bulk fetch at boot
// powers every GameCard on the page.

import { useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import Avatar from './Avatar';
import { Badge } from './ui';
import { displayTeamName } from '../utils/teamNames';
import { useFriendsPicks } from '../hooks/useFriendsPicks';

function ChevronIcon({ open }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Friend-pick outcome badge — mirrors GameCard's main outcomeBadge styling
// so the inline friend list reads with the same color vocabulary as the
// outer card. Draw is warning-tone (yellow); won is success (green); lost
// is the danger "✗ Missed" pill instead of a bare 0.
function friendOutcomeBadge(row, game) {
  if (!game?.result) return null; // not yet scored — render nothing
  if (game.result === 'draw') {
    return <Badge tone="warning">Drew +{row.points} pts</Badge>;
  }
  if (row.choice === game.result) {
    return <Badge tone="success">✓ +{row.points} pts</Badge>;
  }
  return <Badge tone="danger">✗ Missed</Badge>;
}

function FriendPicksPanel({ game }) {
  const { byGame } = useFriendsPicks();
  const rows = byGame.get(game.id) || [];
  const [open, setOpen] = useState(false);
  const [listRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });

  // No friends have picked this game (or viewer has no friends) — render
  // nothing. Keeps the GameCard footprint tight when there's nothing to
  // surface; the chip otherwise becomes visual noise on most matches.
  if (rows.length === 0) return null;

  const label = `${rows.length} friend${rows.length === 1 ? '' : 's'} picked`;

  return (
    <div className="mt-3 border-t border-default pt-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-2xl px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted transition-colors duration-200 hover:bg-overlay/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span>{label}</span>
        <ChevronIcon open={open} />
      </button>
      <div ref={listRef} className="space-y-2">
        {open
          ? rows.map((row) => {
              const team =
                row.choice === 'home'
                  ? displayTeamName(game.homeTeam)
                  : displayTeamName(game.awayTeam);
              return (
                <div
                  key={row.pickId}
                  className={`flex items-center justify-between gap-3 rounded-2xl bg-overlay/70 px-3 py-2 ${
                    row.isMasked ? 'italic text-fg-muted' : ''
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar username={row.username} displayName={row.displayName} size={24} />
                    <span className="min-w-0 truncate text-sm">
                      {row.displayName || row.username}
                      {row.isMasked ? (
                        <span className="ml-2 text-[10px] uppercase tracking-widest text-fg-subtle">
                          private
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-fg-muted">
                      Pick: <span className="text-fg">{team}</span>
                    </span>
                    {friendOutcomeBadge(row, game)}
                  </div>
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}

export default FriendPicksPanel;
