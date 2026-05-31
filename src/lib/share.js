'use strict';

// Tier 30 Phase 3 A4 — share-as-image helpers.
//
// Image generation runs via html-to-image (~3KB gzip; lives in its own
// chunk thanks to the lazy-imported ShareSheet that uses it). All
// platform shimming + UA sniffing lives here so the React surface stays
// declarative.
//
// Strategy:
//   - Mobile (iOS + Android) with navigator.share + files support →
//     trigger the native share sheet so users can route into Instagram,
//     WhatsApp, Twitter, etc.
//   - Otherwise (desktop, in-app browsers without share API, share
//     cancel) → fall back to a PNG download via a temporary <a download>.
//
// Note on Instagram Stories: the iOS `instagram-stories://share` URL
// scheme requires the image be on the UIPasteboard with the
// `com.instagram.sharedSticker.backgroundImage` data type — a native
// API we can't reach from a PWA. The realistic path from the web is
// navigator.share, which surfaces Instagram Stories as one of the
// destinations in the OS share sheet. Users pick "Stories" there.

import { toBlob } from 'html-to-image';

export function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent || '');
}

export function isAndroid() {
  if (typeof navigator === 'undefined') return false;
  return /Android/.test(navigator.userAgent || '');
}

export function isMobile() {
  return isIos() || isAndroid();
}

export function canShareFiles() {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({
      files: [new File([new Blob(['x'])], 'probe.png', { type: 'image/png' })],
    });
  } catch {
    return false;
  }
}

// Capture a DOM node to a PNG blob. The node is expected to be at its
// natural target dimensions (e.g. 1080x1080) so we don't introduce a
// scaling step that would blur the raster. `pixelRatio: 1` keeps the
// output 1:1 with the DOM; bump to 2 for retina-quality at 2× output.
export async function captureNodeToPng(node, { pixelRatio = 1 } = {}) {
  return toBlob(node, {
    pixelRatio,
    cacheBust: true,
    // Skip element clones the browser pulls in via web fonts that
    // aren't whitelisted by the Google Fonts CSP; falls back to system
    // fonts if a custom face can't be inlined.
    skipFonts: false,
  });
}

// Trigger the native share sheet with the image file. Returns 'shared'
// on success, 'cancelled' on user cancel, 'unsupported' on platforms
// without files-in-share. Rethrows unexpected errors so the caller can
// surface them.
export async function shareFile(blob, filename, { title, text, url } = {}) {
  if (!blob) return 'unsupported';
  const file = new File([blob], filename, { type: 'image/png' });
  if (!canShareFiles()) return 'unsupported';
  try {
    await navigator.share({ files: [file], title, text, url });
    return 'shared';
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

// Trigger a download via temporary <a download> link. Defer the
// URL.revokeObjectURL by 5s so iOS Safari doesn't drop the blob
// before the download dialog reads it.
export function downloadBlob(blob, filename) {
  if (!blob || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Composite entry point: capture → try native share on mobile → fall
// back to download. Returns { method: 'shared'|'downloaded'|'cancelled' }.
export async function shareImageFromNode(node, options = {}) {
  const blob = await captureNodeToPng(node, { pixelRatio: options.pixelRatio || 1 });
  if (!blob) return { method: 'cancelled' };
  const filename = options.filename || `bantryx-${Date.now()}.png`;
  const meta = {
    title: options.title || 'Bantryx pick',
    text: options.text || '',
    url:
      options.url ||
      (typeof window !== 'undefined' ? window.location.origin : 'https://bantryx.com'),
  };

  if (isMobile()) {
    const status = await shareFile(blob, filename, meta);
    if (status === 'shared') return { method: 'shared' };
    if (status === 'cancelled') return { method: 'cancelled' };
    // status === 'unsupported' — fall through to download.
  }
  downloadBlob(blob, filename);
  return { method: 'downloaded' };
}
