import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
