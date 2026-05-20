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

await writePng('public/pwa-64x64.png', 64);
await writePng('public/pwa-192x192.png', 192);
await writePng('public/pwa-512x512.png', 512);
await writePng('public/apple-touch-icon-180x180.png', 180);
await writePng('public/maskable-icon-512x512.png', 512, maskableSvg);

const ico = await pngToIco([await rasterize(svg, 32), await rasterize(svg, 48)]);
await writeFile(resolve(root, 'public/favicon.ico'), ico);
console.log(`wrote public/favicon.ico (${ico.length} bytes)`);
