import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type Koa from 'koa';
import serve from 'koa-static';

import { AppRouter } from './api.ts';
import { isAnswered, isApiPath } from './api-routes.ts';
import { createContext } from './trpc.ts';
import { createKoaMiddleware } from './vendor/trpc-koa-adapter.ts';

export function mountTrpc(app: Koa) {
  app.use(
    createKoaMiddleware({
      router: AppRouter,
      createContext,
      prefix: '/trpc',
      // Queries arrive as GET; this also accepts the POST the client falls
      // back to for a query input too large for the URL. Mutations are POST
      // either way: tRPC refuses a mutation sent as GET.
      allowMethodOverride: true,
    })
  );
}

/**
 * Finish the served shell with the app's platform identity. The scaffold
 * bakes `<title>` once — at creation, usually still under the placeholder
 * name — and ships no favicon link, so a deployed app's tab says "New App"
 * over the Bay default icon forever, whatever the app is called in the
 * launcher by now. The pod already knows better: the platform injects
 * BAY_APP_TITLE / BAY_APP_NAME / BAY_ORCHESTRATOR_URL on every provision, so
 * the shell is completed here at serve time and a rename or a freshly
 * generated icon reaches the tab on the next deploy with no app-code change.
 * The app keeps the last word: a shell that declares its own icon link gets
 * no second one, and client-side `document.title` writes still win after
 * hydration. The icon endpoint is public (OIDC-exempt) and falls back to the
 * Bay default while an app's icon is still generating, so the link is safe
 * to emit unconditionally.
 *
 * The favicon's origin comes from the REQUEST host when it has the app's own
 * shape (`<name>.<apex>`): the icon route lives on that same apex, resolves
 * the workspace from it, and is reachable by whoever just loaded the page —
 * which the process-wide BAY_ORCHESTRATOR_URL is not on a pooled runtime
 * with per-workspace apexes, nor for a public visitor of an internet-facing
 * app. The env origin stays as the fallback for hosts that aren't the app's
 * own (a custom domain, a local run).
 */
export function applyAppIdentity(html: string, host?: string): string {
  const escaped = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  let out = html;
  const title = process.env['BAY_APP_TITLE'];
  if (title) {
    const tag = `<title>${escaped(title)}</title>`;
    if (/<title>[^<]*<\/title>/.test(out)) {
      out = out.replace(/<title>[^<]*<\/title>/, () => tag);
    } else {
      out = out.replace('</head>', () => `  ${tag}\n  </head>`);
    }
  }
  const name = process.env['BAY_APP_NAME'];
  let origin = (process.env['BAY_ORCHESTRATOR_URL'] ?? '').replace(/\/+$/, '');
  if (name && host != null && host.startsWith(`${name}.`)) {
    origin = `https://${host.slice(name.length + 1)}`;
  }
  const headEnd = out.indexOf('</head>');
  const head = headEnd === -1 ? out : out.slice(0, headEnd);
  if (name && origin && !/<link[^>]+rel=["']?(shortcut )?icon/i.test(head)) {
    const href = `${origin}/public/icons/${encodeURIComponent(name)}?s=192`;
    out = out.replace(
      '</head>',
      () => `  <link rel="icon" type="image/png" href="${href}" />\n  </head>`
    );
  }
  return out;
}

export function mountStatic(app: Koa) {
  if (process.env['NODE_ENV'] !== 'production') return;

  const distDir = path.resolve(import.meta.dirname, '..', 'dist');
  if (!existsSync(path.join(distDir, 'index.html'))) {
    console.warn(
      '[bay] dist/index.html not found — skipping static file serving. Run your build step first.'
    );
    return;
  }

  // A bookmarked `/index.html` must get the same finished shell as `/`:
  // koa-static would serve the raw file (stale title, no favicon), so the
  // path is folded into the fallback below before static can answer it.
  app.use(async (ctx, next) => {
    if (ctx.path === '/index.html' && ['GET', 'HEAD'].includes(ctx.method)) {
      ctx.path = '/';
    }
    await next();
  });

  // Vite content-hashes everything under assets/, so those get a long
  // immutable cache; index.html and everything else must stay no-cache or a
  // deploy never reaches a client that already has the shell cached.
  app.use(
    serve(distDir, {
      index: false,
      maxage: 1000 * 60 * 60 * 24 * 365,
      immutable: true,
      setHeaders: (res, filePath) => {
        if (!path.relative(distDir, filePath).startsWith(`assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  // The JSON gate in `api-routes.ts` runs outside this middleware and owns
  // `/api` end to end, including the shell an older app's own `routes.ts`
  // serves there (`mountStaticFallback`, which wraps this mount, is what
  // tells the gate the answer came from here), so that invariant survives in
  // an app whose `routes.ts` predates it.
  app.use(async (ctx) => {
    // An earlier handler already owns the response — don't answer over it.
    // `isAnswered` is the one definition of that (a status set with no body
    // counts: a 204 delete, a 202 accepted), shared with the /api gate so the
    // two can't drift apart.
    if (isAnswered(ctx)) return;
    // Leave `/api` to the gate: the empty 404 below counts as an answer, so
    // writing it here would silence the gate and hand an API client an empty
    // `text/plain` body instead of its JSON error.
    if (isApiPath(ctx.path)) return;
    if (
      ['GET', 'HEAD'].includes(ctx.method) &&
      ctx.accepts('html') &&
      !ctx.url.includes('.')
    ) {
      ctx.status = 200;
      ctx.type = 'text/html';
      ctx.set('Cache-Control', 'no-cache');
      ctx.body = applyAppIdentity(
        await fs.readFile(path.join(distDir, 'index.html'), 'utf-8'),
        ctx.host
      );
      return;
    }
    // Empty body (not null, which Koa turns into a 204) so the gateway
    // renders its branded 404 page instead of Koa's own `Not Found` text.
    ctx.status = 404;
    ctx.body = '';
  });
}
