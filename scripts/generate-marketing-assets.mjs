// Generate the Bantryx social-media marketing kit (Tier 31).
//
// Mirrors scripts/generate-pwa-assets.mjs: hand-authored SVG → PNG via
// @resvg/resvg-js. resvg is fed the bundled TTFs in marketing/fonts/ through
// its `font.fontFiles` option so the Orbitron "BANTRYX" wordmark renders in
// the real brand face (resvg loads no webfonts on its own).
//
// Output: marketing/out/*.png — ready to grab and post. Re-run any time copy
// or branding changes:  npm run assets:marketing
//
// Fonts (marketing/fonts/) are SIL OFL 1.1 — free to embed + redistribute.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import QRCode from 'qrcode';
import {
  COLOR,
  FONT,
  esc,
  background,
  wordmark,
  wordmarkWidth,
  rule,
  ctaPill,
  textBlock,
  wrapLines,
  footer,
  iconBadge,
  svgDoc,
} from '../marketing/lib/brand.mjs';
import { gameCard, leaderboardCard, statsPage, statsCharts } from '../marketing/lib/product.mjs';
import {
  openDb,
  fetchUserCount,
  fetchUpcomingGames,
  fetchLiveGames,
  fetchFinishedGames,
  fetchTopPlayers,
} from '../marketing/lib/livedata.mjs';
// Shared with the matchday cron job (lib/jobs/postMatchdayGraphics.js): the
// four live-fixture renderers + the rasterizer live in render.mjs so both
// callers produce byte-identical PNGs.
import {
  loadFonts,
  rasterize,
  topMark,
  fitOrbitron,
  renderPicksVsModel,
  renderKickoffCountdown,
  renderHalftime,
  renderFulltime,
  renderTopPlayers,
  renderStreaksFeature,
} from '../marketing/lib/render.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'marketing/out');

const URL = 'bantryx.com';
const KICKER = 'PREDICT · COMPETE · CLIMB';

// ── Format dimensions ────────────────────────────────────────────────────
const SIZE = {
  square: [1080, 1080],
  story: [1080, 1920],
  landscape: [1600, 900],
  card: [1200, 630],
  flyer: [2480, 3508], // A4 @ 300dpi
};

// Size an Orbitron BANTRYX wordmark to fill a target pixel width.
function wmSizeFor(targetW) {
  let size = targetW / 9.4;
  while (wordmarkWidth(size) > targetW && size > 8) size -= 1;
  return Math.round(size);
}

// ── Content ──────────────────────────────────────────────────────────────
const FEATURES = [
  {
    key: 'scoring',
    icon: 'target',
    label: 'Scoring',
    headline: 'Pick smart, not safe',
    sub: 'A 38% underdog upset is worth +62 points — favourites far less. Bantryx rewards the brave call.',
  },
  {
    key: 'groups',
    icon: 'users',
    label: 'Groups',
    headline: 'Beat your group chat',
    sub: 'Spin up invite-only leagues for your crew and race to the top of your own private leaderboard.',
  },
  {
    key: 'leaderboards',
    icon: 'trending',
    label: 'Live ranks',
    headline: 'Climb in real time',
    sub: 'Standings update the moment a result lands — no waiting until Monday morning to see where you stand.',
  },
  {
    key: 'badges',
    icon: 'award',
    label: 'Badges',
    headline: 'Collect the bragging rights',
    sub: 'Unlock badges for streaks, upsets, perfect weekends and 100-point picks. Glory, codified.',
  },
];

const STATS = [
  { key: '62', icon: 'target', big: '+62', label: 'points for backing a 38% underdog' },
  { key: 'groups', icon: 'users', big: '∞', label: 'private groups for your crew' },
  { key: '30s', icon: 'zap', big: '30s', label: 'from sign-up to your first pick' },
  { key: 'free', icon: 'gift', big: '$0', label: 'free to play, no betting' },
];

const STEPS = [
  { n: '01', title: 'Sign up free', body: 'Under 30 seconds. No credit card, no betting.' },
  {
    n: '02',
    title: 'Pick your winners',
    body: 'Browse matches and lock picks right up to kickoff.',
  },
  {
    n: '03',
    title: 'Climb the rankings',
    body: 'Earn points by probability and rise up the live board.',
  },
];

// ── Hero kicker ──────────────────────────────────────────────────────────
function kicker(cx, y, size = 26, ls = size * 0.45) {
  return `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${size}" letter-spacing="${ls}" fill="${COLOR.cyan}">${esc(KICKER)}</text>`;
}

// First-line baseline that vertically centres an n-line text block within the
// gap [gapTop, gapBottom]. Used to sit a headline equidistant between the icon
// circle above it and the sub copy below it.
function centeredBlockBaseline(gapTop, gapBottom, n, size, lh) {
  const gapCenter = (gapTop + gapBottom) / 2;
  return gapCenter + size * 0.34 - ((n - 1) * lh) / 2;
}

