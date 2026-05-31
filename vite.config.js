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
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
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
          // Tier 30 Phase 2 — motion/react gets its own chunk (~12-15 KB
          // gzip) so the main bundle delta stays under 5 KB and the
          // motion-heavy paths (Landing hero, GameCard score flip,
          // sidebar tab indicator) don't pull animation code into the
          // critical path.
          if (id.includes('node_modules/motion/') || id.includes('node_modules/framer-motion/')) {
            return 'motion';
          }
          // Tier 30 Phase 3 A4 — html-to-image (~3 KB gzip) gets its own
          // chunk so the GameCard's eager bundle stays lean. The
          // ShareSheet itself is lazy-imported, so this just guarantees
          // a dedicated chunk filename for cache eviction tracking.
          if (id.includes('node_modules/html-to-image/')) {
            return 'html-to-image';
          }
          // Tier 30 Phase 3 C1 — recharts + its d3 deps go into a single
          // 'charts' chunk. StatsDashboard is React.lazy'd in ProfileView
          // so the chunk only loads when the Stats sub-tab is opened.
          if (
            id.includes('node_modules/recharts/') ||
            id.includes('node_modules/d3-') ||
            id.includes('node_modules/victory-vendor/')
          ) {
            return 'charts';
          }
          return undefined;
        },
      },
    },
  },
});
