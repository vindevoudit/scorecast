// Bantryx marketing kit — product UI mockups.
//
// Faithful SVG re-creations of the real app components (GameCard +
// LeaderboardCard) for "this is what it actually looks like" marketing.
// Colours are the app's live dark-theme tokens (src/index.css :root); the
// avatar hash mirrors src/components/Avatar.jsx exactly so fake users get
// the same deterministic colours they'd get in-app. Fonts reuse the bundled
// brand TTFs: Orbitron = the `.font-led` scoreboard digits, Bebas Neue =
// `.font-display` rank pills, Inter = body.

import { FONT, esc } from './brand.mjs';

// ── App dark-theme tokens (src/index.css :root) ──────────────────────────
export const UI = {
  base: '#020617',
  elevated: '#0b1321',
  overlay: '#0f172a',
  fg: '#f8fafc',
  fgMuted: '#94a3b8',
  fgSubtle: '#64748b',
  border: '#1e293b',
  borderStrong: '#334155',
  accent: '#22d3ee',
  accentSoft: '#67e8f9',
  success: '#4ade80',
  warning: '#facc15',
  danger: '#f87171',
  streak: '#fb923c', // orange-400, used for the 🔥 streak indicator
};

// ── helpers ──────────────────────────────────────────────────────────────
function rrect(x, y, w, h, r, attrs = '') {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${r.toFixed(1)}" ${attrs}/>`;
}
function txt(x, y, s, { size, font = FONT.body, fill = UI.fg, anchor = 'start', ls = 0, weight }) {
  const wt = weight ? ` font-weight="${weight}"` : '';
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}"${wt} font-family="${font}" font-size="${size}" letter-spacing="${ls}" fill="${fill}">${esc(s)}</text>`;
}

// FNV-1a hash → HSL, mirroring src/components/Avatar.jsx colorsFor().
function avatarColors(name) {
  let hash = 2166136261;
  const s = (name || '?').toLowerCase();
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  const hue = hash % 360;
  return { bg: hslToHex(hue, 55, 35), border: hslToHex(hue, 55, 50) };
}
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export function avatar(cx, cy, r, name) {
  const { bg, border } = avatarColors(name);
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${bg}" stroke="${border}" stroke-width="1.5"/>
  ${txt(cx, cy + r * 0.34, letter, { size: r * 0.95, font: FONT.bodySemi, fill: '#ffffff', anchor: 'middle' })}`;
}

// Solid flame (Lucide "flame" outline, filled) for streak indicators.
export function flame(cx, cy, size, color = UI.streak) {
  const s = size / 24;
  return `<g transform="translate(${cx - 12 * s} ${cy - 12 * s}) scale(${s})"><path fill="${color}" d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-1.464-.224-3.123.5-4 .564.123 2.5 1 2.5 4 0 .5 1 1.5 2 2.5 1 1 2 2.5 2 4a4.5 4.5 0 1 1-9 0c0-1 .5-2 1.5-3"/></g>`;
}

// Streak chip: flame + count on a soft orange pill.
// NOTE: the LIVE leaderboard does NOT surface win streaks today, so this is
// intentionally NOT rendered in leaderboardCard() — showing it would
// misrepresent the product. Helper kept for if/when streaks ship in-app.
export function streakChip(x, cy, count, k = 1) {
  const h = 30 * k;
  const fSize = 22 * k;
  const w = 64 * k;
  return `
  ${rrect(x, cy - h / 2, w, h, h / 2, `fill="rgba(251,146,60,0.12)" stroke="${UI.streak}" stroke-opacity="0.4" stroke-width="1"`)}
  ${flame(x + 18 * k, cy, 24 * k)}
  ${txt(x + 32 * k, cy + fSize * 0.34, String(count), { size: fSize, font: FONT.bodySemi, fill: UI.streak })}`;
}