// ── Launch hero (square / story / landscape) ─────────────────────────────
function renderLaunch(format) {
  if (format === 'card') return renderLaunchCard();
  const [w, h] = SIZE[format];
  const cx = w / 2;

  const L = {
    square: {
      kickY: 320,
      wmTargetW: 940,
      wmY: 500,
      tagY: 580,
      bodyY: 700,
      bodySize: 46,
      ctaY: 866,
      ctaSize: 36,
      urlY: 1004,
    },
    story: {
      kickY: 540,
      wmTargetW: 940,
      wmY: 720,
      tagY: 804,
      bodyY: 928,
      bodySize: 50,
      ctaY: 1560,
      ctaSize: 40,
      urlY: 1756,
    },
    landscape: {
      kickY: 222,
      wmTargetW: 1180,
      wmY: 420,
      tagY: 494,
      bodySize: 38,
      bodyY: 584,
      ctaY: 712,
      ctaSize: 33,
      urlY: 856,
    },
  }[format];

  const wmSize = wmSizeFor(L.wmTargetW);
  const bodyLines = ['Free football predictions.', 'Climb the live leaderboard.'];
  const body = `
  ${background(w, h)}
  ${kicker(cx, L.kickY, format === 'landscape' ? 24 : 28)}
  ${wordmark({ x: cx, y: L.wmY, size: wmSize, anchor: 'middle' })}
  <text x="${cx}" y="${L.tagY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${format === 'landscape' ? 30 : 34}" letter-spacing="${format === 'landscape' ? 7 : 9}" fill="${COLOR.cyanSoft}">NO BETTING, JUST BANTRYX</text>
  ${textBlock({ x: cx, y: L.bodyY, anchor: 'middle', size: L.bodySize, font: FONT.body, fill: COLOR.textHi, lines: bodyLines, lineHeight: L.bodySize * 1.32 })}
  ${ctaPill({ cx, y: L.ctaY, label: 'Play free at bantryx.com', size: L.ctaSize })}
  <text x="${cx}" y="${L.urlY}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="${format === 'landscape' ? 28 : 32}" letter-spacing="2" fill="${COLOR.muted}">${URL}</text>`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.3 } });
}

// Link preview card (1200×630) — centred Orbitron wordmark.
function renderLaunchCard() {
  const [w, h] = SIZE.card;
  const cx = w / 2;
  const wmSize = wmSizeFor(1040);
  const body = `
  ${background(w, h)}
  ${kicker(cx, 196, 24)}
  ${wordmark({ x: cx, y: 330, size: wmSize, anchor: 'middle' })}
  <text x="${cx}" y="${400}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="28" letter-spacing="6" fill="${COLOR.cyanSoft}">NO BETTING, JUST BANTRYX</text>
  ${textBlock({ x: cx, y: 472, anchor: 'middle', size: 32, font: FONT.body, fill: COLOR.textHi, lines: ['Free football predictions.', 'Climb the live leaderboard.'], lineHeight: 44 })}
  <text x="${cx}" y="${578}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="34" letter-spacing="2" fill="${COLOR.cyanSoft}">${URL}</text>`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.42 } });
}

// Profile picture — just the centred BANTRYX wordmark on the brand
// background. Square, but composed for a CIRCLE crop (IG/social avatars):
// the wordmark + underline sit centred and well inside the inscribed circle.
function renderProfilePic() {
  const [w, h] = SIZE.square;
  const cx = w / 2;
  const wmSize = wmSizeFor(820); // ~76% width keeps the B…X inside the circle
  const wmY = h / 2 + wmSize * 0.34 - 26; // nudge up so wordmark+rule centre
  const body = `
  ${background(w, h)}
  ${wordmark({ x: cx, y: wmY, size: wmSize, anchor: 'middle' })}
  ${rule({ x: cx - 165, y: wmY + 46, w: 330 })}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.5, glowR: 0.62 } });
}

// ── Feature highlight (square / story) ───────────────────────────────────
function renderFeature(feat, format) {
  const [w, h] = SIZE[format];
  const cx = w / 2;
  const story = format === 'story';
  const iconCy = story ? h * 0.32 : h * 0.34;
  const badgeR = story ? 200 : 168;
  const iconSize = story ? 200 : 168;
  const headSize = story ? 72 : 58;
  const subSize = story ? 42 : 38;
  const headLines = wrapLines(feat.headline, story ? 18 : 20);
  const subLines = wrapLines(feat.sub, story ? 38 : 42);

  // Sub block sits a fixed distance above the footer; the headline is then
  // centred in the gap between the icon circle and the sub.
  const headLh = headSize * 1.08;
  const subFirstBaseline = story ? 1190 : 792;
  const iconBottom = iconCy + badgeR;
  const headBaseline = centeredBlockBaseline(
    iconBottom,
    subFirstBaseline - subSize,
    headLines.length,
    headSize,
    headLh,
  );

  const body = `
  ${background(w, h)}
  ${topMark(cx, story ? 250 : 132, story ? 50 : 46)}
  ${iconBadge({ name: feat.icon, cx, cy: iconCy, badgeR, iconSize })}
  ${textBlock({ x: cx, y: headBaseline, anchor: 'middle', size: headSize, font: FONT.bodyBlack, fill: COLOR.white, lines: headLines, lineHeight: headLh })}
  ${textBlock({ x: cx, y: subFirstBaseline, anchor: 'middle', size: subSize, font: FONT.body, fill: COLOR.muted, lines: subLines, lineHeight: subSize * 1.4 })}
  ${footer({ cx, y: h - (story ? 210 : 150), w: w * 0.64 })}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.32 } });
}

