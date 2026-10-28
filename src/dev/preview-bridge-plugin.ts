import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

const BRIDGE_MODULE = '/src/client/dev-preview-bridge.ts';

/**
 * Whether the app's `@runway/bay-react` is new enough to have the bridge.
 *
 * Checked here rather than left to fail in the browser: an unresolvable
 * import — static or dynamic — is a transform error, and Vite's overlay plus
 * the dev error panel then cover a working app over nothing worse than a
 * missing Select button. Skipping the injection loses Select and nothing else.
 *
 * Resolved from the project root, not `import.meta.url`: Vite bundles this
 * config to a temp file, so the module's own path finds nothing.
 */
function bridgeInstalled(root: string): boolean {
  try {
    createRequire(path.join(root, 'index.js')).resolve(
      '@runway/bay-react/preview-bridge'
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Injects Bay Studio's preview bridge, so Studio can ask which element you
 * clicked. The bridge lives in `@runway/bay-react`; this loads it.
 *
 * Has to be a real file. Vite only resolves bare specifiers in modules it
 * transforms, so an inline script dies on the import, and a virtual module's
 * `/@id/` URL needs `__x00__` plus an encoded colon that the browser then
 * re-encodes into a request Vite 500s on.
 *
 * Its own script, not an import from `main.tsx`, for the reason the error
 * panel gives: a module graph is all-or-nothing, so a syntax error in the app
 * would take the bridge down exactly when you want to point at something.
 */
export function bayPreviewBridge(): Plugin {
  let root = process.cwd();
  return {
    name: 'bay:preview-bridge',
    apply: 'serve',
    configResolved(config) {
      root = config.root;
    },
    transformIndexHtml() {
      if (!bridgeInstalled(root)) return [];
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: BRIDGE_MODULE },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