// ── GameCard mockup ──────────────────────────────────────────────────────
// data = { home, away, dateLabel, kickoff, homeScore, awayScore, minute,
//          pts:{home,away,drawH,drawA}, pickSide, pickTeam, result,
//          points }
// state ∈ 'upcoming' | 'live' | 'final'. Returns { svg, h }.
export function gameCard({ x, y, w, state, data }) {
  const k = w / 880;
  const pad = 40 * k;
  const r = 34 * k;
  const cx = x + w / 2;
  const live = state === 'live';
  const final = state === 'final';
  let cy = y + pad;
  const parts = [];

  // ── header row ──
  if (live) {
    const pillW = (data.minute ? 200 : 110) * k;
    parts.push(
      rrect(x + pad, cy, pillW, 40 * k, 20 * k, `fill="rgba(248,113,113,0.15)"`),
      `<circle cx="${x + pad + 22 * k}" cy="${cy + 20 * k}" r="${5 * k}" fill="${UI.danger}"/>`,
      txt(x + pad + 38 * k, cy + 27 * k, `Live${data.minute ? ` · ${data.minute}` : ''}`, {
        size: 20 * k,
        font: FONT.bodySemi,
        fill: UI.danger,
        ls: 2 * k,
      }),
    );
  } else {
    parts.push(
      txt(x + pad, cy + 26 * k, `${data.dateLabel} · ${final ? 'Final' : 'Upcoming'}`.toUpperCase(), {
        size: 18 * k,
        font: FONT.bodySemi,
        fill: 'rgba(34,211,238,0.8)',
        ls: 4 * k,
      }),
    );
  }
  // right-side pill / outcome badge (uppercase, matching the live Badge)
  if (final) {
    const won = data.result === data.pickSide;
    const draw = data.result === 'draw';
    // No ✓/✗ glyphs — Inter has no checkmark/cross glyph, so resvg renders
    // them as tofu (a stray bar). The success/danger colour carries the
    // correct/missed meaning instead.
    const badgeTxt = draw
      ? `DREW +${data.points} PTS`
      : won
        ? `CORRECT +${data.points} PTS`
        : 'MISSED';
    const tone = draw ? UI.warning : won ? UI.success : UI.danger;
    const bw = badgeTxt.length * 11.5 * k + 28 * k;
    parts.push(
      rrect(x + w - pad - bw, cy - 10 * k, bw, 36 * k, 18 * k, `fill="rgba(0,0,0,0.001)" stroke="${tone}" stroke-opacity="0.5" stroke-width="1.5"`),
      txt(x + w - pad - bw / 2, cy + 13 * k, badgeTxt, { size: 18 * k, font: FONT.bodySemi, fill: tone, anchor: 'middle' }),
    );
  } else {
    const pill = live
      ? `Your pick: ${data.pickTeam}`
      : data.pickTeam
        ? `Your pick: ${data.pickTeam}`
        : 'Picks lock in 1d 4h';
    const pw = pill.length * 9.5 * k + 28 * k;
    parts.push(
      rrect(x + w - pad - pw, cy + 2 * k, pw, 36 * k, 18 * k, `fill="rgba(15,23,42,0.7)"`),
      txt(x + w - pad - pw / 2, cy + 25 * k, pill, { size: 17 * k, font: FONT.body, fill: UI.fgMuted, anchor: 'middle' }),
    );
  }
  cy += 40 * k + 34 * k;

  // ── body: teams + score/kickoff ──
  const showScore = live || final;
  const winSide = final && (data.result === 'home' || data.result === 'away') ? data.result : null;
  const leadSide = live && data.homeScore !== data.awayScore ? (data.homeScore > data.awayScore ? 'home' : 'away') : null;
  const teamFont = 32 * k;
  // home (left)
  const homeDim = winSide && winSide !== 'home' ? ' opacity="0.55"' : '';
  const awayDim = winSide && winSide !== 'away' ? ' opacity="0.55"' : '';
  // Box vertically centred on its text: name cap-top ≈ cy−23k, WINNER baseline
  // cy+28k → top cy−37k + height 79k gives ~14k equal padding top & bottom.
  if (winSide === 'home') parts.push(rrect(x + pad - 12 * k, cy - 37 * k, 300 * k, 79 * k, 18 * k, `fill="rgba(74,222,128,0.06)" stroke="${UI.success}" stroke-opacity="0.4" stroke-width="1"`));
  if (winSide === 'away') parts.push(rrect(x + w - pad - 300 * k + 12 * k, cy - 37 * k, 300 * k, 79 * k, 18 * k, `fill="rgba(74,222,128,0.06)" stroke="${UI.success}" stroke-opacity="0.4" stroke-width="1"`));
  parts.push(`<g${homeDim}>${txt(x + pad, cy, data.home, { size: teamFont, font: FONT.bodySemi, fill: UI.fg })}${winSide === 'home' ? txt(x + pad, cy + 28 * k, 'WINNER', { size: 15 * k, font: FONT.bodySemi, fill: UI.success, ls: 1.5 * k }) : ''}</g>`);
  parts.push(`<g${awayDim}>${txt(x + w - pad, cy, data.away, { size: teamFont, font: FONT.bodySemi, fill: UI.fg, anchor: 'end' })}${winSide === 'away' ? txt(x + w - pad, cy + 28 * k, 'WINNER', { size: 15 * k, font: FONT.bodySemi, fill: UI.success, ls: 1.5 * k, anchor: 'end' }) : ''}</g>`);

  // middle
  if (showScore) {
    const tileW = 64 * k;
    const tileH = 72 * k;
    const gap = 22 * k;
    const ty = cy - 50 * k;
    const hx = cx - gap / 2 - tileW;
    const ax = cx + gap / 2;
    const homeHi = leadSide === 'home';
    const awayHi = leadSide === 'away';
    const tileAttr = `fill="rgba(15,23,42,0.6)" stroke="${UI.accent}" stroke-opacity="0.22" stroke-width="1"`;
    parts.push(
      rrect(hx, ty, tileW, tileH, 10 * k, tileAttr),
      txt(hx + tileW / 2, ty + tileH / 2 + 16 * k, String(data.homeScore), { size: 44 * k, font: FONT.brand, weight: 700, fill: homeHi ? UI.accent : UI.fg, anchor: 'middle' }),
      txt(cx, cy - 6 * k, '-', { size: 34 * k, fill: UI.fgSubtle, anchor: 'middle' }),
      rrect(ax, ty, tileW, tileH, 10 * k, tileAttr),
      txt(ax + tileW / 2, ty + tileH / 2 + 16 * k, String(data.awayScore), { size: 44 * k, font: FONT.brand, weight: 700, fill: awayHi ? UI.accent : UI.fg, anchor: 'middle' }),
    );
  } else {
    parts.push(
      txt(cx, cy - 6 * k, data.kickoff, { size: 30 * k, font: FONT.brand, weight: 700, fill: UI.fg, anchor: 'middle' }),
      txt(cx, cy + 20 * k, 'KICKOFF', { size: 13 * k, font: FONT.bodySemi, fill: UI.fgSubtle, anchor: 'middle', ls: 4 * k }),
    );
  }
  cy += 40 * k;

  // ── state-specific footer ──
  if (state === 'upcoming') {
    // points-allocation grid
    cy += 24 * k;
    const gridY = cy;
    const gridH = 92 * k;
    const colGap = 2 * k;
    const colW = (w - pad * 2 - colGap * 2) / 3;
    parts.push(rrect(x + pad, gridY, w - pad * 2, gridH, 16 * k, `fill="${UI.border}"`));
    const cells = [
      { v: `+${data.pts.home}`, lab: false },
      { v: 'WIN', lab: true },
      { v: `+${data.pts.away}`, lab: false },
    ];
    const row2 = [
      { v: `+${data.pts.drawH}`, lab: false },
      { v: 'DRAW', lab: true },
      { v: `+${data.pts.drawA}`, lab: false },
    ];
    const drawCells = (arr, ry, rh) => {
      arr.forEach((c, i) => {
        const cxx = x + pad + i * (colW + colGap);
        parts.push(rrect(cxx, ry, colW, rh, 0, `fill="rgba(15,23,42,0.7)"`));
        parts.push(
          txt(cxx + colW / 2, ry + rh / 2 + (c.lab ? 5 * k : 11 * k), c.v, {
            size: c.lab ? 14 * k : 30 * k,
            font: c.lab ? FONT.bodySemi : FONT.brand,
            weight: c.lab ? undefined : 700,
            fill: c.lab ? UI.fgMuted : UI.fg,
            anchor: 'middle',
            ls: c.lab ? 3 * k : 0,
          }),
        );
      });
    };
    drawCells(cells, gridY + 1 * k, gridH / 2 - 1.5 * k);
    drawCells(row2, gridY + gridH / 2 + 0.5 * k, gridH / 2 - 1.5 * k);
    parts.push(txt(cx, gridY + gridH + 30 * k, 'Points allocation locks in at kickoff.', { size: 15 * k, font: FONT.body, fill: UI.fgMuted, anchor: 'middle' }));
    cy = gridY + gridH + 48 * k;

    // pick buttons
    const btnH = 60 * k;
    const btnGap = 22 * k;
    const btnW = (w - pad * 2 - btnGap) / 2;
    const homeActive = data.pickSide === 'home';
    const awayActive = data.pickSide === 'away';
    const btn = (bx, label, active) =>
      rrect(bx, cy, btnW, btnH, 22 * k, active ? `fill="rgba(34,211,238,0.3)" stroke="${UI.accentSoft}" stroke-width="1.5"` : `fill="rgba(34,211,238,0.1)" stroke="rgba(34,211,238,0.2)" stroke-width="1.5"`) +
      txt(bx + btnW / 2, cy + btnH / 2 + 8 * k, label, { size: 22 * k, font: FONT.bodySemi, fill: active ? UI.fg : UI.accentSoft, anchor: 'middle' });
    parts.push(btn(x + pad, `Pick ${data.home}`, homeActive));
    parts.push(btn(x + pad + btnW + btnGap, `Pick ${data.away}`, awayActive));
    cy += btnH + pad;
  } else {
    // locked-pick chip (live / final)
    cy += 18 * k;
    parts.push(`<line x1="${x + pad}" y1="${cy}" x2="${x + w - pad}" y2="${cy}" stroke="${UI.border}" stroke-width="1"/>`);
    cy += 32 * k;
    const suffix = final
      ? data.result === 'draw'
        ? `drew · +${data.points} pts`
        : data.result === data.pickSide
          ? `won · +${data.points} pts`
          : 'lost'
      : `locked · ${data.points} pts on the line`;
    const label = `Your pick: ${data.pickTeam} · ${suffix}`;
    parts.push(txt(cx, cy, label.toUpperCase(), { size: 16 * k, font: FONT.bodySemi, fill: UI.fgMuted, anchor: 'middle', ls: 2 * k }));
    cy += pad;
  }

  const h = cy - y;
  const shellBorder = live ? `stroke="${UI.danger}" stroke-opacity="0.35"` : `stroke="${UI.border}"`;
  const shell = rrect(x, y, w, h, r, `fill="${UI.elevated}" ${shellBorder} stroke-width="1.5"`);
  return { svg: shell + parts.join('\n'), h };
}

