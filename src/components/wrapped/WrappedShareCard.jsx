// World Cup Aftermatch (user-facing name; code keeps `wrapped`) — shareable
// summary card (capture source for the story's
// final "Share" action). Built exactly like src/components/ShareableCard.jsx:
// a fixed 1080×1920 (9:16) canvas with ALL styling inline, because
// html-to-image serialises the node's computed styles into the raster — the
// surrounding Tailwind context isn't available. Theme-independent hex values
// lock the brand look regardless of the viewer's Light/Dark preference.
//
// The weight/size pairs used here MUST be font-loaded before capture — see
// shareWrapped.js `ORBITRON_LOAD` (mirrors GameCard's captureAndShare gate).

import { displayTeamName } from '../../utils/teamNames';

const COLORS = {
  bg: '#0F172A',
  surface: '#1E293B',
  accent: '#22D3EE',
  accentSoft: '#67E8F9',
  fg: '#F8FAFC',
  fgMuted: '#94A3B8',
};

const ORBITRON = "'Orbitron', 'JetBrains Mono', 'Courier New', monospace";

function WrappedShareCard({ wrapped, name }) {
  const displayName = name || wrapped?.displayName || wrapped?.username || '';
  const points = wrapped?.summary?.points ?? 0;
  const topPercent = wrapped?.overall?.topPercent ?? null;
  const archetype = wrapped?.archetype || null;
  const team = wrapped?.teamOfTournament?.team || null;
  const boldest = wrapped?.boldestCall || null;

  const root = {
    width: '1080px',
    height: '1920px',
    background: `radial-gradient(ellipse at top, ${COLORS.surface} 0%, ${COLORS.bg} 60%)`,
    color: COLORS.fg,
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    padding: '110px 80px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    boxSizing: 'border-box',
    position: 'relative',
    overflow: 'hidden',
  };
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

  const header = { textAlign: 'center' };
  const wordmark = {
    fontSize: '56px',
    fontWeight: 900,
    color: COLORS.accent,
    letterSpacing: '0.32em',
    fontFamily: ORBITRON,
    textShadow: `0 0 24px ${COLORS.accent}66`,
  };
  const kicker = {
    marginTop: '28px',
    fontSize: '30px',
    fontWeight: 600,
    color: COLORS.accentSoft,
    letterSpacing: '0.34em',
    fontFamily: ORBITRON,
  };

  const pointsBlock = { textAlign: 'center' };
  const pointsValue = {
    fontSize: '220px',
    fontWeight: 800,
    lineHeight: 1,
    color: COLORS.accent,
    fontFamily: ORBITRON,
    fontVariantNumeric: 'tabular-nums',
    textShadow: `0 0 40px ${COLORS.accent}80, 0 0 80px ${COLORS.accent}44`,
  };
  const pointsLabel = {
    marginTop: '20px',
    fontSize: '34px',
    fontWeight: 600,
    color: COLORS.fgMuted,
    letterSpacing: '0.3em',
    fontFamily: ORBITRON,
  };
  const rankLine = {
    marginTop: '36px',
    fontSize: '46px',
    fontWeight: 700,
    color: COLORS.fg,
  };
  const rankStrong = { color: COLORS.accentSoft };

  const archetypeBlock = { textAlign: 'center' };
  const archetypeEmoji = { fontSize: '110px', lineHeight: 1 };
  const archetypeTitle = {
    marginTop: '16px',
    fontSize: '64px',
    fontWeight: 700,
    color: COLORS.fg,
    fontFamily: ORBITRON,
    letterSpacing: '0.04em',
    textShadow: `0 0 24px ${COLORS.accent}44`,
  };
  const teamLine = {
    marginTop: '28px',
    fontSize: '38px',
    fontWeight: 600,
    color: COLORS.fgMuted,
  };
  const teamStrong = { color: COLORS.fg, fontWeight: 700 };

  const upsetBlock = { textAlign: 'center' };
  const upsetLabel = {
    fontSize: '30px',
    fontWeight: 600,
    color: COLORS.accentSoft,
    letterSpacing: '0.32em',
    fontFamily: ORBITRON,
  };
  const upsetTeam = { marginTop: '16px', fontSize: '52px', fontWeight: 700, color: COLORS.fg };
  const upsetMeta = { marginTop: '12px', fontSize: '34px', fontWeight: 600, color: COLORS.accent };
  const upsetMatch = { marginTop: '10px', fontSize: '30px', color: COLORS.fgMuted };

  const tagline = {
    textAlign: 'center',
    fontFamily: ORBITRON,
    fontWeight: 600,
    letterSpacing: '0.36em',
    color: COLORS.accentSoft,
    fontSize: '34px',
    lineHeight: 1.4,
    textShadow: `0 0 16px ${COLORS.accent}55`,
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

      <div style={header}>
        <div style={wordmark}>BANTRYX</div>
        <div style={kicker}>WORLD CUP 2026 · AFTERMATCH</div>
        {displayName ? (
          <div style={{ ...kicker, marginTop: '14px', color: COLORS.fgMuted }}>{displayName}</div>
        ) : null}
      </div>

      <div style={pointsBlock}>
        <div style={pointsValue}>{points.toLocaleString('en-US')}</div>
        <div style={pointsLabel}>POINTS</div>
        {topPercent != null ? (
          <div style={rankLine}>
            Top <span style={rankStrong}>{topPercent}%</span> of predictors
          </div>
        ) : null}
      </div>

      {archetype ? (
        <div style={archetypeBlock}>
          <div style={archetypeEmoji} aria-hidden="true">
            {archetype.emoji}
          </div>
          <div style={archetypeTitle}>{archetype.title}</div>
          {team ? (
            <div style={teamLine}>
              Team of the tournament · <span style={teamStrong}>{displayTeamName(team)}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {boldest ? (
        <div style={upsetBlock}>
          <div style={upsetLabel}>BOLDEST CALL</div>
          <div style={upsetTeam}>{displayTeamName(boldest.pickedTeam)}</div>
          <div style={upsetMeta}>
            backed at {Math.round(boldest.probability * 100)}% · +{boldest.points} pts
          </div>
          <div style={upsetMatch}>
            {displayTeamName(boldest.homeTeam)} v {displayTeamName(boldest.awayTeam)}
            {boldest.stageLabel ? ` · ${boldest.stageLabel}` : ''}
          </div>
        </div>
      ) : null}

      <div style={tagline}>
        <div>NO BETTING</div>
        <div>JUST BANTRYX</div>
      </div>

      <div style={footer}>
        Predict · Compete · Climb · <span style={footerStrong}>bantryx.com</span>
      </div>
    </div>
  );
}

export default WrappedShareCard;
