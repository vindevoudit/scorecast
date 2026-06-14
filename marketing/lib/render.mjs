// Bantryx marketing kit — shared live-fixture renderers + rasterizer.
//
// The four matchday graphics (kickoff-countdown, halftime, fulltime,
// picks-vs-model) are PURE SVG renderers consumed by TWO callers:
//   1. the CLI (scripts/generate-marketing-assets.mjs) — manual `npm run
//      assets:marketing`, single sample/live fixture each.
//   2. the matchday cron job (lib/jobs/postMatchdayGraphics.js) — in the app
//      container, fires per fixture at the right moment and emails the PNGs.
//
// Keeping them here (not in the CLI, which runs main() on import and can't be
// imported) gives both callers one source of truth, so the emailed graphics
// are byte-identical to what the CLI produces. NO DB access + NO qrcode here —
// data is fetched by each caller and passed in; qrcode stays with the CLI flyer.
//
// Fonts (marketing/fonts/) are SIL OFL 1.1 — free to embed + redistribute.

import { Resvg } from '@resvg/resvg-js';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  COLOR,
  FONT,
  esc,
  background,
  wordmark,
  wordmarkWidth,
  ctaPill,
  footer,
  svgDoc,
} from './brand.mjs';
import { picksVsModelCard, avatar, flame, streakChip } from './product.mjs';

export const URL = 'bantryx.com';

// The matchday graphics ship in the two social formats only.
export const SIZES = {
  square: [1080, 1080],
  story: [1080, 1920],
};

const fontsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fonts');

// Resolve the bundled TTF font file paths for resvg. resvg loads no webfonts
// on its own, so the Orbitron "BANTRYX" wordmark + scoreboard numerals only
// render in the real brand face when these are passed via font.fontFiles.
export async function loadFonts() {
  const files = await readdir(fontsDir);
  return files.filter((f) => f.endsWith('.ttf')).map((f) => resolve(fontsDir, f));
}

// Rasterize an SVG string to a PNG Buffer at the given pixel width. fontFiles
// is the array from loadFonts() (passed in so this stays stateless + reusable
// across both callers).
export async function rasterize(svgString, width, fontFiles) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0,0,0,0)',
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT.body },
  });
  return resvg.render().asPng();
}

// ── Helpers ──────────────────────────────────────────────────────────────

// Centered top wordmark — small Orbitron BANTRYX at the top of a graphic.
export function topMark(cx, y, size = 46) {
  return wordmark({ x: cx, y, size, anchor: 'middle', fill: COLOR.cyanSoft });
}

// Humanize a kickoff time into a big scoreboard value + unit, e.g.
// { value: '3', unit: 'HOURS' } / { value: '45', unit: 'MINUTES' } /
// { value: '2', unit: 'DAYS' }. Rounds to the nearest unit; <=0 reads NOW.
export function countdownParts(kickoffAt, now = new Date()) {
  const diff = kickoffAt.getTime() - now.getTime();
  if (diff <= 0) return { value: 'NOW', unit: 'KICKING OFF' };
  const mins = Math.round(diff / 60000);
  if (mins < 60) return { value: String(mins), unit: mins === 1 ? 'MINUTE' : 'MINUTES' };
  const hours = Math.round(diff / 3600000);
  if (hours < 24) return { value: String(hours), unit: hours === 1 ? 'HOUR' : 'HOURS' };
  const days = Math.round(diff / 86400000);
  return { value: String(days), unit: days === 1 ? 'DAY' : 'DAYS' };
}

// Largest Orbitron size that fits `text` within `targetW`, clamped to maxSize.
// Reuses brand.mjs wordmarkWidth (Orbitron advance model) so the big countdown
// numeral and the matchup never overflow the canvas.
export function fitOrbitron(text, targetW, maxSize) {
  let size = maxSize;
  while (size > 12 && wordmarkWidth(size, text) > targetW) size -= 2;
  return size;
}