// ── LeaderboardCard mockup ───────────────────────────────────────────────
// rows = [{ name, points, streak?, you? }]. Returns { svg, h }.
export function leaderboardCard({ x, y, w, title, description, rows }) {
  const k = w / 880;
  const pad = 44 * k;
  const r = 34 * k;
  const parts = [];
  let cy = y + pad;

  parts.push(txt(x + pad, cy + 34 * k, title, { size: 40 * k, font: FONT.bodySemi, fill: UI.fg }));
  cy += 34 * k + 18 * k;
  parts.push(txt(x + pad, cy + 20 * k, description, { size: 19 * k, font: FONT.body, fill: UI.fgMuted }));
  cy += 20 * k + 30 * k;

  const rowH = 76 * k;
  const rowGap = 14 * k;
  rows.forEach((row, i) => {
    const rank = i + 1;
    const ry = cy;
    const you = row.you;
    parts.push(
      rrect(x + pad, ry, w - pad * 2, rowH, 24 * k, you ? `fill="rgba(34,211,238,0.1)" stroke="${UI.accent}" stroke-opacity="0.4" stroke-width="1.5"` : `fill="rgba(15,23,42,0.7)"`),
    );
    // rank pill
    const pillSize = 46 * k;
    const px = x + pad + 18 * k;
    const py = ry + rowH / 2 - pillSize / 2;
    const pillFill =
      rank === 1 ? 'rgba(250,204,21,0.4)' : rank === 2 ? 'rgba(100,116,139,0.35)' : rank === 3 ? 'rgba(250,204,21,0.2)' : 'rgba(15,23,42,0.9)';
    const pillTxt = rank <= 3 ? UI.fg : UI.fgMuted;
    parts.push(
      rrect(px, py, pillSize, pillSize, 13 * k, `fill="${pillFill}"`),
      txt(px + pillSize / 2, py + pillSize / 2 + 13 * k, String(rank), { size: 32 * k, font: FONT.display, fill: pillTxt, anchor: 'middle' }),
    );
    // avatar
    const avR = 22 * k;
    const avCx = px + pillSize + 16 * k + avR;
    parts.push(avatar(avCx, ry + rowH / 2, avR, row.name));
    // name (+ you tag)
    let nameX = avCx + avR + 18 * k;
    parts.push(txt(nameX, ry + rowH / 2 + 8 * k, row.name, { size: 24 * k, font: you ? FONT.bodySemi : FONT.body, fill: UI.fg }));
    nameX += row.name.length * 13 * k + 16 * k;
    if (you) {
      parts.push(txt(nameX, ry + rowH / 2 + 7 * k, 'YOU', { size: 15 * k, font: FONT.bodySemi, fill: UI.accent, ls: 2 * k }));
    }
    // NOTE: win streaks are not shown — the live leaderboard doesn't display
    // them, so we don't either (see streakChip note above).
    // points (right)
    parts.push(
      txt(x + w - pad - 70 * k, ry + rowH / 2 + 9 * k, row.points.toLocaleString(), { size: 26 * k, font: FONT.brand, weight: 700, fill: UI.fg, anchor: 'end' }),
      txt(x + w - pad - 18 * k, ry + rowH / 2 + 8 * k, 'PTS', { size: 14 * k, font: FONT.bodySemi, fill: UI.fgSubtle, anchor: 'end', ls: 1 * k }),
    );
    cy += rowH + rowGap;
  });
  cy += pad - rowGap;

  const h = cy - y;
  const shell = rrect(x, y, w, h, r, `fill="${UI.elevated}" stroke="${UI.border}" stroke-width="1.5"`);
  return { svg: shell + parts.join('\n'), h };
}

