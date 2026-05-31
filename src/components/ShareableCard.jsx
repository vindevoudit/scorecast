// Tier 30 Phase 3 A4 — capture-source design template for share-as-image.
//
// Two ratios:
//   square — 1080x1080 (Instagram feed, Twitter, generic social)
//   story  — 1080x1920 (Instagram Story, WhatsApp Status, TikTok)
//
// Tier 30 follow-up — GameCard's Share button now defaults to `story`
// (9:16) per user preference. `square` is kept around for completeness
// (any future feed-style sharing path can call captureAndShare('square')
// without further changes).
//
// All styling is INLINE because html-to-image serialises the node's
// computed styles into the PNG — the surrounding Tailwind context isn't
// available in the captured raster. Theme-independent hex values lock
// the brand look regardless of the user's Light/Dark preference.

import { displayTeamName } from '../utils/teamNames';

const COLORS = {
  bg: '#0F172A', // slate-900
  surface: '#1E293B', // slate-800
  divider: '#334155', // slate-700
  accent: '#22D3EE', // cyan-400
  accentSoft: '#67E8F9', // cyan-300
  fg: '#F8FAFC', // slate-50
  fgMuted: '#94A3B8', // slate-400
  success: '#22C55E', // green-500
  danger: '#EF4444', // red-500
  warning: '#F59E0B', // amber-500
};

// Outcome is rendered as a two-line stack now: a thin kicker ("I picked",
// "Won · +25 pts", etc) above a bold team name in cyan with a glow.
// `team` is null when the viewer isn't picking (anon spectator).
function deriveOutcome(game, choice, points) {
  if (!choice) return { kicker: 'No pick yet', team: null, accent: COLORS.fgMuted };
  const pickedTeam = displayTeamName(choice === 'home' ? game.homeTeam : game.awayTeam);
  if (!game.result) {
    return { kicker: 'I picked', team: pickedTeam, accent: COLORS.accent };
  }
  if (game.result === 'draw') {
    return { kicker: `Drew · +${points ?? 0} pts`, team: pickedTeam, accent: COLORS.warning };
  }
  if (game.result === choice) {
    return { kicker: `Won · +${points ?? 0} pts`, team: pickedTeam, accent: COLORS.success };
  }
  return { kicker: 'Missed', team: pickedTeam, accent: COLORS.danger };
}

