import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Plugin, ViteDevServer } from 'vite';

import { parseRequestedExports } from './parse-imports.ts';

/**
 * Resolves an import whose file doesn't exist yet to a skeleton, so writing the
 * importer before the thing it imports doesn't take the whole page down.
 *
 * `apply: 'serve'` keeps a dangling import failing `vite build`. Every stub is
 * recorded to `.bay/stubbed-imports.json`, which Studio reads to tell the agent
 * what it left unwritten. Never `enforce: 'pre'` — Vite's own resolver has to
 * go first, or this intercepts every import in the app.
 */

const VIRTUAL_PREFIX = '\0bay-pending:';
/** Studio's harness reads this path too — `studio-agent/src/pending-imports.ts`. */
const RECORD_FILE = path.join('.bay', 'stubbed-imports.json');
const PENDING_BLOCK_MODULE = '/src/client/ui/PendingBlock.tsx';

/** What Vite would have tried before giving up. */
const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
];

function resolvesOnDisk(importer: string, specifier: string): boolean {
  const base = path.resolve(path.dirname(importer), specifier);
  return RESOLVE_SUFFIXES.some((suffix) => {
    const candidate = `${base}${suffix}`;
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/** Stylesheet imports (`import styles from './X.module.css'`, `import './x.css'`).
 * Vite's CSS pipeline claims any id ending in one of these, so their stub id
 * must not — see `stubId`. */
const STYLE_SPECIFIER = /\.(?:css|scss|sass|less|styl|stylus|pcss|postcss)$/;

/** The stub's virtual id. Ends in `&pending` rather than the specifier so a
 * missing `.module.css` is loaded as the JS stub below and not handed to
 * PostCSS (which would fail with "Unknown word"). */
function stubId(root: string, importer: string, source: string): string {
  return `${VIRTUAL_PREFIX}${path.relative(root, importer)}?s=${source}&pending`;
}

/** A CSS module that hasn't been written yet: every class name resolves to its
 * own key, so `className={styles.card}` renders `class="card"` and the markup
 * stays inspectable until the stylesheet lands. */
function styleStubSource(names: string[], hasDefault: boolean): string {
  const lines = names.map((name) => `export const ${name} = '${name}';`);
  if (hasDefault) {
    lines.push(
      "export default new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : '') });"
    );
  }
  return `${lines.join('\n')}\n`;
}

/** A component per name — most missing imports are components, and a component
 * is a function, so a plain helper still calls. */
function stubSource(
  names: string[],
  hasDefault: boolean,
  hasPendingBlock: boolean
): string {
  const body = hasPendingBlock
    ? `import { PendingBlock } from '${PENDING_BLOCK_MODULE}';\nconst Pending = (props) => PendingBlock(props ?? {});\n`
    : 'const Pending = () => null;\n';
  const named = names.map((name) => `export const ${name} = Pending;`);
  if (hasDefault) named.push('export default Pending;');
  return `${body}${named.join('\n')}\n`;
}

export function bayPendingImports(): Plugin {
  let root = '';
  let server: ViteDevServer | undefined;
  const stubs = new Map<
    string,
    {
      names: string[];
      hasDefault: boolean;
      importerAbs: string;
      specifier: string;
    }
  >();

  function writeRecord(): void {
    const file = path.join(root, RECORD_FILE);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            entries: [...stubs.values()].map((stub) => ({
              specifier: stub.specifier,
              importer: path.relative(root, stub.importerAbs),
            })),
          },
          null,
          2
        )}\n`,
        'utf8'
      );
    } catch {
      // Best-effort — a failed write must not break the dev server.
    }
  }

  /** The importer too, not just the stub — the rewritten specifier lives in
   * the importer's cached transform. */
  function invalidate(id: string, importerAbs: string): void {
    const graph = server?.moduleGraph;
    if (!graph) return;
    const stubMod = graph.getModuleById(id);
    if (stubMod) graph.invalidateModule(stubMod);
    for (const mod of graph.getModulesByFile(importerAbs) ?? []) {
      graph.invalidateModule(mod);
    }
  }

  /** Drop rather than predict: an import stops being missing because the file
   * arrived, was corrected, or went away. Re-resolution sorts out which. */
  function dropStubs(matching: (importerAbs: string) => boolean): void {
    let dropped = false;
    for (const [id, stub] of stubs) {
      if (!matching(stub.importerAbs)) continue;
      invalidate(id, stub.importerAbs);
      stubs.delete(id);
      dropped = true;
    }
    if (!dropped) return;
    writeRecord();
    server?.ws.send({ type: 'full-reload' });
  }

  return {
    name: 'bay:pending-imports',
    apply: 'serve',

    configResolved(config) {
      root = config.root;
    },

    configureServer(devServer) {
      server = devServer;
      stubs.clear();
      writeRecord();
      const srcRoot = path.join(root, 'src');
      // `add` drops everything — a new file may satisfy any importer's stub.
      // `change`/`unlink` matter just as much: fixing a typo'd specifier emits
      // those, never `add`, and a stale entry has the gate demanding a file
      // nothing imports.
      devServer.watcher.on('add', (file) => {
        if (file.startsWith(srcRoot)) dropStubs(() => true);
      });
      for (const event of ['change', 'unlink'] as const) {
        devServer.watcher.on(event, (file) => {
          if (file.startsWith(srcRoot))
            dropStubs((importer) => importer === file);
        });
      }
    },

    resolveId(source, importer) {
      if (!importer || importer.startsWith('\0')) return null;
      if (!source.startsWith('./') && !source.startsWith('../')) return null;
      if (importer.includes('node_modules')) return null;
      if (!importer.startsWith(path.join(root, 'src'))) return null;
      if (resolvesOnDisk(importer, source)) return null;

      let importerSource: string;
      try {
        importerSource = fs.readFileSync(importer, 'utf8');
      } catch {
        return null;
      }

      const requested = parseRequestedExports(importerSource, source);
      if (!requested) return null;

      const id = stubId(root, importer, source);
      stubs.set(id, { ...requested, importerAbs: importer, specifier: source });
      writeRecord();
      return id;
    },

    load(id) {
      const requested = stubs.get(id);
      if (!requested) return null;
      if (STYLE_SPECIFIER.test(requested.specifier)) {
        return styleStubSource(requested.names, requested.hasDefault);
      }
      const hasPendingBlock = fs.existsSync(
        path.join(root, PENDING_BLOCK_MODULE.slice(1))
      );
      return stubSource(requested.names, requested.hasDefault, hasPendingBlock);
    },
  };
}
