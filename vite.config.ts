import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { bayDevErrorPanel } from './src/dev/error-panel-plugin.ts';
import { bayPendingImports } from './src/dev/pending-imports-plugin.ts';
import { bayPreviewBridge } from './src/dev/preview-bridge-plugin.ts';
import { bayPreviewConsole } from './src/dev/preview-console-plugin.ts';

const apiPort = process.env['BAY_API_PORT'] ?? '3001';

export default defineConfig({
  plugins: [
    // First, so its head-prepend reporter runs before every other script.
    bayPreviewConsole(),
    react(),
    bayPendingImports(),
    bayDevErrorPanel(),
    bayPreviewBridge(),
  ],
  server: {
    /* bay-studio: preview server options, applied only inside a Studio session */
    ...(process.env['STUDIO_SESSION_ID']
      ? {
          host: true,
          allowedHosts: ['.runway.studio'],
          hmr: { clientPort: 443, protocol: 'wss', overlay: false },
        }
      : {}),
    strictPort: true,
    proxy: {
      '/trpc': `http://localhost:${apiPort}`,
      '/__bay': `http://localhost:${apiPort}`,
      // Raw (non-tRPC) Koa routes must be listed here or the browser hits
      // Vite's SPA fallback instead of the API process under `bay dev` /
      // Studio preview. Mirrors the `webapp` shape's generated config
      // (packages/cli/src/commands/add.ts). Serve new raw Koa routes under
      // `/api/…` — it's already proxied. Only a genuinely new top-level
      // prefix (not `/trpc`, `/__bay`, `/api`, `/media`) needs a new entry.
      // Anchored (^…) so public/mediapipe/ or public/apidocs/ still serve from Vite.
      '^/api([/?]|$)': `http://localhost:${apiPort}`,
      '^/media([/?]|$)': `http://localhost:${apiPort}`,
    },
  },
});