// ── Stat teaser (square / story) ─────────────────────────────────────────
function renderStat(stat, format) {
  const [w, h] = SIZE[format];
  const cx = w / 2;
  const story = format === 'story';
  const bigCy = story ? h * 0.45 : h * 0.52;
  const bigSize = story ? 540 : 350;
  const labelLines = wrapLines(stat.label, story ? 24 : 26);
  const labelY = bigCy + bigSize * 0.34 + (story ? 64 : 90);

  const body = `
  ${background(w, h)}
  ${topMark(cx, story ? 235 : 132, story ? 50 : 46)}
  ${iconBadge({ name: stat.icon, cx, cy: story ? h * 0.21 : h * 0.278, badgeR: story ? 110 : 82, iconSize: story ? 96 : 74, color: COLOR.cyan })}
  <text x="${cx}" y="${bigCy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.display}" font-size="${bigSize}" fill="url(#mark)">${esc(stat.big)}</text>
  ${textBlock({ x: cx, y: labelY, anchor: 'middle', size: story ? 50 : 44, font: FONT.bodySemi, fill: COLOR.textHi, lines: labelLines, lineHeight: (story ? 50 : 44) * 1.35 })}
  ${footer({ cx, y: h - (story ? 220 : 160), w: w * 0.64 })}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.42 } });
}

// ── How-to (square / story) ──────────────────────────────────────────────
function renderHowto(format) {
  const [w, h] = SIZE[format];
  const cx = w / 2;
  const story = format === 'story';
  const tagY = story ? 250 : 120;

  const headY = tagY + (story ? 220 : 180);
  const listY = headY + (story ? 170 : 120);
  const rowH = story ? 380 : 200;
  const rowScale = story ? 1 : 0.82;

  const rows = STEPS.map((s, i) => {
    const y = listY + i * rowH;
    const numSize = (story ? 150 : 110) * rowScale;
    const titleSize = (story ? 60 : 48) * rowScale;
    const bodySize = (story ? 38 : 32) * rowScale;
    const bodyLh = bodySize * 1.35;
    const leftX = story ? 150 : 130;
    const textX = leftX + numSize * 1.95; // Orbitron numerals are wider than Bebas
    const bodyLines = wrapLines(s.body, story ? 30 : 34);

    // Vertically centre BOTH the number and the title+body block on a shared
    // mid-line so the guidance text reads centred against the big numeral.
    const midY = y + numSize * 0.5;
    const numBaseline = midY + numSize * 0.36;
    const titleGap = titleSize * 0.95; // title baseline → first body baseline
    const blockCenterRel =
      (-0.72 * titleSize + titleGap + (bodyLines.length - 1) * bodyLh + 0.08 * bodySize) / 2;
    const titleBaseline = midY - blockCenterRel;
    const bodyFirstBaseline = titleBaseline + titleGap;
    return `
    <text x="${leftX}" y="${numBaseline}" font-family="${FONT.brand}" font-weight="700" font-size="${numSize}" fill="url(#mark)">${s.n}</text>
    <text x="${textX}" y="${titleBaseline}" font-family="${FONT.bodySemi}" font-size="${titleSize}" fill="${COLOR.white}" letter-spacing="0.5">${esc(s.title)}</text>
    ${textBlock({ x: textX, y: bodyFirstBaseline, size: bodySize, font: FONT.body, fill: COLOR.muted, lines: bodyLines, lineHeight: bodyLh })}
    ${i < STEPS.length - 1 ? rule({ x: leftX, y: y + rowH - (story ? 90 : 60), w: w - leftX * 2 }) : ''}`;
  }).join('\n');

  const body = `
  ${background(w, h)}
  ${topMark(cx, story ? 235 : 116, story ? 50 : 46)}
  <text x="${cx}" y="${headY}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="${story ? 92 : 72}" fill="${COLOR.white}" letter-spacing="0.5">How it works</text>
  <text x="${cx}" y="${headY + (story ? 70 : 54)}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 38 : 32}" letter-spacing="2" fill="${COLOR.cyanSoft}">Three steps. No catch. No paywall.</text>
  ${rows}
  ${footer({ cx, y: h - (story ? 200 : 120), w: w * 0.64 })}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.3 } });
}

