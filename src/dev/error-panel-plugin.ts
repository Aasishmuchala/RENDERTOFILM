import type { Plugin } from 'vite';

const PANEL_MODULE = '/src/client/dev-error-panel.ts';

/**
 * Loads the error panel as its own module script, the way Vite loads its own
 * client. It can't be imported from `main.tsx`: a module graph evaluates
 * all-or-nothing, so a syntax error anywhere under it means the listener never
 * registers — exactly when the panel is needed.
 */
export function bayDevErrorPanel(): Plugin {
  return {
    name: 'bay:dev-error-panel',
    apply: 'serve',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: PANEL_MODULE },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