// ── Picks vs model for one upcoming game (square / story) ────────────────
export function renderPicksVsModel(game, format) {
  const [w, h] = SIZES[format];
  const cx = w / 2;
  const story = format === 'story';
  const cardW = 880;
  const cardX = (w - cardW) / 2;
  const probe = picksVsModelCard({ x: cardX, y: 0, w: cardW, game });
  const top = story ? 470 : 320;
  const bottom = story ? h - 170 : h - 110;
  const cardY = story ? top : Math.max(top, top + (bottom - top - probe.h) / 2);
  const card = picksVsModelCard({ x: cardX, y: cardY, w: cardW, game });

  const headSize = story ? 80 : 60;
  const body = `
  ${background(w, h)}
  ${topMark(cx, story ? 235 : 110, story ? 50 : 46)}
  <text x="${cx}" y="${story ? 376 : 220}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="${headSize}" fill="${COLOR.white}" letter-spacing="0.5">Fans vs the model</text>
  <text x="${cx}" y="${story ? 432 : 274}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 30 : 28}" letter-spacing="1" fill="${COLOR.cyanSoft}">Who the crowd backs and what the model says.</text>
  ${card.svg}
  ${story ? footer({ cx, y: h - 150, w: w * 0.64 }) : `<text x="${cx}" y="${h - 56}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="30" letter-spacing="2" fill="${COLOR.muted}">${URL}</text>`}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.16, glowR: 0.7 } });
}

