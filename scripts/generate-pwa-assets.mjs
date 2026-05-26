// Generate PWA icon assets from public/logo.svg.
//
// Why this exists instead of @vite-pwa/assets-generator: that package depends
// on the sharp/libvips native binary, which has no working win32-arm64
// prebuild in the version we transitively get (sharp 0.33.5). Switching to
// resvg-js lets the script run on every platform we ship from (Linux x64 in
// CI, win32-arm64 / win32-x64 / macOS arm64 locally).
//
// Outputs (in public/):
//   favicon.ico  — multi-size 32 + 48
//   pwa-64x64.png
//   pwa-192x192.png
//   pwa-512x512.png
//   maskable-icon-512x512.png — same artwork, mark scaled to 70% safe zone
//   apple-touch-icon-180x180.png

import { Resvg } from '@resvg/resvg-js';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pngToIco from 'png-to-ico';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'public/logo.svg');
const svg = await readFile(sourcePath, 'utf8');
// Tier 20 Chunk 6 — separate landscape SVG for the social-card OG image.
// 1200×630 is the cross-platform sweet spot (FB / LinkedIn / Slack /
// Discord / Twitter summary_large_image all render this aspect cleanly).
const ogSourcePath = resolve(root, 'public/og-template.svg');
const ogSvg = await readFile(ogSourcePath, 'utf8');

// Wrap the mark path in a centered 70% scale group so the visible artwork
// stays within the maskable safe zone (Android Adaptive Icon spec carves
// out the outer 20% on a 1-radius circle inscribed in the 512px square).
const maskableSvg = svg
  .replace(/(<path\s)/, '<g transform="translate(256 256) scale(0.7) translate(-256 -256)">$1')
  .replace(/(<\/path>|\/>)(\s*<\/svg>)/, '$1</g>$2');

async function rasterize(svgString, size) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  return resvg.render().asPng();
}

async function writePng(target, size, svgString = svg) {
  const png = await rasterize(svgString, size);
  await writeFile(resolve(root, target), png);
  console.log(`wrote ${target} (${size}px, ${png.length} bytes)`);
}

// Tier 20 Chunk 6 — OG image is landscape (1200×630), not square. Skip
// the shared `writePng` helper because it derives height from the SVG's
// own aspect ratio via fit-to-width; here we want the exact 1200px width
// from the 1200×630 viewBox to give us 1200×630 output.
async function writeOgImage(target) {
  const png = await rasterize(ogSvg, 1200);
  await writeFile(resolve(root, target), png);
  console.log(`wrote ${target} (1200×630, ${png.length} bytes)`);
}

await writePng('public/pwa-64x64.png', 64);
await writePng('public/pwa-192x192.png', 192);
await writePng('public/pwa-512x512.png', 512);
await writePng('public/apple-touch-icon-180x180.png', 180);
await writePng('public/maskable-icon-512x512.png', 512, maskableSvg);
await writeOgImage('public/og-image-1200x630.png');

const ico = await pngToIco([await rasterize(svg, 32), await rasterize(svg, 48)]);
await writeFile(resolve(root, 'public/favicon.ico'), ico);
console.log(`wrote public/favicon.ico (${ico.length} bytes)`);
