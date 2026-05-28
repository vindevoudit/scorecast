import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Chunk 5 — switched from generateSW to injectManifest so we own the
      // service worker source (src/sw.js) and can layer push + notificationclick
      // handlers. Workbox runtime-caching rules from Chunk 1 are re-declared
      // inside the SW; behavior is unchanged for offline shell + /api reads.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'Bantryx',
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
      // injectManifest precache budget — same 3MB cap as Chunk 1's
      // generateSW config. Runtime-caching rules live inside src/sw.js now.
      // Exclude help screenshots: they're large, lazy-loaded via <img loading="lazy">,
      // and only viewed by users who navigate to /help — no need to precache 5MB on
      // every install.
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        globIgnores: ['**/help/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
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