// ── Kickoff countdown — "get your picks in" (square / story) ──────────────
// Urgency card for the next fixture: matchup + a big Orbitron countdown
// numeral ("KICKS OFF IN / 3 / HOURS") + a "Get your picks in" CTA. Orbitron
// carries the wordmark + the scoreboard countdown; the matchup uses the Inter
// Black body face (Orbitron is too wide for long national-team names). The
// countdown is computed live from game.kickoffAt at generation time.
export function renderKickoffCountdown(game, format) {
  const [w, h] = SIZES[format];
  const cx = w / 2;
  const story = format === 'story';

  const L = {
    square: { markY: 120, markSize: 46, leagueY: 236, matchupY: 348, matchupMax: 72, kickerY: 470, numMax: 248, unitY: 760, unitSize: 54, ctaY: 814, ctaSize: 34, urlY: 1026 },
    story: { markY: 250, markSize: 50, leagueY: 398, matchupY: 524, matchupMax: 104, kickerY: 706, numMax: 430, unitY: 1214, unitSize: 80, ctaY: 1334, ctaSize: 42, footerY: h - 210 },
  }[format];

  // Centre the big numeral's optical midpoint exactly between the "KICKS OFF
  // IN" baseline (above) and the cap-top of the unit word (below) so the
  // whitespace above and below the number is equal. The glyph's own height
  // cancels out of the midpoint, so this holds regardless of numSize.
  const numCy = (L.kickerY + (L.unitY - 0.72 * L.unitSize)) / 2;

  const matchup = `${game.home} vs ${game.away}`;
  // Inter Black advance (~0.6em) so long national-team names never overflow.
  const matchupSize = Math.min(L.matchupMax, Math.floor((w * 0.86) / (matchup.length * 0.6)));
  const { value, unit } = countdownParts(game.kickoffAt);
  const numSize = fitOrbitron(value, w * 0.78, L.numMax);
  const league = (game.leagueName || 'Matchday').toUpperCase();

  const closing = story
    ? footer({ cx, y: L.footerY, w: w * 0.64 })
    : `<text x="${cx}" y="${L.urlY}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="30" letter-spacing="2" fill="${COLOR.muted}">${URL}</text>`;

  const body = `
  ${background(w, h)}
  ${topMark(cx, L.markY, L.markSize)}
  <text x="${cx}" y="${L.leagueY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 32 : 26}" letter-spacing="${story ? 8 : 6}" fill="${COLOR.cyan}">${esc(league)}</text>
  <text x="${cx}" y="${L.matchupY}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="${matchupSize}" letter-spacing="0.5" fill="${COLOR.white}">${esc(matchup)}</text>
  <text x="${cx}" y="${L.kickerY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 36 : 30}" letter-spacing="${story ? 10 : 7}" fill="${COLOR.cyanSoft}">KICKS OFF IN</text>
  <text x="${cx}" y="${numCy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${numSize}" letter-spacing="${numSize * 0.04}" fill="url(#mark)">${esc(value)}</text>
  <text x="${cx}" y="${L.unitY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${L.unitSize}" letter-spacing="${story ? 14 : 10}" fill="${COLOR.cyanSoft}">${esc(unit)}</text>
  ${ctaPill({ cx, y: L.ctaY, label: 'Get your picks in', size: L.ctaSize })}
  ${closing}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.34, glowR: 0.65 } });
}

// ── Halftime score (square / story) ──────────────────────────────────────
// Live scoreboard card for a match at the break: matchup + a "HALF TIME"
// status + the big Orbitron score ("1 - 0") + a second-half tease. The score
// is drawn as three pieces (home digit / cyan dash / away digit) so each
// numeral stays large and the dash sits centred regardless of the digits.
export function renderHalftime(game, format) {
  const [w, h] = SIZES[format];
  const cx = w / 2;
  const story = format === 'story';

  const L = {
    square: { markY: 120, markSize: 46, leagueY: 236, matchupY: 350, matchupMax: 64, htY: 470, htSize: 30, scoreCy: 686, scoreSize: 210, taglineY: 864, taglineSize: 32, urlY: 1026 },
    story: { markY: 250, markSize: 50, leagueY: 398, matchupY: 524, matchupMax: 96, htY: 690, htSize: 36, scoreCy: 1004, scoreSize: 360, taglineY: 1320, taglineSize: 40, footerY: h - 210 },
  }[format];

  const matchup = `${game.home} vs ${game.away}`;
  const matchupSize = Math.min(L.matchupMax, Math.floor((w * 0.86) / (matchup.length * 0.6)));
  const league = (game.leagueName || 'Live').toUpperCase();
  const hs = String(game.homeScore);
  const as = String(game.awayScore);
  // Each digit sits ~0.42em off centre; the dash holds the middle.
  const off = L.scoreSize * 0.42;
  const dashSize = L.scoreSize * 0.5;

  const closing = story
    ? footer({ cx, y: L.footerY, w: w * 0.64 })
    : `<text x="${cx}" y="${L.urlY}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="30" letter-spacing="2" fill="${COLOR.muted}">${URL}</text>`;

  const body = `
  ${background(w, h)}
  ${topMark(cx, L.markY, L.markSize)}
  <text x="${cx}" y="${L.leagueY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 32 : 26}" letter-spacing="${story ? 8 : 6}" fill="${COLOR.cyan}">${esc(league)}</text>
  <text x="${cx}" y="${L.matchupY}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="${matchupSize}" letter-spacing="0.5" fill="${COLOR.white}">${esc(matchup)}</text>
  <text x="${cx}" y="${L.htY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${L.htSize}" letter-spacing="${story ? 12 : 8}" fill="#f87171">HALF TIME</text>
  <text x="${cx - off}" y="${L.scoreCy}" text-anchor="end" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${L.scoreSize}" fill="${COLOR.white}">${esc(hs)}</text>
  <text x="${cx}" y="${L.scoreCy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${dashSize}" fill="${COLOR.cyanSoft}">-</text>
  <text x="${cx + off}" y="${L.scoreCy}" text-anchor="start" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${L.scoreSize}" fill="${COLOR.white}">${esc(as)}</text>
  <text x="${cx}" y="${L.taglineY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${L.taglineSize}" letter-spacing="1" fill="${COLOR.cyanSoft}">Second half coming up</text>
  ${closing}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.34, glowR: 0.65 } });
}

// ── Full-time result + points (square / story) ───────────────────────────
// Closes the lifecycle: final score (winner bright, loser dimmed) + the
// points a correct pick earned, e.g. "BACKING BRAZIL · +62 PTS". The score
// and the points both use Orbitron; the points sit in the brand gradient to
// headline the probability-scoring USP. Draws have no single winner, so they
// show the result + a partial-credit note instead of a points figure.
export function renderFulltime(game, format) {
  const [w, h] = SIZES[format];
  const cx = w / 2;
  const story = format === 'story';
  const draw = game.result === 'draw';

  const L = {
    square: { markY: 120, markSize: 46, leagueY: 232, matchupY: 344, matchupMax: 60, ftY: 452, ftSize: 30, scoreCy: 588, scoreSize: 168, backY: 744, backSize: 28, ptsY: 836, ptsMax: 96, urlY: 1028 },
    story: { markY: 250, markSize: 50, leagueY: 392, matchupY: 512, matchupMax: 92, ftY: 648, ftSize: 36, scoreCy: 860, scoreSize: 300, backY: 1090, backSize: 34, ptsY: 1216, ptsMax: 150, footerY: h - 200 },
  }[format];

  const matchup = `${game.home} vs ${game.away}`;
  const matchupSize = Math.min(L.matchupMax, Math.floor((w * 0.86) / (matchup.length * 0.6)));
  const league = (game.leagueName || 'Result').toUpperCase();
  const hs = String(game.homeScore);
  const as = String(game.awayScore);
  const off = L.scoreSize * 0.42;
  const dashSize = L.scoreSize * 0.5;
  // Winner bright, loser dimmed (draw → both bright).
  const homeFill = draw || game.result === 'home' ? COLOR.white : COLOR.dim;
  const awayFill = draw || game.result === 'away' ? COLOR.white : COLOR.dim;

  // Points block: decisive → "BACKING <WINNER>" + big Orbitron "+N PTS";
  // draw → "DRAW" + a plain partial-credit note (no single figure).
  let pointsBlock;
  if (!draw && game.points != null) {
    const ptsText = `+${game.points} PTS`;
    const ptsSize = fitOrbitron(ptsText, w * 0.7, L.ptsMax);
    pointsBlock = `
  <text x="${cx}" y="${L.backY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${L.backSize}" letter-spacing="${story ? 6 : 4}" fill="${COLOR.cyanSoft}">BACKING ${esc(game.winner.toUpperCase())}</text>
  <text x="${cx}" y="${L.ptsY}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="${ptsSize}" letter-spacing="${ptsSize * 0.04}" fill="url(#mark)">${esc(ptsText)}</text>`;
  } else {
    pointsBlock = `
  <text x="${cx}" y="${L.backY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${L.backSize}" letter-spacing="${story ? 6 : 4}" fill="${COLOR.cyanSoft}">DRAW</text>
  <text x="${cx}" y="${L.ptsY - (story ? 40 : 30)}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 44 : 36}" letter-spacing="1" fill="${COLOR.textHi}">Both sides earn partial points</text>`;
  }

  const closing = story
    ? footer({ cx, y: L.footerY, w: w * 0.64 })
    : `<text x="${cx}" y="${L.urlY}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="30" letter-spacing="2" fill="${COLOR.muted}">${URL}</text>`;

  const body = `
  ${background(w, h)}
  ${topMark(cx, L.markY, L.markSize)}
  <text x="${cx}" y="${L.leagueY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 32 : 26}" letter-spacing="${story ? 8 : 6}" fill="${COLOR.cyan}">${esc(league)}</text>
  <text x="${cx}" y="${L.matchupY}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="${matchupSize}" letter-spacing="0.5" fill="${COLOR.white}">${esc(matchup)}</text>
  <text x="${cx}" y="${L.ftY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${L.ftSize}" letter-spacing="${story ? 12 : 8}" fill="${COLOR.cyanSoft}">FULL TIME</text>
  <text x="${cx - off}" y="${L.scoreCy}" text-anchor="end" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${L.scoreSize}" fill="${homeFill}">${esc(hs)}</text>
  <text x="${cx}" y="${L.scoreCy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${dashSize}" fill="${COLOR.cyanSoft}">-</text>
  <text x="${cx + off}" y="${L.scoreCy}" text-anchor="start" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${L.scoreSize}" fill="${awayFill}">${esc(as)}</text>
  ${pointsBlock}
  ${closing}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.34, glowR: 0.65 } });
}

// ── Top 3 players (square / story) ───────────────────────────────────────
// Podium of the current top three on the live leaderboard. Per the brief,
// EVERY string is Orbitron (FONT.brand) — headline, rank numerals, points,
// "PTS", the URL line — EXCEPT the username, which uses Inter (FONT.body) so
// real handles stay legible (Orbitron is too wide for long usernames). The
// avatar disc reuses the in-app deterministic colour hash; its single initial
// is Inter too (it's username-derived). `players` shape:
//   [{ username, displayName, points, streak }]  (streak optional / unused)
const RANK_THEME = {
  1: { bar: 'rgba(250,204,21,0.16)', stroke: 'rgba(250,204,21,0.55)', num: '#facc15', glow: true },
  2: { bar: 'rgba(148,163,184,0.14)', stroke: 'rgba(148,163,184,0.45)', num: '#cbd5e1' },
  3: { bar: 'rgba(217,119,6,0.16)', stroke: 'rgba(217,119,6,0.5)', num: '#f59e0b' },
};

// One leaderboard row: tinted shell + rank pill (Orbitron) + avatar + username
// (Inter) + points (Orbitron) with a small "PTS" Orbitron label.
function topPlayerRow({ x, y, w, h, rank, player, L }) {
  const theme = RANK_THEME[rank] || RANK_THEME[3];
  const cy = y + h / 2;
  const pillX = x + L.pad;
  const pillCx = pillX + L.pill / 2;
  const avX = pillX + L.pill + L.gapPillAv + L.avR;
  const nameX = avX + L.avR + L.gapAvName;
  const rightX = x + w - L.pad;
  const nameLeft = rightX - L.ptsReserve;
  const maxNameW = nameLeft - nameX;

  // Fit the username to the gutter between the avatar and the points block.
  const raw = player.displayName || player.username || 'Player';
  const display = raw.length > 18 ? `${raw.slice(0, 17)}…` : raw;
  let nameSize = L.nameSize;
  const est = display.length * nameSize * 0.56;
  if (est > maxNameW) nameSize = Math.max(L.nameMin, Math.floor(maxNameW / (display.length * 0.56)));

  const pts = Number(player.points || 0).toLocaleString();

  return `
  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h * 0.22).toFixed(1)}" fill="${theme.bar}" stroke="${theme.stroke}" stroke-width="${rank === 1 ? 3 : 2}"/>
  <rect x="${pillX.toFixed(1)}" y="${(cy - L.pill / 2).toFixed(1)}" width="${L.pill}" height="${L.pill}" rx="${(L.pill * 0.28).toFixed(1)}" fill="rgba(2,6,23,0.55)" stroke="${theme.stroke}" stroke-width="2"/>
  <text x="${pillCx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${L.rankSize}" fill="${theme.num}">${rank}</text>
  ${avatar(avX, cy, L.avR, player.username)}
  <text x="${nameX.toFixed(1)}" y="${(cy + nameSize * 0.34).toFixed(1)}" font-family="${FONT.body}" font-size="${nameSize}" fill="${COLOR.white}">${esc(display)}</text>
  <text x="${rightX.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="end" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${L.ptsSize}" letter-spacing="${(L.ptsSize * 0.02).toFixed(1)}" fill="url(#mark)">${esc(pts)}</text>`;
}

export function renderTopPlayers(players, format, { generatedAt = new Date() } = {}) {
  const [w, h] = SIZES[format];
  const cx = w / 2;
  const story = format === 'story';
  const top3 = (players || []).slice(0, 3);

  const L = story
    ? {
        cardW: 940, pad: 44, rowH: 268, gap: 44, startY: 720,
        pill: 116, rankSize: 64, avR: 54, gapPillAv: 40, gapAvName: 34,
        nameSize: 48, nameMin: 28, ptsReserve: 200, ptsSize: 68,
        headCy: 372, urlY: h - 120,
      }
    : {
        cardW: 880, pad: 36, rowH: 182, gap: 24, startY: 350,
        pill: 92, rankSize: 52, avR: 42, gapPillAv: 32, gapAvName: 26,
        nameSize: 40, nameMin: 26, ptsReserve: 180, ptsSize: 56,
        headCy: 214, urlY: h - 56,
      };
  const cardX = (w - L.cardW) / 2;

  const rows = top3
    .map((p, i) =>
      topPlayerRow({ x: cardX, y: L.startY + i * (L.rowH + L.gap), w: L.cardW, h: L.rowH, rank: i + 1, player: p, L }),
    )
    .join('\n');

  // Generation date — sits midway between the headline and the #1 card so the
  // graphic self-documents when its standings were captured. Orbitron, like
  // everything except the usernames.
  const dateLabel = (() => {
    try {
      return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        .format(generatedAt)
        .toUpperCase();
    } catch {
      return '';
    }
  })();
  const dateY = (L.headCy + L.startY) / 2;
  const dateSize = story ? 30 : 26;

  const headSize = fitOrbitron('TOP 3', w * 0.5, story ? 200 : 150);
  const urlColor = story ? COLOR.cyanSoft : COLOR.muted;
  const urlSize = story ? 34 : 30;

  const body = `
  ${background(w, h)}
  ${topMark(cx, story ? 235 : 110, story ? 50 : 46)}
  <text x="${cx}" y="${L.headCy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${headSize}" letter-spacing="${(headSize * 0.04).toFixed(1)}" fill="url(#mark)">TOP 3</text>
  <text x="${cx}" y="${dateY.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.brand}" font-weight="700" font-size="${dateSize}" letter-spacing="${story ? 6 : 5}" fill="${COLOR.cyanSoft}">${esc(dateLabel)}</text>
  ${rows}
  <text x="${cx}" y="${L.urlY}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="${urlSize}" letter-spacing="2" fill="${urlColor}">${URL}</text>`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.16, glowR: 0.7 } });
}

