// PWA Chunk 5 — custom service worker (injectManifest strategy).
//
// vite-plugin-pwa bundles this file with its workbox-* runtime imports +
// injects the precache manifest into self.__WB_MANIFEST. We then layer the
// push-specific handlers (`push`, `notificationclick`) that the off-the-shelf
// generateSW preset couldn't give us.
//
// The Chunk 1 runtime-caching rules (Google Fonts + /api reads with 5-min SWR)
// are re-declared here verbatim so the offline shell + cached data behavior
// from Chunks 1-3 is preserved when we switch strategies.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

// Take over open tabs as soon as a new SW activates so users don't have to
// hard-refresh after a deploy. Matches the registerType:'autoUpdate' behavior
// the generateSW strategy gave us in Chunk 1.
self.skipWaiting();
clientsClaim();

// Drop stale precache entries from previous SW versions.
cleanupOutdatedCaches();

// Precache the Vite asset manifest (HTML shell + JS/CSS chunks + icons).
// vite-plugin-pwa replaces self.__WB_MANIFEST at build time.
precacheAndRoute(self.__WB_MANIFEST || []);

// Google Fonts CSS — short-lived.
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({
    cacheName: 'google-fonts-stylesheets',
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 })],
  }),
);

// Google Fonts woff2 binaries — long-lived.
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);

// API reads — last-known data renders instantly while a fresh fetch lands in
// the background. Workbox only caches GET by default so mutating verbs bypass.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.pathname.startsWith('/api/') &&
    /^\/api\/(games|leaderboard|me|groups|leagues)(\/|$)/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'api-reads',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 5 }),
    ],
  }),
);

// SPA fallback: a hard-refresh on a deep link while offline should still
// hand back the cached app shell (index.html) instead of erroring.
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
  async ({ event }) => {
    try {
      return await fetch(event.request);
    } catch {
      const cache = await caches.open('workbox-precache-v2');
      const cached = await cache.match('/index.html');
      if (cached) return cached;
      // Last resort — let the browser handle the offline UI.
      return Response.error();
    }
  },
);

// ----------------------------------------------------------------------------
// Web Push handlers.
//
// Server payload shape (services/PushService.js builds it):
//   { title, body, link, type }
// `tag` deduplicates same-type pushes (newer replaces older); `data.link` is
// the URL we navigate to on click.
// ----------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Bantryx', body: event.data.text() };
  }
  const title = payload.title || 'Bantryx';
  const options = {
    body: payload.body || undefined,
    icon: '/pwa-192x192.png',
    // Android renders a monochrome badge in the status bar. Reuse the 64px
    // PWA icon — Android masks it to the small status-bar size.
    badge: '/pwa-64x64.png',
    tag: payload.type || 'default',
    data: { link: payload.link || '/' },
    // iOS ignores actions on the lock screen but Android shows them.
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.link || '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Focus an existing window if one's already open — even if it's on a
      // different route. Then navigate it to the deep link.
      for (const client of all) {
        if ('focus' in client) {
          await client.focus();
          if (targetUrl !== '/' && 'navigate' in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              // Cross-origin navigate guard — ignore. Focused window is fine.
            }
          }
          return;
        }
      }
      // No open windows — open a fresh one.
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
