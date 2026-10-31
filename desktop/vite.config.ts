// Renderer build for the desktop app: the root vite config (root index.html,
// React plugin) with the four client-side `@runway/bay*` specifiers pointed at
// desktop/platform and the output moved to desktop/dist/dist, which is where
// the bundled server (desktop/dist/server/index.mjs) looks for it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeConfig, type Plugin } from 'vite';

import rootConfig from '../vite.config.ts';

const DESKTOP = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DESKTOP, '..');
const PLATFORM = path.join(DESKTOP, 'platform');
const NODE_MODULES = path.join(DESKTOP, 'node_modules') + path.sep;

const desktopPackage = JSON.parse(
  readFileSync(path.join(DESKTOP, 'package.json'), 'utf8')
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const DESKTOP_PACKAGES = new Set(
  Object.keys({
    ...desktopPackage.dependencies,
    ...desktopPackage.devDependencies,
  })
);
// Vite injects its own bare imports (`vite/modulepreload-polyfill`).
DESKTOP_PACKAGES.delete('vite');

/**
 * `src/client` sits outside desktop/, so its bare imports (`react`, ...) would
 * otherwise resolve from the repo root's node_modules, and the platform's
 * `@runway/bay-react` files from desktop/node_modules: two copies of React in
 * one bundle, or none at all on a runner that never installed the root. Every
 * package desktop/package.json lists resolves from desktop/node_modules, once.
 * @vitejs/plugin-react's `resolve.dedupe` would pin react and react-dom to the
 * repo root instead, so this plugin (listed after it) drops those entries.
 */
function desktopPackages(): Plugin {
  return {
    name: 'desktop-packages',
    enforce: 'pre',
    config(config) {
      const { resolve } = config;
      if (resolve?.dedupe) {
        resolve.dedupe = resolve.dedupe.filter((name) => !DESKTOP_PACKAGES.has(name));
      }
    },
    async resolveId(source, importer, options) {
      if (/^[./\0]/.test(source) || source.startsWith('@runway/')) return null;
      if (importer?.startsWith(NODE_MODULES)) return null;
      const parts = source.split('/');
      const name = source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      if (!name || !DESKTOP_PACKAGES.has(name)) return null;
      return this.resolve(source, path.join(DESKTOP, 'package.json'), {
        ...options,
        skipSelf: true,
      });
    },
  };
}

export default mergeConfig(rootConfig, {
  root: ROOT,
  plugins: [desktopPackages()],
  resolve: {
    alias: {
      '@runway/bay/client': path.join(PLATFORM, 'bay', 'client.js'),
      '@runway/bay-react/tokens.css': path.join(PLATFORM, 'bay-react', 'tokens.css'),
      '@runway/bay-react/runway-sign-in': path.join(PLATFORM, 'bay-react', 'runway-sign-in.js'),
      '@runway/bay-react/credits': path.join(PLATFORM, 'bay-react', 'credits.js'),
      '@runway/bay-react/preview-bridge': path.join(PLATFORM, 'bay-react', 'preview-bridge.js'),
    },
  },
  build: {
    outDir: path.join(DESKTOP, 'dist', 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