// ── Stats dashboard (charts) mockup ──────────────────────────────────────
// Recreates the recharts panels from StatsDashboard.jsx: dual-line "Points
// over time" (cyan daily + purple running total), stacked "Per-league" bars
// (green/amber/red), and the cyan "Pick-time heatmap". `full` adds the bars +
// heatmap (story); otherwise just the hero line chart (square).
const CHART = { line1: '#22d3ee', line2: '#a855f7', win: '#22c55e', draw: '#fbbf24', loss: '#ef4444' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function statsCharts({ x, y, w, data, full = false }) {
  const k = w / 880;
  const pad = 40 * k;
  const r = 34 * k;
  const parts = [];
  let cy = y + pad;
  const innerW = w - pad * 2;

  // ── header + window toggle ──
  parts.push(
    txt(x + pad, cy + 30 * k, 'Your stats', { size: 38 * k, font: FONT.bodySemi, fill: UI.fg }),
    txt(x + pad, cy + 60 * k, 'Trends, leagues, and what to watch for.', { size: 18 * k, font: FONT.body, fill: UI.fgMuted }),
  );
  const windows = ['30 days', '90 days', 'Season'];
  let wx = x + w - pad;
  for (let i = windows.length - 1; i >= 0; i--) {
    const active = i === 0;
    const tw = windows[i].length * 10 * k + 28 * k;
    wx -= tw + (i < windows.length - 1 ? 8 * k : 0);
    parts.push(
      rrect(wx, cy + 6 * k, tw, 44 * k, 14 * k, active ? `fill="${UI.accent}"` : `fill="rgba(0,0,0,0.001)"`),
      txt(wx + tw / 2, cy + 34 * k, windows[i], { size: 18 * k, font: FONT.bodySemi, fill: active ? UI.base : UI.fgMuted, anchor: 'middle' }),
    );
  }
  cy += 92 * k;

  // ── 4 summary tiles ──
  const tGap = 12 * k;
  const tW = (innerW - tGap * 3) / 4;
  const tH = 104 * k;
  data.summary.forEach((s, i) => {
    const tx = x + pad + i * (tW + tGap);
    parts.push(
      rrect(tx, cy, tW, tH, 18 * k, `fill="rgba(15,23,42,0.7)"`),
      txt(tx + 20 * k, cy + 34 * k, s.label.toUpperCase(), { size: 13 * k, font: FONT.bodySemi, fill: UI.fgMuted, ls: 2 * k }),
      txt(tx + 20 * k, cy + 78 * k, s.value, { size: 38 * k, font: FONT.brand, weight: 700, fill: s.accent ? UI.accent : UI.fg }),
    );
  });
  cy += tH + 22 * k;

  // ── helper: bordered chart panel ──
  const panel = (title, subtitle, ph, inner) => {
    const py = cy;
    parts.push(
      rrect(x + pad, py, innerW, ph, 24 * k, `fill="rgba(11,19,33,0.6)" stroke="${UI.border}" stroke-width="1.5"`),
      txt(x + pad + 26 * k, py + 36 * k, title.toUpperCase(), { size: 15 * k, font: FONT.bodySemi, fill: UI.fgMuted, ls: 3 * k }),
      txt(x + pad + 26 * k, py + 62 * k, subtitle, { size: 16 * k, font: FONT.body, fill: UI.fgSubtle }),
    );
    parts.push(inner(x + pad, py, innerW, ph));
    cy += ph + 20 * k;
  };

  // ── Points over time (dual line) ──
  panel('Points over time', 'Daily + running total', 300 * k, (px, py, pw, ph) => {
    const plotX = px + 70 * k;
    const plotY = py + 92 * k;
    const plotW = pw - 96 * k;
    const plotH = ph - 132 * k;
    const yMax = Math.max(...data.pointsOverTime.cumulative) * 1.1;
    let g = '';
    // grid + y labels
    for (let i = 0; i <= 4; i++) {
      const gy = plotY + (plotH * i) / 4;
      const val = Math.round((yMax * (4 - i)) / 4);
      g += `<line x1="${plotX}" y1="${gy}" x2="${plotX + plotW}" y2="${gy}" stroke="rgb(148,163,184)" stroke-opacity="0.18" stroke-dasharray="3 3" stroke-width="1"/>`;
      g += txt(plotX - 12 * k, gy + 5 * k, String(val), { size: 12 * k, font: FONT.body, fill: UI.fgSubtle, anchor: 'end' });
    }
    // x labels
    data.pointsOverTime.xLabels.forEach((lab, i, arr) => {
      const lx = plotX + (plotW * i) / (arr.length - 1);
      g += txt(lx, plotY + plotH + 26 * k, lab, { size: 12 * k, font: FONT.body, fill: UI.fgSubtle, anchor: 'middle' });
    });
    const poly = (vals, color) => {
      const n = vals.length;
      const pts = vals.map((v, i) => `${(plotX + (plotW * i) / (n - 1)).toFixed(1)},${(plotY + plotH - (v / yMax) * plotH).toFixed(1)}`).join(' ');
      return `<polyline fill="none" stroke="${color}" stroke-width="${3 * k}" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`;
    };
    g += poly(data.pointsOverTime.cumulative, CHART.line2);
    g += poly(data.pointsOverTime.daily, CHART.line1);
    // legend
    g += legend(plotX + plotW - 280 * k, py + 40 * k, k, [
      { color: CHART.line1, name: 'Daily points' },
      { color: CHART.line2, name: 'Running total' },
    ]);
    return g;
  });

  if (full) {
    // ── Per-league stacked bars ──
    panel('Per-league breakdown', 'Wins / draws / losses', 300 * k, (px, py, pw, ph) => {
      const plotX = px + 60 * k;
      const plotY = py + 92 * k;
      const plotW = pw - 86 * k;
      const plotH = ph - 132 * k;
      const totals = data.perLeague.map((l) => l.wins + l.draws + l.losses);
      const yMax = Math.max(...totals) * 1.15;
      let g = '';
      for (let i = 0; i <= 4; i++) {
        const gy = plotY + (plotH * i) / 4;
        g += `<line x1="${plotX}" y1="${gy}" x2="${plotX + plotW}" y2="${gy}" stroke="rgb(148,163,184)" stroke-opacity="0.18" stroke-dasharray="3 3" stroke-width="1"/>`;
        g += txt(plotX - 12 * k, gy + 5 * k, String(Math.round((yMax * (4 - i)) / 4)), { size: 12 * k, font: FONT.body, fill: UI.fgSubtle, anchor: 'end' });
      }
      const slot = plotW / data.perLeague.length;
      const bw = slot * 0.5;
      data.perLeague.forEach((l, i) => {
        const bx = plotX + slot * i + (slot - bw) / 2;
        let stackTop = plotY + plotH;
        [['wins', CHART.win], ['draws', CHART.draw], ['losses', CHART.loss]].forEach(([key, color]) => {
          const segH = (l[key] / yMax) * plotH;
          stackTop -= segH;
          g += rrect(bx, stackTop, bw, segH, 0, `fill="${color}"`);
        });
        g += txt(bx + bw / 2, plotY + plotH + 26 * k, l.name, { size: 13 * k, font: FONT.body, fill: UI.fgMuted, anchor: 'middle' });
      });
      g += legend(plotX + plotW - 300 * k, py + 40 * k, k, [
        { color: CHART.win, name: 'Wins' },
        { color: CHART.draw, name: 'Draws' },
        { color: CHART.loss, name: 'Losses' },
      ]);
      return g;
    });

    // ── Pick-time heatmap ──
    panel('Pick-time heatmap', 'Day-of-week × hour', 280 * k, (px, py, pw) => {
      const gridX = px + 80 * k;
      const gridY = py + 96 * k;
      const cols = 24;
      const cellW = (pw - 100 * k) / cols;
      const cellH = 20 * k;
      const gap = 3 * k;
      let g = '';
      for (let h = 0; h < cols; h += 3) {
        g += txt(gridX + h * (cellW) + cellW / 2, gridY - 10 * k, String(h), { size: 11 * k, font: FONT.body, fill: UI.fgSubtle, anchor: 'middle' });
      }
      data.heatmap.forEach((row, d) => {
        const ry = gridY + d * (cellH + gap);
        g += txt(gridX - 14 * k, ry + cellH * 0.72, DOW[d], { size: 12 * k, font: FONT.bodySemi, fill: UI.fgMuted, anchor: 'end' });
        row.forEach((cell, h) => {
          const intensity = cell / 5;
          const fill = cell === 0 ? 'rgba(30,41,59,0.55)' : `rgba(34,211,238,${(0.18 + intensity * 0.7).toFixed(2)})`;
          g += rrect(gridX + h * cellW, ry, cellW - gap, cellH, 3 * k, `fill="${fill}"`);
        });
      });
      return g;
    });
  }

  cy += pad - 20 * k;
  const h = cy - y;
  const shell = rrect(x, y, w, h, r, `fill="${UI.elevated}" stroke="${UI.border}" stroke-width="1.5"`);
  return { svg: shell + parts.join('\n'), h };
}

// Small inline chart legend: colour swatch + label, laid out left→right.
function legend(x, y, k, items) {
  let g = '';
  let cursor = x;
  for (const it of items) {
    g += `<line x1="${cursor}" y1="${y}" x2="${cursor + 24 * k}" y2="${y}" stroke="${it.color}" stroke-width="${3 * k}" stroke-linecap="round"/>`;
    g += txt(cursor + 32 * k, y + 5 * k, it.name, { size: 14 * k, font: FONT.body, fill: UI.fgMuted });
    cursor += 32 * k + it.name.length * 8.5 * k + 24 * k;
  }
  return g;
}

// ── Stats / Profile page mockup ──────────────────────────────────────────
// Mirrors ProfileView's Summary tab: avatar header + 5 stat tiles
// (Total points / Picks made / Picks won / Win rate / Best streak, with the
// `.font-led` Orbitron numerals) + a recent-activity list. Returns { svg, h }.
const TONE = { success: UI.success, danger: UI.danger, warning: UI.warning, neutral: UI.fgMuted };

export function statsPage({ x, y, w, data, activityCount = 3 }) {
  const k = w / 880;
  const pad = 44 * k;
  const r = 34 * k;
  const parts = [];
  let cy = y + pad;

  // ── header: avatar + identity ──
  const avR = 40 * k;
  const avCx = x + pad + avR;
  const avCy = cy + avR;
  parts.push(avatar(avCx, avCy, avR, data.name));
  const tx = avCx + avR + 26 * k;
  parts.push(
    txt(tx, cy + 18 * k, 'PROFILE', { size: 16 * k, font: FONT.bodySemi, fill: 'rgba(34,211,238,0.8)', ls: 4 * k }),
    txt(tx, cy + 58 * k, data.name, { size: 42 * k, font: FONT.bodySemi, fill: UI.fg }),
    txt(tx, cy + 90 * k, `@${data.username}  ·  ${data.joined}`, { size: 19 * k, font: FONT.body, fill: UI.fgMuted }),
  );
  cy += avR * 2 + 30 * k;

  // ── 5 stat tiles ──
  const tileGap = 12 * k;
  const tileW = (w - pad * 2 - tileGap * 4) / 5;
  const tileH = 132 * k;
  data.tiles.forEach((t, i) => {
    const txx = x + pad + i * (tileW + tileGap);
    parts.push(rrect(txx, cy, tileW, tileH, 18 * k, `fill="rgba(15,23,42,0.7)"`));
    const cxx = txx + tileW / 2;
    parts.push(
      txt(cxx, cy + 34 * k, t.label[0].toUpperCase(), { size: 13 * k, font: FONT.bodySemi, fill: UI.fgMuted, anchor: 'middle', ls: 2 * k }),
      txt(cxx, cy + 54 * k, t.label[1].toUpperCase(), { size: 13 * k, font: FONT.bodySemi, fill: UI.fgMuted, anchor: 'middle', ls: 2 * k }),
      txt(cxx, cy + 104 * k, t.value, { size: 38 * k, font: FONT.brand, weight: 700, fill: UI.fg, anchor: 'middle' }),
    );
  });
  cy += tileH + 30 * k;

  // ── recent activity ──
  const rows = data.activity.slice(0, activityCount);
  if (rows.length) {
    parts.push(txt(x + pad, cy, 'RECENT ACTIVITY', { size: 16 * k, font: FONT.bodySemi, fill: UI.fgMuted, ls: 3 * k }));
    cy += 32 * k;
    const rowH = 78 * k;
    const rowGap = 12 * k;
    rows.forEach((a) => {
      parts.push(rrect(x + pad, cy, w - pad * 2, rowH, 20 * k, `fill="rgba(15,23,42,0.7)"`));
      parts.push(
        `${txt(x + pad + 26 * k, cy + 32 * k, a.home, { size: 22 * k, font: FONT.body, fill: UI.fg })}${txt(x + pad + 26 * k + a.home.length * 12.5 * k + 10 * k, cy + 32 * k, 'vs', { size: 18 * k, font: FONT.body, fill: UI.fgSubtle })}${txt(x + pad + 26 * k + a.home.length * 12.5 * k + 46 * k, cy + 32 * k, a.away, { size: 22 * k, font: FONT.body, fill: UI.fg })}`,
        txt(x + pad + 26 * k, cy + 58 * k, `Picked ${a.pick}`, { size: 17 * k, font: FONT.body, fill: UI.fgSubtle }),
      );
      // status badge (right)
      const tone = TONE[a.tone] || UI.fgMuted;
      const bw = a.status.length * 11 * k + 28 * k;
      parts.push(
        rrect(x + w - pad - bw - 16 * k, cy + rowH / 2 - 18 * k, bw, 36 * k, 18 * k, `fill="rgba(0,0,0,0.001)" stroke="${tone}" stroke-opacity="0.5" stroke-width="1.5"`),
        txt(x + w - pad - bw / 2 - 16 * k, cy + rowH / 2 + 6 * k, a.status.toUpperCase(), { size: 17 * k, font: FONT.bodySemi, fill: tone, anchor: 'middle' }),
      );
      cy += rowH + rowGap;
    });
    cy -= rowGap;
  }
  cy += pad;

  const h = cy - y;
  const shell = rrect(x, y, w, h, r, `fill="${UI.elevated}" stroke="${UI.border}" stroke-width="1.5"`);
  return { svg: shell + parts.join('\n'), h };
}

// ── Picks-vs-model card ──────────────────────────────────────────────────
// Two charts for one fixture: "how fans are picking" (winner-only crowd
// split, Home vs Away) above "what the model predicts" (3-way probabilities,
// Home / Draw / Away). Driven by live data from marketing/lib/livedata.mjs.
//
// game = { home, away, dateLabel, kickoff, leagueName,
//          probs:{home,draw,away}, crowd:{home,away,total} }
// Returns { svg, h }.
const PVM = { home: UI.accent, draw: UI.warning, away: '#a855f7' };

export function picksVsModelCard({ x, y, w, game }) {
  const k = w / 880;
  const pad = 44 * k;
  const r = 34 * k;
  const innerW = w - pad * 2;
  const cx = x + w / 2;
  const parts = [];
  let cy = y + pad;

  // ── header: matchup + meta ──
  parts.push(
    txt(cx, cy + 30 * k, `${game.home}  vs  ${game.away}`, {
      size: 38 * k,
      font: FONT.bodySemi,
      fill: UI.fg,
      anchor: 'middle',
    }),
  );
  const meta = [game.leagueName, game.dateLabel, game.kickoff].filter(Boolean).join('  ·  ');
  parts.push(
    txt(cx, cy + 64 * k, meta.toUpperCase(), {
      size: 16 * k,
      font: FONT.bodySemi,
      fill: 'rgba(34,211,238,0.8)',
      anchor: 'middle',
      ls: 2 * k,
    }),
  );
  cy += 100 * k;

  // ── Panel A — crowd split (winner-only Home vs Away) ──
  const { home: ch, total } = game.crowd;
  parts.push(
    txt(x + pad, cy + 18 * k, 'HOW FANS ARE PICKING', {
      size: 15 * k,
      font: FONT.bodySemi,
      fill: UI.fgMuted,
      ls: 3 * k,
    }),
  );
  cy += 44 * k;
  const barH = 56 * k;
  if (total > 0) {
    // Force the two segments to sum to exactly 100% (no rounding sliver).
    const homePct = Math.round((ch / total) * 100);
    const awayPct = 100 - homePct;
    const homeW = (homePct / 100) * innerW;
    parts.push(
      // away segment (full track) then home segment on top — rounded ends.
      rrect(x + pad, cy, innerW, barH, barH / 2, `fill="rgba(168,85,247,0.25)"`),
      rrect(x + pad, cy, Math.max(homeW, barH), barH, barH / 2, `fill="rgba(34,211,238,0.85)"`),
      // inline percentages
      txt(x + pad + 22 * k, cy + barH / 2 + 8 * k, `${homePct}%`, {
        size: 26 * k,
        font: FONT.brand,
        weight: 700,
        fill: UI.base,
      }),
      txt(x + pad + innerW - 22 * k, cy + barH / 2 + 8 * k, `${awayPct}%`, {
        size: 26 * k,
        font: FONT.brand,
        weight: 700,
        fill: UI.fg,
        anchor: 'end',
      }),
    );
    cy += barH + 30 * k;
    // labels under the bar
    parts.push(
      txt(x + pad, cy, `${game.home}`, { size: 19 * k, font: FONT.body, fill: UI.fgMuted }),
      txt(x + pad + innerW, cy, `${game.away}`, {
        size: 19 * k,
        font: FONT.body,
        fill: UI.fgMuted,
        anchor: 'end',
      }),
      txt(cx, cy, `${total.toLocaleString()} pick${total === 1 ? '' : 's'}`, {
        size: 19 * k,
        font: FONT.bodySemi,
        fill: UI.fgSubtle,
        anchor: 'middle',
      }),
    );
    cy += 22 * k;
  } else {
    // empty state — no picks yet
    parts.push(
      rrect(x + pad, cy, innerW, barH, barH / 2, `fill="rgba(15,23,42,0.7)" stroke="${UI.border}" stroke-width="1.5"`),
      txt(cx, cy + barH / 2 + 7 * k, 'No picks yet — be the first', {
        size: 20 * k,
        font: FONT.body,
        fill: UI.fgMuted,
        anchor: 'middle',
      }),
    );
    cy += barH + 8 * k;
  }
  cy += 36 * k;

  // ── Panel B — model probabilities (3-way) ──
  parts.push(
    txt(x + pad, cy + 18 * k, 'WHAT THE MODEL PREDICTS', {
      size: 15 * k,
      font: FONT.bodySemi,
      fill: UI.fgMuted,
      ls: 3 * k,
    }),
  );
  cy += 50 * k;
  const rows = [
    { label: game.home, pct: Math.round(game.probs.home * 100), color: PVM.home },
    { label: 'Draw', pct: Math.round(game.probs.draw * 100), color: PVM.draw },
    { label: game.away, pct: Math.round(game.probs.away * 100), color: PVM.away },
  ];
  const labelW = 220 * k; // left gutter for the team/draw label
  const trackX = x + pad + labelW;
  const trackW = innerW - labelW - 80 * k; // leave room for the % at the right
  const rowH = 40 * k;
  const rowGap = 26 * k;
  rows.forEach((row) => {
    const ty = cy;
    parts.push(
      // label (truncate-safe: anchored start, sits in the gutter)
      txt(x + pad, ty + rowH / 2 + 7 * k, row.label, { size: 22 * k, font: FONT.body, fill: UI.fg }),
      // track + fill
      rrect(trackX, ty, trackW, rowH, rowH / 2, `fill="rgba(15,23,42,0.8)"`),
      rrect(trackX, ty, Math.max((row.pct / 100) * trackW, rowH), rowH, rowH / 2, `fill="${row.color}"`),
      // % at the right edge
      txt(x + pad + innerW, ty + rowH / 2 + 8 * k, `${row.pct}%`, {
        size: 24 * k,
        font: FONT.brand,
        weight: 700,
        fill: UI.fg,
        anchor: 'end',
      }),
    );
    cy += rowH + rowGap;
  });
  cy += pad - rowGap;

  const h = cy - y;
  const shell = rrect(x, y, w, h, r, `fill="${UI.elevated}" stroke="${UI.border}" stroke-width="1.5"`);
  return { svg: shell + parts.join('\n'), h };
}
