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

import { Resvg } from '@resvg/resvg-js';
import { writeFile, mkdir, readdir } from 'node:fs/promises';
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
  brandTag,
  rule,
  chip,
  chipWidth,
  ctaPill,
  textBlock,
  wrapLines,
  footer,
  iconBadge,
  svgDoc,
} from '../marketing/lib/brand.mjs';
import { gameCard, leaderboardCard } from '../marketing/lib/product.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = resolve(root, 'marketing/fonts');
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
    sub: 'A 38% underdog upset pays +62 points — favourites pay less. Bantryx rewards the brave call.',
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
  { key: 'free', icon: 'gift', big: '$0', label: 'free forever — no ads, no betting' },
];

const STEPS = [
  { n: '01', title: 'Sign up free', body: 'Under 30 seconds. No credit card, no ads, no betting.' },
  { n: '02', title: 'Pick your winners', body: 'Browse matches and lock picks right up to kickoff.' },
  { n: '03', title: 'Climb the rankings', body: 'Earn points by probability and rise up the live board.' },
];

// ── Hero kicker ──────────────────────────────────────────────────────────
function kicker(cx, y, size = 26, ls = size * 0.45) {
  return `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${size}" letter-spacing="${ls}" fill="${COLOR.cyan}">${esc(KICKER)}</text>`;
}

