import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Chunk 1 ships the generateSW strategy so workbox writes the service
      // worker for us; Chunk 5 will swap to `injectManifest` and supply a
      // custom src/sw.js with push + notificationclick handlers.
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'Bantryx — ScoreCast',
        short_name: 'Bantryx',
        description:
          'Predict football match outcomes, climb the leaderboard, and earn badges with friends.',
        theme_color: '#020617',
        background_color: '#020617',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'en',
        categories: ['sports', 'entertainment'],
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the Vite output (HTML shell + JS/CSS chunks + icons).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Cap the precache budget so the SW install doesn't balloon if a
        // future asset (e.g. a video) lands in dist/.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // SPA fallback so deep links work offline.
        navigateFallback: '/index.html',
        // Don't serve the fallback for /api/* — those should fail loudly
        // when offline so the app can show "you're offline" toasts.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Google Fonts CSS — short-lived; the font files themselves are
            // cached separately by the rule below.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // API reads — stale-while-revalidate so the shell can render
            // last-known data instantly while a fresh fetch lands in the
            // background. Mutating verbs (POST/PUT/DELETE) bypass the cache
            // because Workbox only caches GET by default.
            urlPattern: /^\/api\/(games|leaderboard|me|groups|leagues)(\/|$|\?)/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-reads',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: {
        // Keep the SW out of `vite dev` so HMR isn't disrupted. The plugin
        // still serves the manifest in dev for inspection.
        enabled: false,
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React + ReactDOM stay in a stable vendor chunk
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor';
          }
          // Sentry browser SDK
          if (id.includes('node_modules/@sentry/')) {
            return 'sentry';
          }
          // Radix primitives (Tier 11) — caches independently of app code
          if (id.includes('node_modules/@radix-ui/')) {
            return 'radix';
          }
          return undefined;
        },
      },
    },
  },
});
