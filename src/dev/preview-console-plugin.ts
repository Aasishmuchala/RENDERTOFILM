import * as fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * Relays every preview tab's browser errors and stalled page loads to
 * `.bay/preview-console.log`, so an agent can read what only the user's own
 * browser saw (an error thrown there, an import that never finished loading).
 *
 * The reporter is an inline classic script at `head-prepend`: it has no
 * imports, so it runs before any module request and still reports when a
 * dependency never loads. Not under `/__bay` — that prefix is proxied to the
 * API process.
 */

export const ENDPOINT = '/@bay/preview-console';
/** Studio's system prompt names this path too — `studio-agent/src/system-prompt.ts`. */
export const LOG_FILE = path.join('.bay', 'preview-console.log');
/** Under the 64 KB a browser allows for in-flight beacon/keepalive bodies. */
export const BODY_MAX = 32 * 1024;
export const FIELD_MAX = 500;
export const LOG_MAX = 256 * 1024;
export const MISSING_MAX = 10;
const LOADED_MAX = 300;
/** Browsers keep 250 resource-timing entries by default — fewer than a large
 * Vite graph, which would leave later modules out of a stall's loaded list. */
const RESOURCE_BUFFER = 2000;
const REPORTS_MAX = 50;

/** The query and hash of an absolute URL — a signed media URL carries its
 * token there. A stack frame's trailing `:line:col` is kept. */