// ── Launch hero (square / story / landscape) ─────────────────────────────
function renderLaunch(format) {
  if (format === 'card') return renderLaunchCard();
  const [w, h] = SIZE[format];
  const cx = w / 2;

  const L = {
    square: { kickY: 320, wmTargetW: 940, wmY: 500, tagY: 580, bodyY: 700, bodySize: 46, ctaY: 866, ctaSize: 36, urlY: 1004 },
    story: { kickY: 540, wmTargetW: 940, wmY: 720, tagY: 804, bodyY: 928, bodySize: 50, ctaY: 1560, ctaSize: 40, urlY: 1756 },
    landscape: { kickY: 222, wmTargetW: 1180, wmY: 420, tagY: 494, bodySize: 38, bodyY: 584, ctaY: 712, ctaSize: 33, urlY: 856 },
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

// ── Feature highlight (square / story) ───────────────────────────────────
function renderFeature(feat, format) {
  const [w, h] = SIZE[format];
  const cx = w / 2;
  const story = format === 'story';
  const tagY = story ? 250 : 130;
  const iconCy = story ? h * 0.31 : h * 0.34;
  const badgeR = story ? 200 : 168;
  const iconSize = story ? 200 : 168;
  const headSize = story ? 92 : 78;
  const subSize = story ? 42 : 38;
  const headLines = wrapLines(feat.headline, 22);
  const subLines = wrapLines(feat.sub, story ? 38 : 42);
  const headY = iconCy + badgeR + (story ? 96 : 78);
  const subY = headY + headLines.length * headSize * 1.04 + (story ? 44 : 34);

  const body = `
  ${background(w, h)}
  ${brandTag({ x: 72, y: tagY, size: story ? 42 : 38 })}
  ${chip({ x: w - 72 - chipWidth(feat.label), y: tagY - (story ? 22 : 20), label: feat.label, accent: true })}
  ${iconBadge({ name: feat.icon, cx, cy: iconCy, badgeR, iconSize })}
  ${textBlock({ x: cx, y: headY, anchor: 'middle', size: headSize, font: FONT.display, fill: COLOR.white, lines: headLines, lineHeight: headSize * 1.02, letterSpacing: 1 })}
  ${textBlock({ x: cx, y: subY, anchor: 'middle', size: subSize, font: FONT.body, fill: COLOR.muted, lines: subLines, lineHeight: subSize * 1.4 })}
  ${footer({ cx, y: h - (story ? 210 : 150), w: w * 0.64 })}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.32 } });
}

// ── Stat teaser (square / story) ─────────────────────────────────────────
function renderStat(stat, format) {
  const [w, h] = SIZE[format];
  const cx = w / 2;
  const story = format === 'story';
  const bigCy = story ? h * 0.43 : h * 0.46;
  const bigSize = story ? 540 : 440;
  const labelLines = wrapLines(stat.label, story ? 24 : 26);
  const labelY = bigCy + bigSize * 0.34 + (story ? 64 : 44);

  const body = `
  ${background(w, h)}
  ${brandTag({ x: 72, y: story ? 250 : 120, size: story ? 42 : 38 })}
  ${iconBadge({ name: stat.icon, cx, cy: story ? h * 0.2 : h * 0.2, badgeR: story ? 110 : 92, iconSize: story ? 96 : 80, color: COLOR.cyan })}
  <text x="${cx}" y="${bigCy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.display}" font-size="${bigSize}" fill="url(#mark)">${esc(stat.big)}</text>
  ${textBlock({ x: cx, y: labelY, anchor: 'middle', size: story ? 50 : 44, font: FONT.bodySemi, fill: COLOR.textHi, lines: labelLines, lineHeight: (story ? 50 : 44) * 1.35 })}
  ${footer({ cx, y: h - (story ? 220 : 150), w: w * 0.64 })}`;
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
    const leftX = story ? 150 : 130;
    const textX = leftX + numSize * 1.5;
    const bodyLines = wrapLines(s.body, story ? 36 : 44);
    return `
    <text x="${leftX}" y="${y + numSize * 0.78}" font-family="${FONT.display}" font-size="${numSize}" fill="url(#mark)">${s.n}</text>
    <text x="${textX}" y="${y + numSize * 0.42}" font-family="${FONT.display}" font-size="${titleSize}" fill="${COLOR.white}" letter-spacing="1">${esc(s.title)}</text>
    ${textBlock({ x: textX, y: y + numSize * 0.42 + titleSize * 0.9, size: bodySize, font: FONT.body, fill: COLOR.muted, lines: bodyLines, lineHeight: bodySize * 1.35 })}
    ${i < STEPS.length - 1 ? rule({ x: leftX, y: y + rowH - (story ? 90 : 60), w: w - leftX * 2 }) : ''}`;
  }).join('\n');

  const body = `
  ${background(w, h)}
  ${brandTag({ x: 72, y: tagY, size: story ? 44 : 38 })}
  <text x="${cx}" y="${headY}" text-anchor="middle" font-family="${FONT.display}" font-size="${story ? 110 : 86}" fill="${COLOR.white}" letter-spacing="1">HOW IT WORKS</text>
  <text x="${cx}" y="${headY + (story ? 70 : 54)}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 38 : 32}" letter-spacing="2" fill="${COLOR.cyanSoft}">Three steps. No catch. No paywall.</text>
  ${rows}
  ${footer({ cx, y: h - (story ? 200 : 120), w: w * 0.64 })}`;
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
      ${iconBadge({ name: s.icon, cx: x + cardW / 2, cy: y + 92, badgeR: 60, iconSize: 56, color: COLOR.cyan, disc: false })}
      <text x="${x + cardW / 2}" y="${y + 240}" text-anchor="middle" font-family="${FONT.display}" font-size="150" fill="url(#mark)">${esc(s.big)}</text>
      ${textBlock({ x: x + cardW / 2, y: y + 300, anchor: 'middle', size: 36, font: FONT.bodyMed, fill: COLOR.muted, lines: wrapLines(s.label, 26), lineHeight: 48 })}`;
    })
    .join('\n');

  const stepRow = STEPS.map((s, i) => {
    const colW = w / 3;
    const x = colW * i + colW / 2;
    const y = 2090;
    return `
    <text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT.display}" font-size="130" fill="url(#mark)">${s.n}</text>
    <text x="${x}" y="${y + 92}" text-anchor="middle" font-family="${FONT.display}" font-size="58" fill="${COLOR.white}" letter-spacing="1">${esc(s.title)}</text>
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
  <text x="${cx}" y="${1930}" text-anchor="middle" font-family="${FONT.display}" font-size="84" fill="${COLOR.white}" letter-spacing="2">HOW IT WORKS</text>
  ${stepRow}
  <g transform="translate(${qrX} ${qrY})">
    <rect x="-40" y="-40" rx="40" width="${qrPx + 80}" height="${qrPx + 80}" fill="${COLOR.white}"/>
    ${qrSvg}
  </g>
  <text x="${cx}" y="${qrY + qrPx + 170}" text-anchor="middle" font-family="${FONT.display}" font-size="116" letter-spacing="3" fill="url(#mark)">PLAY FREE AT BANTRYX.COM</text>
  <text x="${cx}" y="${qrY + qrPx + 260}" text-anchor="middle" font-family="${FONT.bodyMed}" font-size="42" letter-spacing="2" fill="${COLOR.muted}">Scan the code  ·  Free forever  ·  No ads  ·  13+</text>`;
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
    payout: { home: 44, away: 66, drawH: 4, drawA: 6 },
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

// One fixture across all three states, for the lifecycle story.
const LIFECYCLE = {
  upcoming: { ...GAMES.upcoming, pickSide: 'away', pickTeam: 'Aston Villa' },
  live: {
    home: 'Arsenal',
    away: 'Aston Villa',
    dateLabel: 'Today',
    minute: "73'",
    homeScore: 0,
    awayScore: 1,
    pickSide: 'away',
    pickTeam: 'Aston Villa',
    points: 66,
  },
  final: GAMES.final,
};

// NOTE: no `streak` field — the live leaderboard doesn't display win streaks,
// so the mockup doesn't either (would misrepresent the product).
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
  ${brandTag({ x: 72, y: 116, size: 38 })}
  <text x="${cx}" y="${236}" text-anchor="middle" font-family="${FONT.display}" font-size="74" fill="${COLOR.white}" letter-spacing="1">${esc(heading)}</text>
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
  ${brandTag({ x: 72, y: 250, size: 42 })}
  <text x="${cx}" y="${364}" text-anchor="middle" font-family="${FONT.display}" font-size="96" fill="${COLOR.white}" letter-spacing="1">FROM PICK TO PAYOUT</text>
  <text x="${cx}" y="${418}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="30" letter-spacing="2" fill="${COLOR.cyanSoft}">Back the underdog. Watch it pay off.</text>
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
  const probe = leaderboardCard({ x: cardX, y: 0, w: cardW, title: 'Leaderboard', description: '', rows });
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

  const headSize = story ? 96 : 74;
  const body = `
  ${background(w, h)}
  ${brandTag({ x: 72, y: story ? 250 : 110, size: story ? 42 : 38 })}
  <text x="${cx}" y="${story ? 380 : 222}" text-anchor="middle" font-family="${FONT.display}" font-size="${headSize}" fill="${COLOR.white}" letter-spacing="1">CLIMB THE TABLE</text>
  <text x="${cx}" y="${story ? 436 : 274}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 30 : 28}" letter-spacing="1" fill="${COLOR.cyanSoft}">Outpick your group. Rise up the table.</text>
  ${card.svg}
  ${story ? footer({ cx, y: h - 150, w: w * 0.64 }) : `<text x="${cx}" y="${h - 56}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="30" letter-spacing="2" fill="${COLOR.muted}">${URL}</text>`}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.16, glowR: 0.7 } });
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
let FONT_FILES = [];

async function rasterize(svgString, width) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0,0,0,0)',
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: FONT.body },
  });
  return resvg.render().asPng();
}

