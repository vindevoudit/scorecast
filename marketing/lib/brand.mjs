// Bantryx marketing kit — reusable SVG fragments.
//
// Pure functions returning SVG-string fragments composed by the layout
// renderers in scripts/generate-marketing-assets.mjs. Gradients + colours are
// copied verbatim from the live brand (public/logo.svg + public/og-template.svg).
//
// Brand identity (post-redesign): the logo is the Orbitron "BANTRYX" wordmark
// (and an Orbitron "B" for square app icons) — the old drawn-B + wordmark
// lockup is retired. Icons are clean Lucide-style geometry with a cyan glow.
//
// Font family names match the bundled TTFs in marketing/fonts/. Fontsource
// static instances register Medium/SemiBold/Black as their OWN families, so we
// reference exact family names rather than relying on font-weight in resvg.

// ── Palette ──────────────────────────────────────────────────────────────
export const COLOR = {
  navy0: '#0f172a',
  navy1: '#020617',
  cyan: '#06b6d4',
  cyanSoft: '#67e8f9',
  textHi: '#e2e8f0',
  white: '#ffffff',
  muted: '#94a3b8',
  dim: '#475569',
  border: '#1e293b',
};

// ── Fonts ────────────────────────────────────────────────────────────────
export const FONT = {
  brand: 'Orbitron', // BANTRYX wordmark + B mark (bold weight = "Orbitron")
  display: 'Bebas Neue', // headlines + big numbers
  body: 'Inter',
  bodyMed: 'Inter Medium',
  bodySemi: 'Inter SemiBold',
  bodyBlack: 'Inter Black',
};

let _uid = 0; // unique-id counter for per-icon glow filters

// ── XML-escape for text content ──────────────────────────────────────────
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Shared gradient defs (ids: bg, glow, mark, pitchline) ────────────────
export function baseDefs({ glowCx = 0.5, glowCy = 0.4, glowR = 0.6 } = {}) {
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${COLOR.navy0}"/>
      <stop offset="1" stop-color="${COLOR.navy1}"/>
    </linearGradient>
    <radialGradient id="glow" cx="${glowCx}" cy="${glowCy}" r="${glowR}">
      <stop offset="0" stop-color="${COLOR.cyan}" stop-opacity="0.38"/>
      <stop offset="1" stop-color="${COLOR.cyan}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${COLOR.cyanSoft}"/>
      <stop offset="1" stop-color="${COLOR.cyan}"/>
    </linearGradient>
    <linearGradient id="pitchline" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${COLOR.cyanSoft}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${COLOR.cyanSoft}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="${COLOR.cyanSoft}" stop-opacity="0"/>
    </linearGradient>
  </defs>`;
}

// ── Background: gradient + cyan glow + optional arena grid ───────────────
export function background(w, h, { grid = true } = {}) {
  return `
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${grid ? arenaGrid(w, h) : ''}
  <rect width="${w}" height="${h}" fill="url(#glow)"/>`;
}

export function arenaGrid(w, h, { step = 120, color = COLOR.cyan, opacity = 0.05 } = {}) {
  let lines = '';
  for (let x = step; x < w; x += step)
    lines += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1"/>`;
  for (let y = step; y < h; y += step)
    lines += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1"/>`;
  return `<g>${lines}</g>`;
}

// ── Wordmark — Orbitron BANTRYX ──────────────────────────────────────────
// Orbitron advance ≈ 1.30em/char including its built-in sidebearings. Used to
// size + center the wordmark so callers don't have to guess widths.
const ORBITRON_EM = 1.3;
export function wordmarkWidth(size, text = 'BANTRYX', letterSpacing) {
  const ls = letterSpacing ?? size * 0.04;
  return text.length * size * ORBITRON_EM + (text.length - 1) * ls;
}
export function wordmark({
  x,
  y,
  size = 120,
  anchor = 'start',
  fill = 'url(#mark)',
  letterSpacing,
  text = 'BANTRYX',
}) {
  const ls = letterSpacing ?? size * 0.04;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT.brand}" font-weight="700" font-size="${size}" letter-spacing="${ls}" fill="${fill}">${esc(text)}</text>`;
}

// Compact corner brand tag — small Orbitron BANTRYX, left-anchored, preceded
// by a small cyan diamond. (No B-mark + wordmark lockup; that combo is retired.)
export function brandTag({ x, y, size = 40 }) {
  const dotR = size * 0.16;
  const wmX = x + dotR * 3.2;
  return `
  <g>
    <rect x="${x}" y="${y - dotR}" width="${dotR * 2}" height="${dotR * 2}" rx="${dotR * 0.4}" transform="rotate(45 ${x + dotR} ${y})" fill="url(#mark)"/>
    <text x="${wmX}" y="${y + size * 0.34}" font-family="${FONT.brand}" font-weight="700" font-size="${size}" letter-spacing="${size * 0.06}" fill="${COLOR.cyanSoft}">BANTRYX</text>
  </g>`;
}

// ── Pitch-line rule (fades at both ends) ─────────────────────────────────
export function rule({ x, y, w, h = 3 }) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#pitchline)"/>`;
}