// ── "Share your pick — tag @bantryx.app" (square / story) ────────────────
// Community-growth prompt: screenshot your pick → IG story → tag the brand
// account. Static (no live data). Handle is the hero element, rendered as a
// big cyan-gradient Bebas wordmark (same face as the stat big-numbers).
function renderShareToStory(format) {
  const [w, h] = SIZE[format];
  const cx = w / 2;
  const story = format === 'story';

  const L = {
    square: {
      topY: 132,
      headY: 360,
      headSize: 76,
      headLh: 86,
      tagY: 612,
      tagSize: 40,
      handleCy: 748,
      handleSize: 60,
    },
    story: {
      topY: 250,
      headY: 700,
      headSize: 100,
      headLh: 116,
      tagY: 1080,
      tagSize: 48,
      handleCy: 1296,
      handleSize: 64,
    },
  }[format];

  const body = `
  ${background(w, h)}
  ${topMark(cx, L.topY, story ? 50 : 46)}
  ${textBlock({ x: cx, y: L.headY, anchor: 'middle', size: L.headSize, font: FONT.bodyBlack, fill: COLOR.white, lines: ['Share your pick', 'to your story'], lineHeight: L.headLh, letterSpacing: 0.5 })}
  <text x="${cx}" y="${L.tagY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${L.tagSize}" letter-spacing="2" fill="${COLOR.cyanSoft}">and tag us</text>
  <text x="${cx}" y="${L.handleCy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${L.handleSize}" letter-spacing="${L.handleSize * 0.02}" fill="url(#mark)">${esc('@bantryx.app')}</text>
  ${footer({ cx, y: h - (story ? 220 : 160), w: w * 0.64 })}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.3 } });
}

// ── Printable A4 flyer with QR ───────────────────────────────────────────
async function renderFlyer() {
  const [w, h] = SIZE.flyer;
  const cx = w / 2;

  const qrPx = 520;
  const qrModules = await QRCode.create(`https://${URL}`, { errorCorrectionLevel: 'M' });
  const qrSvg = qrToSvg(qrModules, qrPx);
  const qrX = cx - qrPx / 2;
  const qrY = 2440;

  const statCards = STATS.slice(0, 3)
    .map((s, i) => {
      const cardW = 640;
      const gap = 60;
      const totalW = cardW * 3 + gap * 2;
      const x = cx - totalW / 2 + i * (cardW + gap);
      const y = 1400;
      const cardH = 360;
      return `
      <rect x="${x}" y="${y}" rx="36" width="${cardW}" height="${cardH}" fill="rgba(15,23,42,0.7)" stroke="${COLOR.border}" stroke-width="3"/>
      ${iconBadge({ name: s.icon, cx: x + cardW / 2, cy: y + 66, badgeR: 60, iconSize: 52, color: COLOR.cyan, disc: false })}
      <text x="${x + cardW / 2}" y="${y + 202}" text-anchor="middle" font-family="${FONT.display}" font-size="134" fill="url(#mark)">${esc(s.big)}</text>
      ${textBlock({ x: x + cardW / 2, y: y + 268, anchor: 'middle', size: 34, font: FONT.bodyMed, fill: COLOR.muted, lines: wrapLines(s.label, 26), lineHeight: 44 })}`;
    })
    .join('\n');

  const stepRow = STEPS.map((s, i) => {
    const colW = w / 3;
    const x = colW * i + colW / 2;
    const y = 2090;
    return `
    <text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="124" fill="url(#mark)">${s.n}</text>
    <text x="${x}" y="${y + 92}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="54" fill="${COLOR.white}" letter-spacing="0.5">${esc(s.title)}</text>
    ${textBlock({ x, y: y + 152, anchor: 'middle', size: 32, font: FONT.body, fill: COLOR.muted, lines: wrapLines(s.body, 30), lineHeight: 44 })}`;
  }).join('\n');

  const wmSize = wmSizeFor(2100);
  const body = `
  ${background(w, h, { grid: true })}
  ${kicker(cx, 600, 46)}
  ${wordmark({ x: cx, y: 880, size: wmSize, anchor: 'middle' })}
  <text x="${cx}" y="${1040}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="52" letter-spacing="12" fill="${COLOR.cyanSoft}">NO BETTING, JUST BANTRYX</text>
  <text x="${cx}" y="${1230}" text-anchor="middle" font-family="${FONT.body}" font-size="56" fill="${COLOR.textHi}">Predict football. Outpick your friends. Climb the leaderboard.</text>
  ${statCards}
  ${rule({ x: cx - 900, y: 1840, w: 1800 })}
  <text x="${cx}" y="${1930}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="72" fill="${COLOR.white}" letter-spacing="0.5">How it works</text>
  ${stepRow}
  <g transform="translate(${qrX} ${qrY})">
    <rect x="-40" y="-40" rx="40" width="${qrPx + 80}" height="${qrPx + 80}" fill="${COLOR.white}"/>
    ${qrSvg}
  </g>
  <text x="${cx}" y="${qrY + qrPx + 160}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="92" letter-spacing="0.5" fill="url(#mark)">Play free at bantryx.com</text>
  <text x="${cx}" y="${qrY + qrPx + 260}" text-anchor="middle" font-family="${FONT.bodyMed}" font-size="42" letter-spacing="2" fill="${COLOR.muted}">Scan the code  ·  Free to play  ·  No betting  ·  13+</text>`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.18, glowR: 0.7 } });
}

// ── Product mockups — real GameCard + Leaderboard UI ─────────────────────
// Past Premier League fixtures + fake users. The card visuals are faithful
// re-creations of the live components (marketing/lib/product.mjs).

const GAMES = {
  upcoming: {
    home: 'Arsenal',
    away: 'Aston Villa',
    dateLabel: 'Sat 31 May',
    kickoff: '17:30',
    pts: { home: 44, away: 66, drawH: 4, drawA: 6 },
    pickSide: null,
    pickTeam: null,
  },
  live: {
    home: 'Man City',
    away: 'Chelsea',
    dateLabel: 'Today',
    minute: "67'",
    homeScore: 2,
    awayScore: 1,
    pickSide: 'home',
    pickTeam: 'Man City',
    points: 48,
  },
  final: {
    home: 'Arsenal',
    away: 'Aston Villa',
    dateLabel: 'Sat 31 May',
    homeScore: 0,
    awayScore: 1,
    result: 'away',
    pickSide: 'away',
    pickTeam: 'Aston Villa',
    points: 66,
  },
};

// One fixture across all three states, for the lifecycle story:
// Man City vs Aston Villa, 1–2 — the user backs the underdog Villa and wins.
const LIFECYCLE = {
  upcoming: {
    home: 'Man City',
    away: 'Aston Villa',
    dateLabel: 'May 24, 2026',
    kickoff: '15:00',
    pts: { home: 34, away: 74, drawH: 2, drawA: 6 },
    pickSide: 'away',
    pickTeam: 'Aston Villa',
  },
  live: {
    home: 'Man City',
    away: 'Aston Villa',
    dateLabel: 'Today',
    minute: "73'",
    homeScore: 1,
    awayScore: 2,
    pickSide: 'away',
    pickTeam: 'Aston Villa',
    points: 74,
  },
  final: {
    home: 'Man City',
    away: 'Aston Villa',
    dateLabel: 'May 24, 2026',
    homeScore: 1,
    awayScore: 2,
    result: 'away',
    pickSide: 'away',
    pickTeam: 'Aston Villa',
    points: 74,
  },
};

// NOTE: no `streak` field — the live leaderboard doesn't display win streaks,
// so the mockup doesn't either (would misrepresent the product).
// Fake profile for the stats-page mockup (mirrors ProfileView Summary tab).
const STATS_PROFILE = {
  name: 'TheGaffer',
  username: 'thegaffer',
  joined: 'Joined May 2026',
  tiles: [
    { label: ['Total', 'points'], value: '1,040' },
    { label: ['Picks', 'made'], value: '28' },
    { label: ['Picks', 'won'], value: '16' },
    { label: ['Win', 'rate'], value: '57%' },
    { label: ['Best', 'streak'], value: '4' },
  ],
  activity: [
    {
      home: 'Man City',
      away: 'Aston Villa',
      pick: 'Aston Villa',
      status: 'Won +74',
      tone: 'success',
    },
    { home: 'Arsenal', away: 'Chelsea', pick: 'Arsenal', status: 'Missed', tone: 'danger' },
    { home: 'Liverpool', away: 'Tottenham', pick: 'Liverpool', status: 'Won +48', tone: 'success' },
  ],
};