const URL_QUERY =
  /([a-z][a-z\d+.-]*:\/\/[^\s?#()'"<>]*)[?#][^\s()'"<>]*?((?::\d+){0,2})(?=[\s()'"<>]|$)/gi;

const CLIENT_SCRIPT = `(function () {
  try {
    var endpoint = ${JSON.stringify(ENDPOINT)};
    var sent = 0;
    var queue = [];
    var timer = null;
    var budget = ${BODY_MAX - 1024};
    var bytes = function (value) {
      return new Blob([JSON.stringify(value)]).size;
    };
    var cap = function (value) {
      return String(value).slice(0, ${FIELD_MAX});
    };
    var urlQuery = new RegExp(${JSON.stringify(URL_QUERY.source)}, 'gi');
    var redact = function (value) {
      return String(value).replace(urlQuery, '$1$2');
    };
    try {
      if (performance.setResourceTimingBufferSize) performance.setResourceTimingBufferSize(${RESOURCE_BUFFER});
    } catch (e) {}
    var send = function (batch) {
      var json = JSON.stringify(batch);
      try {
        if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([json], { type: 'text/plain' }))) return;
      } catch (e) {}
      try {
        fetch(endpoint, { method: 'POST', body: json, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(function () {});
      } catch (e) {}
    };
    // Split so no body passes the server's limit, which would drop it whole.
    var flush = function () {
      if (timer) clearTimeout(timer);
      timer = null;
      var batch = [];
      var size = 2;
      for (var i = 0; i < queue.length; i++) {
        var n = bytes(queue[i]) + 1;
        if (batch.length && size + n > budget) {
          send(batch);
          batch = [];
          size = 2;
        }
        batch.push(queue[i]);
        size += n;
      }
      queue = [];
      if (batch.length) send(batch);
    };
    var report = function (entry) {
      if (typeof entry.text === 'string') entry.text = cap(redact(entry.text));
      if (sent >= ${REPORTS_MAX}) return;
      sent++;
      queue.push(entry);
      if (!timer) timer = setTimeout(flush, 500);
    };
    var str = function (value) {
      try {
        if (value instanceof Error) return String(value.stack || value);
        if (typeof value === 'string') return value;
        return JSON.stringify(value);
      } catch (e) {
        return String(value);
      }
    };
    // Without the query or hash: those can carry a token the page strips later.
    report({ kind: 'page', href: cap(location.origin + location.pathname), ua: String(navigator.userAgent).slice(0, 200) });
    // A reload inside the flush delay would otherwise drop what is queued.
    window.addEventListener('pagehide', function () {
      if (queue.length) flush();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && queue.length) flush();
    });
    window.addEventListener('error', function (event) {
      try {
        var target = event.target;
        if (target && target !== window && target.tagName) {
          report({ kind: 'error', text: 'failed to load <' + String(target.tagName).toLowerCase() + '> ' + (target.src || target.href || '') });
          return;
        }
        var where = event.filename ? ' at ' + event.filename + ':' + event.lineno + ':' + event.colno : '';
        var stack = event.error && event.error.stack ? ' ' + String(event.error.stack).slice(0, 500) : '';
        report({ kind: 'error', text: String(event.message) + where + stack });
      } catch (e) {}
    }, true);
    window.addEventListener('unhandledrejection', function (event) {
      try {
        var reason = event.reason;
        var stack = reason && reason.stack ? ' ' + String(reason.stack).slice(0, 500) : '';
        report({ kind: 'rejection', text: String(reason) + stack });
      } catch (e) {}
    });
    var original = console.error;
    console.error = function () {
      var args = arguments;
      original.apply(console, args);
      try {
        var parts = [];
        for (var i = 0; i < args.length; i++) parts.push(str(args[i]));
        report({ kind: 'console', text: parts.join(' ') });
      } catch (e) {}
    };
    setTimeout(function () {
      try {
        if (document.readyState === 'complete') return;
        var loaded = [];
        var size = 0;
        var entries = performance.getEntriesByType('resource');
        for (var i = 0; i < entries.length && loaded.length < ${LOADED_MAX}; i++) {
          var url = new URL(entries[i].name, location.href);
          if (url.origin !== location.origin) continue;
          var item = cap(url.pathname);
          size += bytes(item) + 1;
          if (size > budget - 1024) break;
          loaded.push(item);
        }
        report({ kind: 'stall', loaded: loaded });
      } catch (e) {}
    }, 10000);
  } catch (e) {}
})();`;

export type PreviewReport =
  | { kind: 'page'; href: string; ua: string }
  | { kind: 'error' | 'rejection' | 'console'; text: string }
  | { kind: 'stall'; loaded: string[]; missing?: string[] };

/** C0, DEL and C1 — the same set as the preview bridge's sanitizer. U+0085 NEL
 * is a line break to a reader but not in JavaScript's `\s`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]+/g;

/** The log is read by an agent: app content must not fake a line or structure,
 * and a URL's query must not carry a token into it.
 * Collapsing `\s` also removes U+2028/U+2029, which a reader shows as a break. */
function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(URL_QUERY, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FIELD_MAX);
}

/** Malformed JSON or an entry of unknown shape is dropped, never thrown. */
export function parseReports(raw: string): PreviewReport[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const reports: PreviewReport[] = [];
  for (const entry of parsed.slice(0, REPORTS_MAX)) {
    if (!entry || typeof entry !== 'object') continue;
    const { kind } = entry as { kind?: unknown };
    if (kind === 'page') {
      const { href, ua } = entry as { href?: unknown; ua?: unknown };
      if (typeof href !== 'string') continue;
      reports.push({ kind, href: clean(href), ua: clean(ua) });
    } else if (kind === 'error' || kind === 'rejection' || kind === 'console') {
      const { text } = entry as { text?: unknown };
      if (typeof text !== 'string') continue;
      reports.push({ kind, text: clean(text) });
    } else if (kind === 'stall') {
      const { loaded } = entry as { loaded?: unknown };
      if (!Array.isArray(loaded)) continue;
      reports.push({
        kind,
        loaded: loaded
          .slice(0, LOADED_MAX)
          .filter((url): url is string => typeof url === 'string')
          .map(clean)
          .filter(Boolean),
      });
    }
  }
  return reports;
}

function stripQuery(url: string): string {
  const at = url.indexOf('?');
  return at === -1 ? url : url.slice(0, at);
}

/** The imports of loaded modules that never loaded themselves — what a page
 * whose `load` event never fired is still waiting on. */
export async function findUnfinishedImports(
  server: Pick<ViteDevServer, 'moduleGraph'>,
  loaded: string[]
): Promise<string[]> {
  try {
    const loadedPaths = new Set(loaded.map(stripQuery));
    const missing = new Set<string>();
    for (const loadedPath of loadedPaths) {
      const mod = await server.moduleGraph.getModuleByUrl(loadedPath);
      if (!mod) continue;
      for (const imported of mod.importedModules) {
        if (!imported.url || loadedPaths.has(stripQuery(imported.url)))
          continue;
        missing.add(imported.url);
        if (missing.size >= MISSING_MAX) return [...missing];
      }
    }
    return [...missing];
  } catch {
    return [];
  }
}

/** One line per report, tagged with the host so a reader can tell the user's
 * tab apart from its own local checks. */
export function formatLogLines(
  reports: PreviewReport[],
  host: string,
  now: Date = new Date()
): string[] {
  const time = now.toISOString();
  const from = clean(host) || 'unknown-host';
  return reports.map((report) => {
    let text: string;
    switch (report.kind) {
      case 'page':
        text = `--- page load ${report.href} (${report.ua})`;
        break;
      case 'stall': {
        const missing = report.missing ?? [];
        text = missing.length
          ? `stall: page not loaded after 10s; imports that never finished: ${missing.join(', ')}`
          : 'stall: page not loaded after 10s; no unfinished import found';
        break;
      }
      default:
        text = `${report.kind}: ${report.text}`;
    }
    return `${time} ${from} ${report.kind} ${text}`;
  });
}

/** A third-party page the user has open must not be able to write into a log
 * the agent reads. A browser sends `Origin` on every POST, so a request without
 * one is not the reporter and is refused. */
function isCrossSite(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return true;
  const origin = req.headers.origin;
  if (origin === undefined) return site !== 'same-origin';
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

/** Resolves `null` once the body passes {@link BODY_MAX}. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > BODY_MAX) {
        done = true;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/** Requests run concurrently (the reporter flushes several beacons at once),
 * and a trim's read-then-write would drop another request's append. */
let writes: Promise<void> = Promise.resolve();

function appendCapped(file: string, lines: string[]): Promise<void> {
  const write = writes.then(() => appendNow(file, lines));
  writes = write.catch(() => {});
  return write;
}

async function appendNow(file: string, lines: string[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.appendFile(file, `${lines.join('\n')}\n`, 'utf8');
  const { size } = await fs.promises.stat(file);
  if (size <= LOG_MAX) return;
  const text = await fs.promises.readFile(file, 'utf8');
  const tail = text.slice(Math.floor(text.length / 2));
  const lineStart = tail.indexOf('\n');
  await fs.promises.writeFile(
    file,
    lineStart === -1 ? '' : tail.slice(lineStart + 1),
    'utf8'
  );
}

export function createPreviewConsoleMiddleware(
  server: Pick<ViteDevServer, 'moduleGraph' | 'config'>
) {
  let warned = false;
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ): Promise<void> => {
    if (req.method !== 'POST' || stripQuery(req.url ?? '') !== ENDPOINT) {
      next();
      return;
    }
    if (isCrossSite(req)) {
      res.statusCode = 403;
      res.end();
      req.resume();
      return;
    }
    let raw: string | null;
    try {
      raw = await readBody(req);
    } catch {
      res.statusCode = 400;
      res.end();
      return;
    }
    if (raw === null) {
      res.statusCode = 413;
      res.end();
      req.resume();
      return;
    }
    const reports = parseReports(raw);
    for (const report of reports) {
      if (report.kind === 'stall') {
        report.missing = await findUnfinishedImports(server, report.loaded);
      }
    }
    if (reports.length) {
      try {
        await appendCapped(
          path.join(server.config.root, LOG_FILE),
          formatLogLines(reports, req.headers.host ?? '')
        );
      } catch (err) {
        if (!warned) {
          warned = true;
          server.config.logger.warn(
            `[bay:preview-console] could not write ${LOG_FILE}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
    res.statusCode = 204;
    res.end();
  };
}

/** Vite's own default, which a configured `server.fs.deny` replaces. */
const VITE_DEFAULT_FS_DENY = ['.env', '.env.*', '*.{crt,pem}', '**/.git/**'];

export function bayPreviewConsole(): Plugin {
  return {
    name: 'bay:preview-console',
    apply: 'serve',
    // `.bay/` sits under the Vite root, so without this the dev server would
    // serve the log (and every other `.bay/` file) to anyone who can reach
    // the preview. Vite concatenates this onto the user's own deny list.
    config(userConfig) {
      const userDeny = userConfig.server?.fs?.deny;
      return {
        server: {
          fs: {
            deny: [...(userDeny ? [] : VITE_DEFAULT_FS_DENY), '**/.bay/**'],
          },
        },
      };
    },
    // A post hook, so Vite's own `allowedHosts` check runs first and a
    // DNS-rebound page cannot reach the endpoint.
    configureServer(server) {
      return () => {
        server.middlewares.use(createPreviewConsoleMiddleware(server));
      };
    },
    transformIndexHtml() {
      return [
        { tag: 'script', children: CLIENT_SCRIPT, injectTo: 'head-prepend' },
      ];
    },
  };
}
