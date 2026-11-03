import { resolve } from 'node:path';

import { defineConfig } from 'vite';

/**
 * Multi-page Vite build: one HTML entry per surface (player, host, editor) plus
 * a landing page. Static legal pages are added in later phases.
 */
export default defineConfig({
  root: resolve(__dirname, 'src'),
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/index.html'),
        host: resolve(__dirname, 'src/host.html'),
        editor: resolve(__dirname, 'src/editor.html'),
        admin: resolve(__dirname, 'src/admin.html'),
      },
    },
  },
  server: {
    port: 5173,
    // The dev server is reached through the platform's proxied hostnames, which
    // Vite otherwise rejects. Only the platform's own domain is allowed, so this
    // does not open the server up to arbitrary Host headers.
    allowedHosts: ['.prod-runtime.all-hands.dev'],
    proxy: {
      // `^/api/` (not `/api`) so the rule does not also swallow the client
      // module `/api.ts`, which Vite serves from the project root.
      '^/api/': 'http://localhost:3000',
      '^/socket\.io/': { target: 'http://localhost:3000', ws: true },
    },
  },
});
