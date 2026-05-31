// Tier 30 Phase 3 A4 — capture-source design template for share-as-image.
//
// Two ratios:
//   square — 1080x1080 (Instagram feed, Twitter, generic social)
//   story  — 1080x1920 (Instagram Story, WhatsApp Status, TikTok)
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

function deriveOutcome(game, choice, points) {
  if (!choice) return { label: 'No pick yet', accent: COLORS.fgMuted, kicker: '— SPECTATING —' };
  const pickedTeam = choice === 'home' ? game.homeTeam : game.awayTeam;
  if (!game.result) {
    return {
      label: `My pick: ${displayTeamName(pickedTeam)}`,
      accent: COLORS.accent,
      kicker: '— UPCOMING —',
    };
  }
  if (game.result === 'draw') {
    return {
      label: `Drew · +${points ?? 0} pts`,
      accent: COLORS.warning,
      kicker: '— DRAW —',
    };
  }
  if (game.result === choice) {
    return {
      label: `Won · +${points ?? 0} pts`,
      accent: COLORS.success,
      kicker: '— CORRECT PICK —',
    };
  }
  return { label: 'Missed', accent: COLORS.danger, kicker: '— BETTER LUCK NEXT TIME —' };
}

function ShareableCard({ game, choice, points, ratio = 'square' }) {
  const isStory = ratio === 'story';
  const width = 1080;
  const height = isStory ? 1920 : 1080;
  const outcome = deriveOutcome(game, choice, points);
  const hasScores = typeof game.homeScore === 'number' && typeof game.awayScore === 'number';

  const homeIsPick = choice === 'home';
  const awayIsPick = choice === 'away';

  const root = {
    width: `${width}px`,
    height: `${height}px`,
    background: `radial-gradient(ellipse at top, ${COLORS.surface} 0%, ${COLORS.bg} 60%)`,
    color: COLORS.fg,
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    padding: isStory ? '120px 80px 160px' : '80px 80px 80px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    boxSizing: 'border-box',
    position: 'relative',
    overflow: 'hidden',
  };

  // Accent glow blob (top-right) — adds visual weight without an external image.
  const glow = {
    position: 'absolute',
    top: '-200px',
    right: '-200px',
    width: '600px',
    height: '600px',
    background: `radial-gradient(circle, ${COLORS.accent}33 0%, ${COLORS.accent}00 60%)`,
    pointerEvents: 'none',
  };

  const headerRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  const wordmark = {
    fontSize: '52px',
    fontWeight: 900,
    color: COLORS.accent,
    letterSpacing: '0.32em',
  };
  const kicker = {
    fontSize: '24px',
    fontWeight: 600,
    color: outcome.accent,
    letterSpacing: '0.24em',
  };

  const matchupBlock = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '48px',
    marginTop: isStory ? '120px' : '40px',
  };
  const teamBlock = (isPick) => ({
    flex: 1,
    textAlign: 'center',
    padding: '32px 24px',
    background: isPick ? `${outcome.accent}1F` : 'transparent',
    border: isPick ? `2px solid ${outcome.accent}66` : '2px solid transparent',
    borderRadius: '32px',
  });
  const teamName = {
    fontSize: '64px',
    fontWeight: 700,
    color: COLORS.fg,
    lineHeight: 1.1,
    wordBreak: 'break-word',
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

  const outcomeBlock = {
    marginTop: isStory ? '120px' : '40px',
    padding: '40px 48px',
    background: COLORS.surface,
    borderRadius: '32px',
    textAlign: 'center',
    border: `1px solid ${COLORS.divider}`,
  };
  const outcomeLine = {
    fontSize: '56px',
    fontWeight: 800,
    color: outcome.accent,
    lineHeight: 1.2,
  };

  const footer = {
    fontSize: '28px',
    color: COLORS.fgMuted,
    textAlign: 'center',
    letterSpacing: '0.04em',
    marginTop: isStory ? '60px' : '32px',
  };
  const footerStrong = { fontWeight: 700, color: COLORS.accentSoft };

  return (
    <div style={root}>
      <div style={glow} aria-hidden="true" />
      <div style={headerRow}>
        <div style={wordmark}>BANTRYX</div>
        <div style={kicker}>{outcome.kicker}</div>
      </div>

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

      <div style={outcomeBlock}>
        <div style={outcomeLine}>{outcome.label}</div>
      </div>

      <div style={footer}>
        Predict · Compete · Climb · <span style={footerStrong}>bantryx.com</span>
      </div>
    </div>
  );
}

export default ShareableCard;
