// Builds the desktop app from the repo's own sources:
//   desktop/dist/dist/index.html + assets   the renderer (root vite build)
//   desktop/dist/server/index.mjs           the Koa server (src/index.ts)
//   desktop/main/dist/main.js               Electron main (desktop/main)
//   desktop/preload/dist/preload.js         the window's preload (desktop/preload)
// The renderer sits at dist/dist on purpose: src/routes.ts serves
// path.resolve(import.meta.dirname, '..', 'dist') from the server bundle.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(DESKTOP, '..');
const PLATFORM = path.join(DESKTOP, 'platform', 'bay');
const SERVER_OUT = path.join(DESKTOP, 'dist', 'server', 'index.mjs');
const MAIN_OUT = path.join(DESKTOP, 'main', 'dist', 'main.js');
const PRELOAD_OUT = path.join(DESKTOP, 'preload', 'dist', 'preload.js');

// 1. Renderer. vite's package exports do not list bin/vite.js, so find it
// beside package.json.
const viteBin = path.join(
  path.dirname(require.resolve('vite/package.json')),
  'bin',
  'vite.js'
);
execFileSync(
  process.execPath,
  [viteBin, 'build', '--config', path.join(DESKTOP, 'vite.config.ts')],
  { cwd: ROOT, stdio: 'inherit' }
);

// 2. Server. The four @runway/bay* specifiers become the platform layer's own
// files (esbuild's alias wins over `packages: 'external'`); every other
// package stays external and resolves from desktop/node_modules at runtime.
// The more specific /runway/cookie alias is listed first.
await build({
  entryPoints: [path.join(ROOT, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  keepNames: true,
  sourcemap: false,
  outfile: SERVER_OUT,
  logLevel: 'warning',
  alias: {
    '@runway/bay/runway/cookie': path.join(PLATFORM, 'cookie.js'),
    '@runway/bay/runway': path.join(PLATFORM, 'runway.js'),
    '@runway/bay/storage': path.join(PLATFORM, 'storage.js'),
    '@runway/bay': path.join(PLATFORM, 'index.js'),
  },
  // Aliased: esbuild cannot see into a banner, so a bundled module that imports
  // createRequire itself (ffmpeg.js does) would otherwise declare it twice.
  banner: {
    js: "import { createRequire as __bannerCreateRequire } from 'node:module'; const require = __bannerCreateRequire(import.meta.url);",
  },
});

// A @runway import that no alias caught stays external and fails at runtime.
const leftover = readFileSync(SERVER_OUT, 'utf8').match(
  /(?:from|import|require)\s*\(?\s*["']@runway\/[^"']*["']/g
);
if (leftover) {
  console.error(`The server bundle still imports ${[...new Set(leftover)].join(', ')}`);
  process.exit(1);
}

// 3. Electron main and preload, as CommonJS: sandboxed preloads cannot be ESM.
// The package is `type: module`, so each folder says so for its own .js.
const { version } = JSON.parse(readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
for (const [entry, outfile] of [
  [path.join(DESKTOP, 'main', 'main.ts'), MAIN_OUT],
  [path.join(DESKTOP, 'preload', 'preload.ts'), PRELOAD_OUT],
]) {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    outfile,
    logLevel: 'warning',
    define: { __APP_VERSION__: JSON.stringify(version) },
  });
  writeFileSync(path.join(path.dirname(outfile), 'package.json'), '{ "type": "commonjs" }\n');
}

// 4. Sizes.
const RENDERER_OUT = path.join(DESKTOP, 'dist', 'dist');
const sizeOf = (target) => {
  const info = statSync(target);
  if (!info.isDirectory()) return info.size;
  return readdirSync(target).reduce((sum, name) => sum + sizeOf(path.join(target, name)), 0);
};
const mb = (target) => `${(sizeOf(target) / 1024 / 1024).toFixed(2)} MB`;
console.log(`renderer  ${RENDERER_OUT}  ${mb(RENDERER_OUT)}`);
console.log(`server    ${SERVER_OUT}  ${mb(SERVER_OUT)}`);
console.log(`main      ${MAIN_OUT}  ${mb(MAIN_OUT)}`);
console.log(`preload   ${PRELOAD_OUT}  ${mb(PRELOAD_OUT)}`);