// Sample data for the stats-dashboard charts mockup (mirrors StatsDashboard).
const STATS_CHARTS = {
  summary: [
    { label: 'Picks', value: '28' },
    { label: 'Scored', value: '24' },
    { label: 'Wins', value: '16', accent: true },
    { label: 'Win rate', value: '57%' },
  ],
  pointsOverTime: {
    daily: [42, 0, 58, 24, 0, 76, 33, 0, 61, 70, 12, 48, 0, 64, 28, 52],
    cumulative: [42, 42, 100, 124, 124, 200, 233, 233, 294, 364, 376, 424, 424, 488, 516, 568],
    xLabels: ['5/01', '5/04', '5/08', '5/12', '5/16'],
  },
  perLeague: [
    { name: 'Prem', wins: 12, draws: 4, losses: 6 },
    { name: 'UCL', wins: 5, draws: 2, losses: 3 },
    { name: 'World Cup', wins: 6, draws: 2, losses: 2 },
  ],
  heatmap: Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const weekend = d === 0 || d === 6;
      if (weekend && h >= 12 && h <= 18) return Math.min(5, 2 + ((h + d) % 4));
      if (!weekend && h >= 18 && h <= 22) return Math.min(5, 1 + ((h + d) % 3));
      if (h >= 11 && h <= 14 && (d + h) % 3 === 0) return 1;
      return 0;
    }),
  ),
};

// Offline fallback for the top-3 graphic (matches fetchTopPlayers' shape).
const SAMPLE_TOP_PLAYERS = [
  { username: 'KingKenji', points: 1420, streak: 6 },
  { username: 'PiratePam', points: 1280, streak: 4 },
  { username: 'xGWizard', points: 1190, streak: 3 },
];

const LEADERBOARD = [
  { name: 'KingKenji', points: 1420 },
  { name: 'PiratePam', points: 1280 },
  { name: 'xGWizard', points: 1190 },
  { name: 'TheGaffer', points: 1040, you: true },
  { name: 'OffsideOllie', points: 980 },
  { name: 'CleanSheetCleo', points: 905 },
  { name: 'VARisReal', points: 860 },
  { name: 'SundayLeaguer', points: 720 },
];

// Single product card centred on a square, with heading + footer.
function renderProductCard({ state, data, heading, sub }) {
  const [w, h] = SIZE.square;
  const cx = w / 2;
  const cardW = 840;
  const cardX = (w - cardW) / 2;
  // generate once to learn its height, then vertically centre between the
  // heading block (~330) and the footer (~h-150).
  const probe = gameCard({ x: cardX, y: 0, w: cardW, state, data });
  const top = 350;
  const bottom = h - 170;
  const cardY = Math.max(top, top + (bottom - top - probe.h) / 2);
  const card = gameCard({ x: cardX, y: cardY, w: cardW, state, data });

  const body = `
  ${background(w, h)}
  ${topMark(cx, 116, 46)}
  <text x="${cx}" y="${232}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="54" fill="${COLOR.white}" letter-spacing="0.5">${esc(heading)}</text>
  <text x="${cx}" y="${292}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="28" letter-spacing="1" fill="${COLOR.cyanSoft}">${esc(sub)}</text>
  ${card.svg}
  <text x="${cx}" y="${h - 96}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="30" letter-spacing="2" fill="${COLOR.muted}">${URL}</text>`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.18, glowR: 0.7 } });
}

// Three states of one fixture stacked — the full game lifecycle.
function renderGameLifecycle() {
  const [w, h] = SIZE.story;
  const cx = w / 2;
  const cardW = 880;
  const cardX = (w - cardW) / 2;
  const states = [
    { state: 'upcoming', data: LIFECYCLE.upcoming, tag: 'PICK' },
    { state: 'live', data: LIFECYCLE.live, tag: 'LIVE' },
    { state: 'final', data: LIFECYCLE.final, tag: 'RESULT' },
  ];
  let cursor = 470;
  const blocks = states
    .map(({ state, data, tag }) => {
      const card = gameCard({ x: cardX, y: cursor, w: cardW, state, data });
      const label = `<text x="${cardX}" y="${cursor - 16}" font-family="${FONT.bodySemi}" font-size="24" letter-spacing="4" fill="${COLOR.cyan}">${tag}</text>`;
      cursor += card.h + 74;
      return label + card.svg;
    })
    .join('\n');

  const body = `
  ${background(w, h)}
  ${topMark(cx, 250, 50)}
  <text x="${cx}" y="${360}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="76" fill="${COLOR.white}" letter-spacing="0.5">From pick to points</text>
  <text x="${cx}" y="${418}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="30" letter-spacing="2" fill="${COLOR.cyanSoft}">Back the underdog. Climb the table.</text>
  ${blocks}
  ${footer({ cx, y: h - 150, w: w * 0.64 })}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.12, glowR: 0.7 } });
}

function renderLeaderboard(format) {
  const [w, h] = SIZE[format];
  const cx = w / 2;
  const story = format === 'story';
  const cardW = 880;
  const cardX = (w - cardW) / 2;
  const rows = story ? LEADERBOARD : LEADERBOARD.slice(0, 5);
  const probe = leaderboardCard({
    x: cardX,
    y: 0,
    w: cardW,
    title: 'Leaderboard',
    description: '',
    rows,
  });
  const top = story ? 470 : 300;
  const bottom = story ? h - 170 : h - 110;
  const cardY = story ? top : Math.max(top, top + (bottom - top - probe.h) / 2);
  const card = leaderboardCard({
    x: cardX,
    y: cardY,
    w: cardW,
    title: 'Leaderboard',
    description: 'Top performers by correct picks × probability scoring.',
    rows,
  });

  const headSize = story ? 80 : 60;
  const body = `
  ${background(w, h)}
  ${topMark(cx, story ? 235 : 110, story ? 50 : 46)}
  <text x="${cx}" y="${story ? 376 : 220}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="${headSize}" fill="${COLOR.white}" letter-spacing="0.5">Climb the table</text>
  <text x="${cx}" y="${story ? 436 : 274}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 30 : 28}" letter-spacing="1" fill="${COLOR.cyanSoft}">Outpick your group. Rise up the table.</text>
  ${card.svg}
  ${story ? footer({ cx, y: h - 150, w: w * 0.64 }) : `<text x="${cx}" y="${h - 56}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="30" letter-spacing="2" fill="${COLOR.muted}">${URL}</text>`}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.16, glowR: 0.7 } });
}