// ── Feature announcement: win streaks (square / story) ───────────────────
// "Win streaks are here" launch card. Hero is the kit's SVG flame (Lucide,
// orange) with a big Orbitron streak numeral, then a headline (Inter Black),
// one line of body copy (Inter), and the Streakmaster milestone chips
// (5 / 10 / 15 — mirrors badges/catalog.js streakmaster-1/2/3 + the in-app
// >=3 leaderboard gate). Brand chrome (BANTRYX, bantryx.com) stays Orbitron.
function milestoneChips(cx, y, k, gap) {
  const tiers = [
    { count: 5, label: 'I' },
    { count: 10, label: 'II' },
    { count: 15, label: 'III' },
  ];
  const chipW = 64 * k;
  const totalW = tiers.length * chipW + (tiers.length - 1) * gap;
  let x = cx - totalW / 2;
  return tiers
    .map(({ count, label }) => {
      const chip = streakChip(x, y, count, k);
      const lbl = `<text x="${(x + chipW / 2).toFixed(1)}" y="${(y + 34 * k + 22 * k).toFixed(1)}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${(15 * k).toFixed(1)}" letter-spacing="${(3 * k).toFixed(1)}" fill="${COLOR.muted}">${label}</text>`;
      x += chipW + gap;
      return chip + lbl;
    })
    .join('\n');
}