function ShareableCard({ game, choice, points, ratio = 'square' }) {
  const isStory = ratio === 'story';
  const width = 1080;
  const height = isStory ? 1920 : 1080;
  const outcome = deriveOutcome(game, choice, points);
  const hasScores = typeof game.homeScore === 'number' && typeof game.awayScore === 'number';

  const homeIsPick = choice === 'home';
  const awayIsPick = choice === 'away';

  // Match date formatted in scoreboard style ("31 MAY 2026 · 18:00"). The
  // Date constructor accepts both Date instances and ISO strings, so the
  // caller doesn't need to coerce. Falls back to an empty string when the
  // game has no date (defensive — every real game does).
  const matchDate = (() => {
    if (!game.date) return '';
    const d = new Date(game.date);
    if (Number.isNaN(d.getTime())) return '';
    const day = d
      .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      .toUpperCase();
    const time = d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${day} · ${time}`;
  })();

  const root = {
    width: `${width}px`,
    height: `${height}px`,
    background: `radial-gradient(ellipse at top, ${COLORS.surface} 0%, ${COLORS.bg} 60%)`,
    color: COLORS.fg,
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    // Tighter top/bottom padding on story so the 5 flex children
    // (header / matchup / outcome / tagline / footer) distribute evenly
    // across the canvas without leaving a void above the footer.
    padding: isStory ? '100px 80px 100px' : '80px 80px 80px',
    display: 'flex',
    flexDirection: 'column',
    // `space-between` with 5 children produces even vertical gaps and
    // pins the first to the top + the last to the bottom. Earlier
    // `space-between` with only 2 children created the bottom void.
    justifyContent: 'space-between',
    boxSizing: 'border-box',
    position: 'relative',
    overflow: 'hidden',
  };

  // Accent glow blob — centred along the top so the brand area glows
  // symmetrically. Earlier off-axis (top-right) placement created a
  // brighter wedge against the darker right edge that read as a faint
  // vertical "dark bar" along the canvas margin. Centring evenly washes
  // both sides.
  const glow = {
    position: 'absolute',
    top: '-260px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '900px',
    height: '600px',
    background: `radial-gradient(ellipse, ${COLORS.accent}33 0%, ${COLORS.accent}00 60%)`,
    pointerEvents: 'none',
  };

  // BANTRYX wordmark — centred horizontally now that the kicker is gone.
  const headerRow = { display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const wordmark = {
    fontSize: '56px',
    fontWeight: 900,
    color: COLORS.accent,
    letterSpacing: '0.32em',
    fontFamily: "'Orbitron', 'JetBrains Mono', 'Courier New', monospace",
    textShadow: `0 0 24px ${COLORS.accent}66`,
  };

  // Small Orbitron-tracked date line — its own flex child now so the
  // root's `space-between` distribution places it equidistant between
  // the wordmark and the matchup (previously bundled under the wordmark
  // with a fixed 20 px gap).
  const dateLine = {
    textAlign: 'center',
    fontSize: '28px',
    fontWeight: 600,
    color: COLORS.accentSoft,
    letterSpacing: '0.32em',
    fontFamily: "'Orbitron', 'JetBrains Mono', 'Courier New', monospace",
  };

  // Tagline (NO BETTING / JUST BANTRYX) — stacked across two lines.
  // Thinner weight (600) + cyan glow so it reads as a sub-brand whisper
  // rather than a third headline. Margin removed — root flex handles
  // the vertical rhythm now.
  const tagline = {
    textAlign: 'center',
    fontFamily: "'Orbitron', 'JetBrains Mono', 'Courier New', monospace",
    fontWeight: 600,
    letterSpacing: '0.36em',
    color: COLORS.accentSoft,
    fontSize: '36px',
    lineHeight: 1.4,
    textShadow: `0 0 16px ${COLORS.accent}55, 0 0 32px ${COLORS.accent}33`,
  };

  const matchupBlock = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '48px',
    // Margins removed — root flex `space-between` with 5 children
    // handles the rhythm.
  };
  const teamBlock = (isPick) => ({
    flex: 1,
    textAlign: 'center',
    padding: '32px 24px',
    background: isPick ? `${outcome.accent}1F` : 'transparent',
    border: isPick ? `2px solid ${outcome.accent}66` : '2px solid transparent',
    borderRadius: '32px',
  });
  // `overflow-wrap: break-word` (modern) wraps only at safe break points
  // — whitespace and hyphens — and only mid-word as a last resort when a
  // single word can't fit on any line. Combined with a slightly smaller
  // font that fits "Manchester" on one line at the available box width,
  // this keeps long names readable instead of splitting them mid-letter
  // (the old `word-break: break-word` legacy alias did the latter).
  const teamName = {
    fontSize: '56px',
    fontWeight: 700,
    color: COLORS.fg,
    lineHeight: 1.15,
    overflowWrap: 'break-word',
    wordBreak: 'normal',
    hyphens: 'manual',
  };
  const scoreDigit = (isPick) => ({
    fontSize: '160px',
    fontWeight: 800,
    lineHeight: 1,
    marginTop: '24px',
    color: isPick ? outcome.accent : COLORS.fg,
    fontFamily: "'Orbitron', 'JetBrains Mono', 'Courier New', monospace",
    fontVariantNumeric: 'tabular-nums',
  });
  const versusBlock = {
    fontSize: '40px',
    fontWeight: 700,
    color: COLORS.fgMuted,
    letterSpacing: '0.2em',
  };

  // Outcome is now a borderless two-line stack: thin kicker on top, bold
  // cyan-glowing team name below. The surface card / border / padding
  // chrome was dropped per the latest design pass.
  const outcomeBlock = {
    textAlign: 'center',
  };
  const outcomeKicker = {
    fontSize: '38px',
    fontWeight: 500,
    color: COLORS.fgMuted,
    letterSpacing: '0.28em',
    fontFamily: "'Orbitron', 'JetBrains Mono', 'Courier New', monospace",
  };
  const outcomeTeam = {
    marginTop: '24px',
    fontSize: '88px',
    fontWeight: 800,
    color: outcome.accent,
    lineHeight: 1.1,
    letterSpacing: '0.02em',
    fontFamily: "'Orbitron', 'JetBrains Mono', 'Courier New', monospace",
    textShadow: `0 0 24px ${outcome.accent}80, 0 0 48px ${outcome.accent}55`,
    overflowWrap: 'break-word',
    wordBreak: 'normal',
  };

  const footer = {
    fontSize: '28px',
    color: COLORS.fgMuted,
    textAlign: 'center',
    letterSpacing: '0.04em',
  };
  const footerStrong = { fontWeight: 700, color: COLORS.accentSoft };

  return (
    <div style={root}>
      <div style={glow} aria-hidden="true" />

      {/* BANTRYX wordmark — its own flex child so the date below it gets
          equidistant spacing from the matchup. */}
      <div style={headerRow}>
        <div style={wordmark}>BANTRYX</div>
      </div>

      {/* Match date — flex child between wordmark and matchup. */}
      {matchDate ? <div style={dateLine}>{matchDate}</div> : null}

      {/* Matchup — Home / VS / Away. */}
      <div style={matchupBlock}>
        <div style={teamBlock(homeIsPick)}>
          <div style={teamName}>{displayTeamName(game.homeTeam)}</div>
          {hasScores ? <div style={scoreDigit(homeIsPick)}>{game.homeScore}</div> : null}
        </div>
        <div style={versusBlock}>VS</div>
        <div style={teamBlock(awayIsPick)}>
          <div style={teamName}>{displayTeamName(game.awayTeam)}</div>
          {hasScores ? <div style={scoreDigit(awayIsPick)}>{game.awayScore}</div> : null}
        </div>
      </div>

      {/* Outcome — thin "I picked" / etc kicker over a bold cyan team
          name with a soft glow. No surface card around it. */}
      <div style={outcomeBlock}>
        <div style={outcomeKicker}>{outcome.kicker}</div>
        {outcome.team ? <div style={outcomeTeam}>{outcome.team}</div> : null}
      </div>

      {/* Tagline — NO BETTING / JUST BANTRYX, thinner with a cyan glow. */}
      <div style={tagline}>
        <div>NO BETTING</div>
        <div>JUST BANTRYX</div>
      </div>

      {/* Brand footer pinned to the bottom by the root's
          `justify-content: space-between`. */}
      <div style={footer}>
        Predict · Compete · Climb · <span style={footerStrong}>bantryx.com</span>
      </div>
    </div>
  );
}

export default ShareableCard;