function renderStatsCharts(format) {
  const [w, h] = SIZE[format];
  const cx = w / 2;
  const story = format === 'story';
  const cardW = story ? 940 : 920;
  const cardX = (w - cardW) / 2;
  const probe = statsCharts({ x: cardX, y: 0, w: cardW, data: STATS_CHARTS, full: story });
  const top = story ? 470 : 318;
  const bottom = story ? h - 160 : h - 100;
  const cardY = story ? top : Math.max(top, top + (bottom - top - probe.h) / 2);
  const card = statsCharts({ x: cardX, y: cardY, w: cardW, data: STATS_CHARTS, full: story });

  const headSize = story ? 80 : 60;
  const body = `
  ${background(w, h)}
  ${topMark(cx, story ? 230 : 108, story ? 50 : 46)}
  <text x="${cx}" y="${story ? 372 : 216}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="${headSize}" fill="${COLOR.white}" letter-spacing="0.5">See your trends</text>
  <text x="${cx}" y="${story ? 428 : 268}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 30 : 28}" letter-spacing="1" fill="${COLOR.cyanSoft}">Points, win-rate, leagues — all charted for you.</text>
  ${card.svg}
  ${story ? footer({ cx, y: h - 140, w: w * 0.64 }) : `<text x="${cx}" y="${h - 52}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="30" letter-spacing="2" fill="${COLOR.muted}">${URL}</text>`}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.14, glowR: 0.7 } });
}

function renderStats(format) {
  const [w, h] = SIZE[format];
  const cx = w / 2;
  const story = format === 'story';
  const cardW = 880;
  const cardX = (w - cardW) / 2;
  const activityCount = story ? 3 : 2;
  const probe = statsPage({ x: cardX, y: 0, w: cardW, data: STATS_PROFILE, activityCount });
  const top = story ? 470 : 320;
  const bottom = story ? h - 170 : h - 110;
  const cardY = story ? top : Math.max(top, top + (bottom - top - probe.h) / 2);
  const card = statsPage({ x: cardX, y: cardY, w: cardW, data: STATS_PROFILE, activityCount });

  const headSize = story ? 80 : 60;
  const body = `
  ${background(w, h)}
  ${topMark(cx, story ? 235 : 110, story ? 50 : 46)}
  <text x="${cx}" y="${story ? 376 : 220}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="${headSize}" fill="${COLOR.white}" letter-spacing="0.5">Track your stats</text>
  <text x="${cx}" y="${story ? 432 : 272}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 30 : 28}" letter-spacing="1" fill="${COLOR.cyanSoft}">Every pick, point and streak in one place.</text>
  ${card.svg}
  ${story ? footer({ cx, y: h - 150, w: w * 0.64 }) : `<text x="${cx}" y="${h - 56}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="30" letter-spacing="2" fill="${COLOR.muted}">${URL}</text>`}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.16, glowR: 0.7 } });
}

// ── Live-data assets — picks-vs-model + thank-you ────────────────────────
// These two pull from production via marketing/lib/livedata.mjs (when
// DATABASE_URL is set) and fall back to the samples below otherwise, so the
// kit still renders offline. Unlike the 29 deterministic assets above, these
// reflect whatever the DB held at generation time — re-run before a post.

const SAMPLE_USER_COUNT = 240;
const SAMPLE_UPCOMING = [
  {
    home: 'Arsenal',
    away: 'Aston Villa',
    dateLabel: 'Sat 31 May',
    kickoff: '17:30',
    leagueName: 'Premier League',
    probs: { home: 0.58, draw: 0.24, away: 0.18 },
    crowd: { home: 412, away: 188, total: 600 },
  },
  {
    home: 'Brazil',
    away: 'France',
    dateLabel: 'Sun 1 Jun',
    kickoff: '20:00',
    leagueName: 'World Cup',
    probs: { home: 0.41, draw: 0.27, away: 0.32 },
    crowd: { home: 0, away: 0, total: 0 },
  },
];

// Offline fallback for the "get your picks in" countdown card: Mexico vs
// South Africa, kicking off in 3 hours. With a live DB the card instead
// features the soonest upcoming fixture (upcoming[0]) and its real countdown.
const SAMPLE_COUNTDOWN = {
  home: 'Mexico',
  away: 'South Africa',
  leagueName: 'World Cup',
  kickoffAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
};

// Offline fallback for the halftime score card. With a live DB it instead
// features an in-progress fixture (preferring one that has reached half-time).
const SAMPLE_HALFTIME = {
  home: 'Brazil',
  away: 'France',
  homeScore: 1,
  awayScore: 0,
  leagueName: 'World Cup',
};