// ── Pill / chip ──────────────────────────────────────────────────────────
export function chip({ x, y, label, size = 28, padX = 26, padY = 16, accent = false }) {
  const w = padX * 2 + label.length * size * 0.62;
  const h = size + padY * 2;
  const stroke = accent ? COLOR.cyan : COLOR.border;
  const fill = accent ? 'rgba(6,182,212,0.12)' : 'rgba(15,23,42,0.6)';
  const txt = accent ? COLOR.cyanSoft : COLOR.muted;
  return `
  <g>
    <rect x="${x}" y="${y}" rx="${h / 2}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
    <text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.bodySemi}" font-size="${size}" letter-spacing="${size * 0.08}" fill="${txt}">${esc(label.toUpperCase())}</text>
  </g>`;
}
export function chipWidth(label, size = 28, padX = 26) {
  return padX * 2 + label.length * size * 0.62;
}

// ── CTA button ───────────────────────────────────────────────────────────
export function ctaPill({ cx, y, label = "Get started — it's free", size = 34 }) {
  const w = size * 0.62 * label.length + 96;
  const h = size + 52;
  const x = cx - w / 2;
  return `
  <g>
    <rect x="${x}" y="${y}" rx="${h / 2}" width="${w}" height="${h}" fill="url(#mark)"/>
    <text x="${cx}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" font-family="${FONT.bodyBlack}" font-size="${size}" fill="${COLOR.navy1}">${esc(label)}</text>
  </g>`;
}

// ── Multiline text (manual wrap by character budget) ─────────────────────
export function wrapLines(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const word of words) {
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= maxChars) cur += ' ' + word;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function textBlock({
  x,
  y,
  lines,
  size,
  lineHeight,
  anchor = 'start',
  fill = COLOR.textHi,
  font = FONT.body,
  letterSpacing = 0,
}) {
  const lh = lineHeight ?? size * 1.3;
  return lines
    .map(
      (ln, i) =>
        `<text x="${x}" y="${y + i * lh}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" letter-spacing="${letterSpacing}" fill="${fill}">${esc(ln)}</text>`,
    )
    .join('\n');
}

// ── Footer lockup: pitch rule + tagline + url ────────────────────────────
export function footer({ cx, y, w }) {
  return `
  ${rule({ x: cx - w / 2, y, w })}
  <text x="${cx}" y="${y + 56}" text-anchor="middle" font-family="${FONT.bodySemi}" font-size="30" letter-spacing="3" fill="${COLOR.muted}">NO BETTING, JUST BANTRYX</text>
  <text x="${cx}" y="${y + 104}" text-anchor="middle" font-family="${FONT.brand}" font-weight="700" font-size="34" letter-spacing="2" fill="${COLOR.cyanSoft}">bantryx.com</text>`;
}

// ── Icons — Lucide-style geometry (24-unit grid, centred on 12,12) ───────
// Clean, non-crossing, professionally balanced. Lucide is ISC-licensed.
const LUCIDE = {
  target: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.7" fill="CURRENTGLOW" stroke="none"/>`,
  users: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  trending: `<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>`,
  award: `<circle cx="12" cy="8.5" r="6"/><path d="M8.2 13.4 6.5 22l5.5-3.3L17.5 22l-1.7-8.6"/>`,
  zap: `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="CURRENTGLOW" stroke="none"/><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  gift: `<path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8"/><path d="M2 8.5h20v3.5H2z" stroke="none" fill="none"/><rect x="2.5" y="8" width="19" height="4" rx="1"/><path d="M12 8v13"/><path d="M12 8S11 3 8 3a2.5 2.5 0 0 0 0 5z"/><path d="M12 8s1-5 4-5a2.5 2.5 0 0 1 0 5z"/>`,
};

function lucidePaths(name, color) {
  return (LUCIDE[name] || '').replaceAll('CURRENTGLOW', color);
}

export function lucideIcon(name, { cx, cy, size, color = COLOR.cyanSoft, strokeW = 2 }) {
  const s = size / 24;
  return `<g transform="translate(${cx - 12 * s} ${cy - 12 * s}) scale(${s})" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round">${lucidePaths(name, color)}</g>`;
}

// Icon inside a soft badge: subtle disc + blurred glow copy + crisp icon, all
// centred on (cx, cy).
export function iconBadge({ name, cx, cy, badgeR, iconSize, color = COLOR.cyanSoft, disc = true }) {
  const fid = `iglow${_uid++}`;
  const std = (iconSize * 0.045).toFixed(2);
  const shape = lucideIcon(name, { cx, cy, size: iconSize, color, strokeW: 2 });
  return `
  <defs><filter id="${fid}" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="${std}"/></filter></defs>
  ${disc ? `<circle cx="${cx}" cy="${cy}" r="${badgeR}" fill="rgba(6,182,212,0.07)" stroke="${COLOR.cyan}" stroke-opacity="0.28" stroke-width="2"/>` : ''}
  <g filter="url(#${fid})" opacity="0.75">${shape}</g>
  ${shape}`;
}

// ── SVG document wrapper ─────────────────────────────────────────────────
export function svgDoc({ w, h, body, glow }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
${baseDefs(glow)}
${body}
</svg>`;
}
