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
function flame(cx, cy, size, color = UI.streak) {
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
//          payout:{home,away,drawH,drawA}, pickSide, pickTeam, result,
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
      txt(x + pad, cy + 26 * k, `${data.dateLabel} · ${final ? 'Final' : 'Upcoming'}`, {
        size: 19 * k,
        font: FONT.bodySemi,
        fill: 'rgba(34,211,238,0.8)',
        ls: 3 * k,
      }),
    );
  }
  // right-side pill / outcome badge
  if (final) {
    const won = data.result === data.pickSide;
    const draw = data.result === 'draw';
    const badgeTxt = draw
      ? `Drew +${data.points} pts`
      : won
        ? `✓ Correct +${data.points} pts`
        : '✗ Missed';
    const tone = draw ? UI.warning : won ? UI.success : UI.danger;
    const bw = badgeTxt.length * 11.5 * k + 28 * k;
    parts.push(
      rrect(x + w - pad - bw, cy + 2 * k, bw, 36 * k, 18 * k, `fill="rgba(0,0,0,0.001)" stroke="${tone}" stroke-opacity="0.5" stroke-width="1.5"`),
      txt(x + w - pad - bw / 2, cy + 25 * k, badgeTxt, { size: 18 * k, font: FONT.bodySemi, fill: tone, anchor: 'middle' }),
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
  if (winSide === 'home') parts.push(rrect(x + pad - 12 * k, cy - 34 * k, 300 * k, 64 * k, 18 * k, `fill="rgba(74,222,128,0.06)" stroke="${UI.success}" stroke-opacity="0.4" stroke-width="1"`));
  if (winSide === 'away') parts.push(rrect(x + w - pad - 300 * k + 12 * k, cy - 34 * k, 300 * k, 64 * k, 18 * k, `fill="rgba(74,222,128,0.06)" stroke="${UI.success}" stroke-opacity="0.4" stroke-width="1"`));
  parts.push(`<g${homeDim}>${txt(x + pad, cy, data.home, { size: teamFont, font: FONT.bodySemi, fill: UI.fg })}${winSide === 'home' ? txt(x + pad, cy + 28 * k, 'Winner', { size: 15 * k, font: FONT.bodySemi, fill: UI.success, ls: 1 * k }) : ''}</g>`);
  parts.push(`<g${awayDim}>${txt(x + w - pad, cy, data.away, { size: teamFont, font: FONT.bodySemi, fill: UI.fg, anchor: 'end' })}${winSide === 'away' ? txt(x + w - pad, cy + 28 * k, 'Winner', { size: 15 * k, font: FONT.bodySemi, fill: UI.success, ls: 1 * k, anchor: 'end' }) : ''}</g>`);

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
    parts.push(
      rrect(hx, ty, tileW, tileH, 10 * k, `fill="rgba(15,23,42,0.6)"`),
      txt(hx + tileW / 2, ty + tileH / 2 + 16 * k, String(data.homeScore), { size: 44 * k, font: FONT.brand, weight: 700, fill: homeHi ? UI.accent : UI.fg, anchor: 'middle' }),
      txt(cx, cy - 6 * k, '-', { size: 34 * k, fill: UI.fgSubtle, anchor: 'middle' }),
      rrect(ax, ty, tileW, tileH, 10 * k, `fill="rgba(15,23,42,0.6)"`),
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
    // payout grid
    cy += 24 * k;
    const gridY = cy;
    const gridH = 92 * k;
    const colGap = 2 * k;
    const colW = (w - pad * 2 - colGap * 2) / 3;
    parts.push(rrect(x + pad, gridY, w - pad * 2, gridH, 16 * k, `fill="${UI.border}"`));
    const cells = [
      { v: `+${data.payout.home}`, lab: false },
      { v: 'WIN', lab: true },
      { v: `+${data.payout.away}`, lab: false },
    ];
    const row2 = [
      { v: `+${data.payout.drawH}`, lab: false },
      { v: 'DRAW', lab: true },
      { v: `+${data.payout.drawA}`, lab: false },
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
    parts.push(txt(cx, gridY + gridH + 30 * k, 'Payout locks in at kickoff.', { size: 15 * k, font: FONT.body, fill: UI.fgMuted, anchor: 'middle' }));
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