async function emit(id, svgString, width) {
  const png = await rasterize(svgString, width);
  await writeFile(resolve(outDir, `${id}.png`), png);
  console.log(`wrote marketing/out/${id}.png (${width}px, ${(png.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  FONT_FILES = (await readdir(fontsDir)).filter((f) => f.endsWith('.ttf')).map((f) => resolve(fontsDir, f));
  console.log(`loaded ${FONT_FILES.length} font files`);

  await emit('launch-square', renderLaunch('square'), SIZE.square[0]);
  await emit('launch-story', renderLaunch('story'), SIZE.story[0]);
  await emit('launch-x', renderLaunch('landscape'), SIZE.landscape[0]);
  await emit('launch-card', renderLaunch('card'), SIZE.card[0]);

  for (const feat of FEATURES) {
    await emit(`feature-${feat.key}-square`, renderFeature(feat, 'square'), SIZE.square[0]);
    await emit(`feature-${feat.key}-story`, renderFeature(feat, 'story'), SIZE.story[0]);
  }

  await emit('howto-square', renderHowto('square'), SIZE.square[0]);
  await emit('howto-story', renderHowto('story'), SIZE.story[0]);

  for (const stat of STATS) {
    await emit(`stat-${stat.key}-square`, renderStat(stat, 'square'), SIZE.square[0]);
    await emit(`stat-${stat.key}-story`, renderStat(stat, 'story'), SIZE.story[0]);
  }

  await emit('flyer-a4', await renderFlyer(), SIZE.flyer[0]);

  // Product mockups — real GameCard states + leaderboard
  await emit('product-gamecard-upcoming', renderProductCard({ state: 'upcoming', data: GAMES.upcoming, heading: 'PICK BEFORE KICKOFF', sub: 'The bigger the upset, the bigger the payout' }), SIZE.square[0]);
  await emit('product-gamecard-live', renderProductCard({ state: 'live', data: GAMES.live, heading: 'FOLLOW IT LIVE', sub: 'Scores + your points, updating in real time' }), SIZE.square[0]);
  await emit('product-gamecard-final', renderProductCard({ state: 'final', data: GAMES.final, heading: 'CASH THE UPSET', sub: 'A 34% underdog away win paid +66' }), SIZE.square[0]);
  await emit('product-game-lifecycle', renderGameLifecycle(), SIZE.story[0]);
  await emit('product-leaderboard', renderLeaderboard('square'), SIZE.square[0]);
  await emit('product-leaderboard-story', renderLeaderboard('story'), SIZE.story[0]);

  console.log('\ndone — marketing kit in marketing/out/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
