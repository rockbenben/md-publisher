import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build output goes straight into the directory Express already serves
// (src/public), which the build fully owns: emptyOutDir wipes stale bundles,
// and platform icons in web/public/icons are copied back to /icons each build.
// The backend, API and SSE protocol are untouched — only the static UI changes.
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: '../src/public',
    emptyOutDir: true,
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1500,
    // Stable filenames (no content hash): the server sends `no-store` for
    // everything in src/public (see gui.js), so hashes buy no cache-busting —
    // they only churn git diffs on every rebuild. Fixed names keep diffs clean.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  server: {
    port: 5173,
    // Dev proxy: forward REST + SSE to the running `npm run gui` server.
    // (Icons are served directly from publicDir in dev.)
    proxy: {
      '/api': {
        target: 'http://localhost:9870',
        changeOrigin: true,
      },
    },
  },
});