export function renderStreaksFeature(format) {
  const [w, h] = SIZES[format];
  const cx = w / 2;
  const story = format === 'story';

  const L = story
    ? {
        markY: 235, markSize: 50, kickY: 440, flameCy: 770, flameSize: 380,
        headY: 1090, headSize: 84, subY: 1190, subSize: 42, subLH: 60,
        capY: 1390, chipY: 1440, chipK: 2.1, chipGap: 56,
      }
    : {
        markY: 116, markSize: 46, kickY: 214, flameCy: 452, flameSize: 264,
        headY: 656, headSize: 62, subY: 736, subSize: 33, subLH: 46,
        capY: 850, chipY: 894, chipK: 1.7, chipGap: 44,
      };

  // Hero: a single bold centred flame — the universal "streak" symbol. The
  // flame+number pairing is carried by the milestone chips below, so the hero
  // stays iconic and uncluttered.
  const hero = flame(cx, L.flameCy, L.flameSize);

  const subLines = ['Win picks back-to-back to build a streak —', 'now shown right on the leaderboard.'];
  const sub = subLines
    .map(
      (line, i) =>
        `<text x="${cx}" y="${(L.subY + i * L.subLH).toFixed(1)}" text-anchor="middle" font-family="${FONT.body}" font-size="${L.subSize}" fill="${COLOR.textHi}">${esc(line)}</text>`,
    )
    .join('\n');

  const closing = story
    ? footer({ cx, y: h - 150, w: w * 0.64 })
    : `<text x="${cx}" y="${h - 56}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="30" letter-spacing="2" fill="${COLOR.muted}">${URL}</text>`;

  const body = `
  ${background(w, h)}
  ${topMark(cx, L.markY, L.markSize)}
  <text x="${cx}" y="${L.kickY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 30 : 26}" letter-spacing="${story ? 10 : 8}" fill="${COLOR.cyan}">NEW ON BANTRYX</text>
  ${hero}
  <text x="${cx}" y="${L.headY}" text-anchor="middle" font-family="${FONT.bodyBlack}" font-size="${L.headSize}" letter-spacing="0.5" fill="${COLOR.white}">Win streaks are here</text>
  ${sub}
  <text x="${cx}" y="${L.capY}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="${story ? 26 : 22}" letter-spacing="${story ? 5 : 4}" fill="${COLOR.cyanSoft}">STREAKMASTER MILESTONES</text>
  ${milestoneChips(cx, L.chipY, L.chipK, L.chipGap)}
  ${closing}`;
  return svgDoc({ w, h, body, glow: { glowCx: 0.5, glowCy: 0.3, glowR: 0.7 } });
}