// Offline fallback for the full-time result card. A 38% home win → +62 pts
// (ties the brand's "+62 for a 38% upset" stat). With a live DB it features
// the most recent decisive finished fixture and its real points.
const SAMPLE_FULLTIME = {
  home: 'Brazil',
  away: 'France',
  homeScore: 2,
  awayScore: 1,
  result: 'home',
  winner: 'Brazil',
  points: 62,
  leagueName: 'World Cup',
};

// Floor a user count to a clean, honest milestone for display. Big crowds
// round to "+1000"/"500+"/"300+" so the number stays tidy and never
// overstates; a small launch crowd (<50) shows its exact value (a "+"
// would feel like puffery at that size).
function roundDownToMilestone(n) {
  if (n >= 1000) return `${Math.floor(n / 1000) * 1000}+`;
  if (n >= 500) return '500+';
  if (n >= 200) return `${Math.floor(n / 100) * 100}+`;
  if (n >= 50) return `${Math.floor(n / 50) * 50}+`;
  return String(n);
}

// Filename-safe slug for per-game asset names: "Aston Villa" → "aston-villa".
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Thank-you / user-count (square / story) ──────────────────────────────
function renderThankYou(format, userCount) {
  const [w, h] = SIZE[format];
  const cx = w / 2;
  const story = format === 'story';
  const big = roundDownToMilestone(userCount);
  const bigCy = story ? h * 0.46 : h * 0.5;
  // Orbitron is wider than the old Bebas Neue display face, so fit the
  // milestone numeral to ~82% width — large milestones (e.g. "1,000") would
  // otherwise overflow at the headline size.
  const bigSize = fitOrbitron(big, w * 0.82, story ? 460 : 320);

  const body = `
  ${background(w, h)}
  ${topMark(cx, story ? 250 : 132, story ? 50 : 46)}
  <text x="${cx}" y="${story ? 470 : 300}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="${story ? 96 : 76}" fill="${COLOR.white}" letter-spacing="0.5">Thank you</text>
  <text x="${cx}" y="${bigCy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${bigSize}" letter-spacing="${(bigSize * 0.02).toFixed(1)}" fill="url(#mark)">${esc(big)}</text>
  <text x="${cx}" y="${bigCy + bigSize * 0.34 + (story ? 70 : 84)}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 48 : 42}" letter-spacing="1" fill="${COLOR.textHi}">players and counting</text>
  ${footer({ cx, y: h - (story ? 220 : 160), w: w * 0.64 })}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.42 } });
}

// Build an SVG <rect> grid from a qrcode module bitmap (dark modules only;
// the surrounding white card supplies the quiet zone + light background).
function qrToSvg(qr, px) {
  const n = qr.modules.size;
  const data = qr.modules.data;
  const s = px / n;
  let rects = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (data[r * n + c])
        rects += `<rect x="${(c * s).toFixed(2)}" y="${(r * s).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" fill="${COLOR.navy1}"/>`;
  return `<g>${rects}</g>`;
}

// ── Rasterize ────────────────────────────────────────────────────────────
// rasterize() + loadFonts() are shared with the matchday cron job
// (marketing/lib/render.mjs). FONT_FILES is populated once in main() and
// threaded into each emit() call.
let FONT_FILES = [];

async function emit(id, svgString, width) {
  const png = await rasterize(svgString, width, FONT_FILES);
  await writeFile(resolve(outDir, `${id}.png`), png);
  console.log(`wrote marketing/out/${id}.png (${width}px, ${(png.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  FONT_FILES = await loadFonts();
  console.log(`loaded ${FONT_FILES.length} font files`);

  await emit('launch-square', renderLaunch('square'), SIZE.square[0]);
  await emit('launch-story', renderLaunch('story'), SIZE.story[0]);
  await emit('launch-x', renderLaunch('landscape'), SIZE.landscape[0]);
  await emit('launch-card', renderLaunch('card'), SIZE.card[0]);
  await emit('profile-pic', renderProfilePic(), SIZE.square[0]);

  for (const feat of FEATURES) {
    await emit(`feature-${feat.key}-square`, renderFeature(feat, 'square'), SIZE.square[0]);
    await emit(`feature-${feat.key}-story`, renderFeature(feat, 'story'), SIZE.story[0]);
  }

  await emit('howto-square', renderHowto('square'), SIZE.square[0]);
  await emit('howto-story', renderHowto('story'), SIZE.story[0]);

  await emit('share-to-story-square', renderShareToStory('square'), SIZE.square[0]);
  await emit('share-to-story-story', renderShareToStory('story'), SIZE.story[0]);

  for (const stat of STATS) {
    await emit(`stat-${stat.key}-square`, renderStat(stat, 'square'), SIZE.square[0]);
    await emit(`stat-${stat.key}-story`, renderStat(stat, 'story'), SIZE.story[0]);
  }

  await emit('flyer-a4', await renderFlyer(), SIZE.flyer[0]);

  // Product mockups — real GameCard states + leaderboard
  await emit(
    'product-gamecard-upcoming',
    renderProductCard({
      state: 'upcoming',
      data: GAMES.upcoming,
      heading: 'Pick before kickoff',
      sub: 'The bigger the upset, the more points',
    }),
    SIZE.square[0],
  );
  await emit(
    'product-gamecard-live',
    renderProductCard({
      state: 'live',
      data: GAMES.live,
      heading: 'Follow it live',
      sub: 'Scores + your points, updating in real time',
    }),
    SIZE.square[0],
  );
  await emit(
    'product-gamecard-final',
    renderProductCard({
      state: 'final',
      data: GAMES.final,
      heading: 'Score the upset',
      sub: 'A 34% underdog away win earned +66 points',
    }),
    SIZE.square[0],
  );
  await emit('product-game-lifecycle', renderGameLifecycle(), SIZE.story[0]);
  await emit('product-leaderboard', renderLeaderboard('square'), SIZE.square[0]);
  await emit('product-leaderboard-story', renderLeaderboard('story'), SIZE.story[0]);
  await emit('product-stats', renderStats('square'), SIZE.square[0]);
  await emit('product-stats-story', renderStats('story'), SIZE.story[0]);
  await emit('product-stats-charts', renderStatsCharts('square'), SIZE.square[0]);
  await emit('product-stats-charts-story', renderStatsCharts('story'), SIZE.story[0]);

  // Feature announcement — win streaks (static, no live data).
  await emit('feature-streaks', renderStreaksFeature('square'), SIZE.square[0]);
  await emit('feature-streaks-story', renderStreaksFeature('story'), SIZE.story[0]);

  // ── Live-data assets ──
  // Pull real numbers from prod when DATABASE_URL is set; otherwise fall
  // back to the baked-in samples so the kit still renders offline. Any DB
  // failure degrades to the same fallback rather than aborting the run.
  const db = openDb();
  let userCount = SAMPLE_USER_COUNT;
  let upcoming = SAMPLE_UPCOMING;
  let liveGames = [];
  let finishedGames = [];
  let live = false;
  if (db) {
    try {
      userCount = await fetchUserCount(db);
      upcoming = await fetchUpcomingGames(db);
      liveGames = await fetchLiveGames(db);
      finishedGames = await fetchFinishedGames(db);
      live = true;
      console.log(
        `\nlive data: ${userCount} users, ${upcoming.length} upcoming game(s), ${liveGames.length} in-progress, ${finishedGames.length} finished`,
      );
    } catch (err) {
      console.warn(`\nlive-data fetch failed (${err.message}); using sample data`);
      userCount = SAMPLE_USER_COUNT;
      upcoming = SAMPLE_UPCOMING;
      liveGames = [];
      finishedGames = [];
    } finally {
      await db.close();
    }
  } else {
    console.log('\nDATABASE_URL not set — using sample data for live assets');
  }

  await emit('thankyou-square', renderThankYou('square', userCount), SIZE.square[0]);
  await emit('thankyou-story', renderThankYou('story', userCount), SIZE.story[0]);

  // "Get your picks in" countdown — features the soonest live fixture (which
  // carries a kickoffAt Date); offline that's the Mexico vs South Africa
  // sample. `.find` guards against the sample-upcoming fallback rows, which
  // have no kickoffAt.
  const countdownGame = upcoming.find((g) => g.kickoffAt instanceof Date) || SAMPLE_COUNTDOWN;
  await emit(
    'kickoff-countdown-square',
    renderKickoffCountdown(countdownGame, 'square'),
    SIZE.square[0],
  );
  await emit(
    'kickoff-countdown-story',
    renderKickoffCountdown(countdownGame, 'story'),
    SIZE.story[0],
  );

  // Halftime score — the most relevant in-progress game (prefers one at the
  // break); offline that's the Brazil 1-0 France sample.
  const halftimeGame = liveGames[0] || SAMPLE_HALFTIME;
  if (live && liveGames.length === 0) {
    console.log('no in-progress games — halftime card uses the sample');
  }
  await emit('halftime-square', renderHalftime(halftimeGame, 'square'), SIZE.square[0]);
  await emit('halftime-story', renderHalftime(halftimeGame, 'story'), SIZE.story[0]);

  // Full-time result + points — most recent decisive finished game (falls back
  // to the most recent overall, then the Brazil 2-1 France sample).
  const fulltimeGame =
    finishedGames.find((g) => g.result !== 'draw') || finishedGames[0] || SAMPLE_FULLTIME;
  if (live && finishedGames.length === 0) {
    console.log('no finished games — full-time card uses the sample');
  }
  await emit('fulltime-square', renderFulltime(fulltimeGame, 'square'), SIZE.square[0]);
  await emit('fulltime-story', renderFulltime(fulltimeGame, 'story'), SIZE.story[0]);

  // Top 3 players — reads the public leaderboard API directly (no DB creds
  // needed), so it's current on a plain `npm run assets:marketing`. Masked
  // (private) rows are skipped upstream; fall back to the sample when fewer
  // than 3 live rows are available.
  let topPlayers = await fetchTopPlayers({ limit: 3 });
  if (topPlayers.length < 3) {
    if (topPlayers.length > 0) {
      console.log(`top-players: only ${topPlayers.length} live row(s) — using sample`);
    } else {
      console.log('top-players: live leaderboard unavailable — using sample');
    }
    topPlayers = SAMPLE_TOP_PLAYERS;
  } else {
    console.log(`top-players: ${topPlayers.map((p) => p.username).join(', ')}`);
  }
  await emit('top-players-square', renderTopPlayers(topPlayers, 'square'), SIZE.square[0]);
  await emit('top-players-story', renderTopPlayers(topPlayers, 'story'), SIZE.story[0]);

  if (upcoming.length === 0) {
    console.log('no eligible upcoming games — skipping picks-vs-model assets');
  }
  for (const game of upcoming) {
    const slug = `${slugify(game.home)}-vs-${slugify(game.away)}`;
    await emit(`picks-vs-model-${slug}-square`, renderPicksVsModel(game, 'square'), SIZE.square[0]);
    await emit(`picks-vs-model-${slug}-story`, renderPicksVsModel(game, 'story'), SIZE.story[0]);
  }

  console.log(`\ndone — marketing kit in marketing/out/ (${live ? 'live' : 'sample'} data)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
