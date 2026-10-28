import Router from '@koa/router';
import { requireRunwayUser } from '@runway/bay/runway';
import type Koa from 'koa';

import { randomUUID } from 'node:crypto';

import { readConnections, updateConnections, updateServer } from './connections.ts';
import { compositeUrl, ensureComposite, maskPrefix, renderKeyFor } from './composite.ts';
import { editOwns, readEdit } from './edits.ts';
import { ownerFromRequest, readLibrary } from './library.ts';
import {
  authorizationUrl,
  createPkce,
  discoverAuthServer,
  exchangeCode,
  registerClient,
} from './mcp.ts';
import { putObject } from './storage.ts';
import { thumbUrl, viewUrl } from './thumbs.ts';

/**
 * The one boundary literal for raw routes. `mountApi`'s router prefix, the
 * `isApiPath` predicate below and the JSON gate all read it, so renaming the
 * prefix (or pointing it at `/v1`) moves the guard with it instead of leaving
 * a predicate that silently stops matching.
 */
export const API_PREFIX = '/api';

// Raw (non-tRPC) Koa routes live here, under `/api` — that prefix is already
// proxied by the dev server (see `vite.config.ts`), so a route added here
// works under `bay dev` and Studio preview with no extra config. `index.ts`
// must mount this before the static fallback (`mountStaticFallback` below),
// whose production catch-all answers anything that reaches it. They sit in
// their own module rather than in `routes.ts` because `bay add webapp-runway-api` keeps an app's existing
// `routes.ts` as-is, and the rewritten `index.ts` has to import `mountApi`
// from a file the template always owns.
//
// There is no body-parsing middleware: the tRPC adapter reads `ctx.req`
// itself, so a global parser would leave it nothing to read. Use
// `readJsonBody(ctx)` from `./api-body.ts` instead.
/** Each try at handing a render to Runway; two tries stay inside the gateway's patience. */
const UPLOAD_ATTEMPT_MS = 40_000;

/** A Runway upload failure worth one more try: a dropped connection or a 5xx. */
function isTransientUploadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TypeError' || /fetch failed|ECONNRESET|socket hang up/i.test(err.message)) return true;
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number') return status >= 500;
  return /failed \(5\d\d\)/.test(err.message);
}

export function isApiPath(path: string): boolean {
  // Normalize the way the router does before comparing. `@koa/router` matches
  // case-insensitively and treats a trailing slash as optional, so a literal
  // comparison would miss `/API/echo` and `/api/echo/` — requests the router
  // still answers, and whose unmatched siblings would otherwise slip past the
  // gate and come back as the SPA shell with a 200.
  const normalized = path.toLowerCase().replace(/\/+$/, '');
  const prefix = API_PREFIX.toLowerCase();
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

/**
 * Whether some handler already owns the response. An explicit status is an
 * answer even with no body (a 204 delete, a 202 accepted); only an untouched
 * Koa 404 is an unanswered request.
 *
 * Exported so `mountStatic`'s catch-all in `routes.ts` shares this one
 * definition of the middleware contract instead of inlining its own copy.
 */
export function isAnswered(ctx: Koa.Context): boolean {
  return ctx.body != null || ctx.status !== 404;
}

/** Requests the static middleware answered — see `mountStaticFallback`. */
const staticAnswers = new WeakSet<Koa.Context>();

/**
 * Mounts the static middleware with a provenance marker wrapped around it:
 * whatever it answers (a file out of `dist/`, or the SPA shell from its
 * catch-all) is recorded, which is what lets the gate below tell the SPA
 * fallback apart from a real handler's answer without reaching into
 * `routes.ts` — a file `bay add webapp-runway-api` preserves as the app wrote
 * it.
 *
 * It takes the mount as an argument rather than being a separate `app.use`
 * line on purpose: a bare marker records everything mounted below it, so a
 * router slipped between the marker and `mountStatic` would have its own HTML
 * answers (an OAuth consent page, a rendered preview) mistaken for the shell
 * and rewritten into a JSON 404. Here the two are inseparable, and "mount
 * your router before the static fallback" is again one line to be above.
 */
export function mountStaticFallback(app: Koa, mount: (app: Koa) => void) {
  // `mount` registers its middleware with `app.use`, so collect those calls
  // instead of letting them reach the real app: they have to go on after the
  // marker, and nothing else may.
  const staticMiddleware: Koa.Middleware[] = [];
  const collector = {
    use(middleware: Koa.Middleware) {
      staticMiddleware.push(middleware);
      return collector;
    },
  };
  mount(collector as unknown as Koa);

  app.use(async (ctx, next) => {
    const answeredBefore = isAnswered(ctx);
    await next();
    if (!answeredBefore && isAnswered(ctx)) staticAnswers.add(ctx);
  });
  for (const middleware of staticMiddleware) app.use(middleware);
}

export function mountApi(app: Koa) {
  const api = new Router({ prefix: API_PREFIX });

  // Uncomment (and add the `readJsonBody` import from './api-body.ts'):
  // api.post('/echo', async (ctx) => {
  //   const body = await readJsonBody<{ message: string }>(ctx);
  //   ctx.body = { echoed: body.message };
  // });
  //
  // A raw route that spends the visitor's Runway credits goes behind
  // `requireRunwayUser()` (from '@runway/bay/runway'), the raw-route twin of
  // `signedInProcedure` in src/trpc.ts — without a session it answers
  // `401 { error: 'sign_in_required', reauth }`, which `<SignInPrompt>` on
  // the client turns into a popup sign-in:
  // api.post('/generate', requireRunwayUser(), async (ctx) => {
  //   const body = await readJsonBody<{ prompt: string }>(ctx);
  //   const task = await ctx.state.runway!.runTask('gemini_image', {
  //     text_prompt: body.prompt,
  //   });
  //   ctx.body = { artifacts: task.artifacts };
  // });
  //
  // Let a Runway call's error propagate, or rethrow what you don't handle
  // (wrapped as a `cause` is fine): the gate answers a visitor who hasn't
  // allowed this app yet with the consent page (see `apiJsonGate`). Never
  // answer them `{ error: err.message }`.

  // Sign in to an MCP server (Higgsfield, or one the visitor added) with
  // OAuth: `start` registers this app with the server's sign-in service if
  // needed and sends the popup there; `callback` trades the code for tokens,
  // stores them in the visitor's own `connections/` document and tells the
  // Settings page (the popup's opener) it is done.
  api.get('/mcp/oauth/start', async (ctx) => {
    const owner = await ownerFromRequest(ctx.req);
    // `return`: a bare `ctx.throw` doesn't narrow `owner` or `server` for TypeScript.
    if (!owner) return ctx.throw(401, 'Sign in to Runway first, so your connections have somewhere to live.');
    const id = String(ctx.query['server'] ?? '');
    const server = (await readConnections(owner).then((d) => d.servers)).find((s) => s.id === id);
    if (!server) return ctx.throw(404, 'That MCP server is no longer in your settings.');
    const redirectUri = `${(process.env['BAY_APP_URL'] ?? ctx.origin).replace(/\/+$/, '')}${API_PREFIX}/mcp/oauth/callback`;
    try {
      const meta = await discoverAuthServer(server.url);
      // Reuse the registration while the redirect URI and sign-in service match.
      const reuse =
        server.auth.kind === 'oauth' &&
        server.auth.redirectUri === redirectUri &&
        server.auth.meta.token_endpoint === meta.token_endpoint
          ? server.auth
          : undefined;
      const client = reuse ?? { ...(await registerClient(meta, redirectUri)), redirectUri };
      const pkce = createPkce();
      await updateConnections(owner, (doc) => ({
        ...doc,
        pending: [...doc.pending, { state: pkce.state, verifier: pkce.verifier, serverId: id, createdAt: Date.now() }],
        servers: doc.servers.map((s) =>
          s.id === id
            ? {
                ...s,
                auth: {
                  kind: 'oauth' as const,
                  clientId: client.clientId,
                  clientSecret: client.clientSecret,
                  redirectUri,
                  meta,
                  tokens: s.auth.kind === 'oauth' ? s.auth.tokens : undefined,
                },
              }
            : s
        ),
      }));
      ctx.redirect(
        authorizationUrl({
          meta,
          clientId: client.clientId,
          redirectUri,
          challenge: pkce.challenge,
          state: pkce.state,
          resource: server.url,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in could not start.';
      await updateServer(owner, id, (s) => ({ ...s, lastError: message })).catch(() => undefined);
      ctx.type = 'text/html';
      ctx.body = oauthDonePage(false, message);
    }
  });

  api.get('/mcp/oauth/callback', async (ctx) => {
    const owner = await ownerFromRequest(ctx.req);
    const state = String(ctx.query['state'] ?? '');
    const code = String(ctx.query['code'] ?? '');
    const denied = ctx.query['error'] ? String(ctx.query['error_description'] ?? ctx.query['error']) : '';
    ctx.type = 'text/html';
    if (!owner) {
      ctx.body = oauthDonePage(false, 'Your Runway session ended during sign-in. Sign in to Runway and try again.');
      return;
    }
    const doc = await readConnections(owner);
    const pending = doc.pending.find((p) => p.state === state);
    const server = pending && doc.servers.find((s) => s.id === pending.serverId);
    if (!pending || !server || server.auth.kind !== 'oauth') {
      ctx.body = oauthDonePage(false, 'This sign-in link has expired. Start it again from Settings.');
      return;
    }
    const auth = server.auth;
    const dropPending = (d: typeof doc) => ({ ...d, pending: d.pending.filter((p) => p.state !== state) });
    if (denied || !code) {
      await updateConnections(owner, (d) => dropPending(d));
      ctx.body = oauthDonePage(false, denied || 'Sign-in was cancelled.');
      return;
    }
    try {
      const tokens = await exchangeCode({
        tokenEndpoint: auth.meta.token_endpoint,
        code,
        verifier: pending.verifier,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        redirectUri: auth.redirectUri,
        resource: server.url,
      });
      await updateConnections(owner, (d) => ({
        ...dropPending(d),
        servers: d.servers.map((s) =>
          s.id === server.id && s.auth.kind === 'oauth'
            ? { ...s, auth: { ...s.auth, tokens }, connectedAt: new Date().toISOString(), lastError: undefined }
            : s
        ),
      }));
      ctx.body = oauthDonePage(true, `Signed in to ${server.name}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed.';
      await updateConnections(owner, (d) => ({
        ...dropPending(d),
        servers: d.servers.map((s) => (s.id === server.id ? { ...s, lastError: message } : s)),
      }));
      ctx.body = oauthDonePage(false, message);
    }
  });

  // Upload a render (raw image bytes in the body) as an ephemeral Runway
  // asset, so `createShot` can pass it to the model as a hosted reference
  // URL. The client downscales to a JPEG first, so 25 MB is generous.
  api.post('/upload', requireRunwayUser(), async (ctx) => {
    const type = ctx.request.type.trim().toLowerCase();
    if (!type.startsWith('image/')) {
      ctx.throw(415, 'Upload a PNG, JPEG or WebP image.');
    }
    const limit = 25 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of ctx.req) {
      const buf: Buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > limit) ctx.throw(413, 'That image is over 25 MB.');
      chunks.push(buf);
    }
    if (total === 0) ctx.throw(400, 'The upload was empty.');
    const ext = type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const bytes = Buffer.concat(chunks);
    // Runway's upload occasionally stalls; give each try a deadline and retry
    // once, so the visitor gets an answer well before the gateway gives up.
    for (let attempt = 1; ; attempt++) {
      try {
        const { url } = await ctx.state.runway!.uploadAsset(bytes, {
          filename: `render.${ext}`,
          signal: AbortSignal.timeout(UPLOAD_ATTEMPT_MS),
        });
        ctx.body = { url };
        return;
      } catch (err) {
        const stalled = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        if (attempt < 2 && (stalled || isTransientUploadError(err))) continue;
        if (!stalled && !isTransientUploadError(err)) throw err;
        console.error('[upload] Runway upload did not finish', err);
        ctx.status = 504;
        ctx.body = { error: 'Runway is slow to accept uploads right now. Try again in a moment.' };
        return;
      }
    }
  });

  // Store the area marked on a render (a black-and-white PNG, white = may
  // change) under the visitor's own mask prefix; `createShot` takes the key.
  api.post('/mask', requireRunwayUser(), async (ctx) => {
    if (ctx.request.type.trim().toLowerCase() !== 'image/png') {
      ctx.throw(415, 'The marked area must be sent as a PNG.');
    }
    const owner = await ownerFromRequest(ctx.req);
    if (!owner) ctx.throw(401, 'Sign in to Runway to mark an area.');
    const limit = 10 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of ctx.req) {
      const buf: Buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > limit) ctx.throw(413, 'The marked area is too large to save.');
      chunks.push(buf);
    }
    if (total === 0) ctx.throw(400, 'The marked area was empty.');
    const key = `${maskPrefix(owner!)}${randomUUID()}.png`;
    await putObject(key, Buffer.concat(chunks), { contentType: 'image/png' });
    ctx.body = { key };
  });

  // Keep the render a marked edit is made from (the JPEG sent to /upload)
  // under the visitor's own prefix: the composite rebuilds the untouched area
  // from it, long after the hosted upload has expired.
  api.post('/render-copy', requireRunwayUser(), async (ctx) => {
    const type = ctx.request.type.trim().toLowerCase();
    if (type !== 'image/jpeg' && type !== 'image/png' && type !== 'image/webp') {
      ctx.throw(415, 'Upload a PNG, JPEG or WebP image.');
    }
    const owner = await ownerFromRequest(ctx.req);
    if (!owner) ctx.throw(401, 'Sign in to Runway to mark an area.');
    const limit = 25 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of ctx.req) {
      const buf: Buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > limit) ctx.throw(413, 'That image is over 25 MB.');
      chunks.push(buf);
    }
    if (total === 0) ctx.throw(400, 'The upload was empty.');
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    const key = renderKeyFor(owner!, randomUUID(), ext);
    await putObject(key, Buffer.concat(chunks), { contentType: type });
    ctx.body = { key };
  });

  // A stable URL for one of the visitor's stills or clips. The media stays in
  // their Runway account; this checks it is theirs and 302s to a freshly
  // signed artifact URL, so the bytes go Runway -> browser (seeking included)
  // and nothing in the page expires.
  api.get('/library/:kind/:id', requireRunwayUser(), async (ctx) => {
    const { kind, id } = ctx.params;
    const owner = await ownerFromRequest(ctx.req);
    // A cut, its poster and its download all ask for the same file within
    // seconds: answer repeats from memory instead of re-reading the library
    // and asking Runway again.
    // `?thumb` asks for a small copy of a still, for grids and pickers;
    // `?view` for a full-resolution copy kept in the app's storage, for the
    // big screen. Without either, the original Runway file (downloads).
    const thumb = kind === 'still' && ctx.query['thumb'] !== undefined;
    const view = kind === 'still' && !thumb && ctx.query['view'] !== undefined;
    const variant = thumb ? ':thumb' : view ? ':view' : '';
    const cacheKey = owner ? `${owner}:${kind}:${id}${variant}` : null;
    const hit = cacheKey ? signedUrls.get(cacheKey) : undefined;
    if (hit && hit.exp > Date.now()) {
      ctx.set('Cache-Control', 'private, max-age=300');
      ctx.redirect(hit.url);
      return;
    }
    const lib = owner && kind !== 'edit' ? await readLibrary(owner) : null;
    const still = kind === 'still' ? lib?.stills.find((s) => s.id === id) : undefined;
    const owned =
      kind === 'still'
        ? still !== undefined
        : kind === 'clip'
          ? lib?.clips.some((c) => c.id === id)
          : kind === 'edit' && owner
            ? editOwns(await readEdit(owner), id!)
            : false;
    const snap = owned ? await ctx.state.runway!.taskSnapshot(id!) : null;
    if (!snap?.url) {
      ctx.status = 404;
      ctx.body = { error: 'That file is not available.' };
      return;
    }
    // A marked edit is served as its composite, never the raw result.
    let url = snap.url;
    if (still?.maskKey) {
      try {
        url = await compositeUrl(await ensureComposite(owner!, still, snap.url));
      } catch (err) {
        console.warn('[composite]', id, err);
        ctx.status = 404;
        ctx.body = { error: 'That file is not available.' };
        return;
      }
    }
    let remember = true;
    if (thumb || view) {
      try {
        url = await (thumb ? thumbUrl : viewUrl)(owner!, id!, url);
      } catch (err) {
        // The original file is tried instead. Not remembered, so the next
        // request makes the copy again.
        console.warn(thumb ? '[thumb]' : '[view]', id, err);
        remember = false;
      }
    }
    if (cacheKey && remember) rememberSignedUrl(cacheKey, url);
    ctx.set('Cache-Control', 'private, max-age=300');
    ctx.redirect(url);
  });

  // The gate wraps `await next()` rather than terminating, so middleware you
  // mount after `mountApi(app)` (an upload mount, an SSE handler, `bay add
  // agent`'s router) still sees `/api` requests — and its answer is final.
  app.use(apiJsonGate(api));
  app.use(api.routes());
}

/**
 * Keeps `/api` JSON-only: an unmatched or wrong-method API request comes back
 * as a JSON 404/405 instead of the SPA shell with a 200 (which makes a
 * caller's `res.json()` choke on `<!doctype html>` and an uptime check report
 * a healthy route that does not exist).
 *
 * It lives here, not in `mountStatic`, because `bay add webapp-runway-api`
 * preserves an app's existing `src/routes.ts` — a guard there would be absent
 * from every app scaffolded before it was written, while this file is always
 * the template's own.
 *
 * It decides 405-vs-404 from `api`'s own route table only, and only once
 * nothing else has answered, so a downstream handler's own status is never
 * second-guessed (unlike the router's own `allowedMethods` middleware, which
 * rewrites a deliberate 404 into a 405 and an unusual-method probe into a
 * `501 Not Implemented`).
 *
 * A thrown error is the chain's other exit, and Koa's default handler answers
 * it as `text/plain` — so the gate catches it too: `readJsonBody`'s own
 * 415/413/400 and an unexpected 500 alike come back as JSON, or a caller that
 * always calls `res.json()` still chokes on exactly the class of response
 * this gate exists to eliminate.
 *
 * One refusal gets its own answer: a visitor who hasn't allowed this app to
 * use their Runway account (`RunwayBrokerError` with `code: 'grant_denied'`,
 * on a brokered workspace) gets `403 { error: 'consent_required', consent,
 * message }`, which `<ConsentPrompt>` (src/client/ui/) reads, instead of a
 * bare `Forbidden` the visitor can do nothing with. It is answered here
 * rather than left to `runwayAuth()`, which picks JSON or a redirect from
 * fetch metadata that a non-browser caller doesn't send.
 */
function apiJsonGate(api: Router): Koa.Middleware {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      if (!isApiPath(ctx.path) || ctx.headerSent || !ctx.writable) throw err;
      const consent = consentUrlFrom(err);
      if (consent) answerConsentRequired(ctx, consent);
      else answerErrorAsJson(ctx, err);
      return;
    }
    if (!isApiPath(ctx.path)) return;
    // Same exit as the catch branch: once the response has started, every
    // answer below is unwritable — `clearResponseHeaders` calls
    // `res.removeHeader()` on flushed headers and throws
    // ERR_HTTP_HEADERS_SENT. A handler that streamed raw bytes with
    // `ctx.res.write()` without setting `ctx.status` looks unanswered here.
    if (ctx.headerSent || !ctx.writable) return;

    // Exactly two responses get rewritten: a request nothing answered, and the
    // SPA shell answering an API path. The shell is recognised by provenance
    // (`mountStaticFallback` records what the static middleware produced), not
    // by "HTML from a path this router doesn't own" — otherwise a later /api
    // mount that deliberately answers HTML (an OAuth consent page, a rendered
    // preview) would be clobbered into a JSON 404.
    const spaFallback = staticAnswers.has(ctx) && ctx.response.is('html');
    if (isAnswered(ctx) && !spaFallback) return;

    const matched = api.match(ctx.path, ctx.method);
    const allowed = [
      ...new Set(matched.path.flatMap((layer) => layer.methods)),
    ];
    if (allowed.length > 0 && matched.pathAndMethod.length === 0) {
      // Strip first, then re-set `Allow`: the header belongs to the answer the
      // gate is writing, not to the handler it is replacing.
      clearResponseHeaders(ctx);
      ctx.set('Allow', allowed.join(', '));
      if (ctx.method === 'OPTIONS') {
        ctx.status = 200;
        ctx.body = '';
        return;
      }
      ctx.status = 405;
      ctx.body = { error: 'Method Not Allowed' };
      return;
    }

    clearResponseHeaders(ctx);
    ctx.status = 404;
    ctx.body = { error: 'Not Found' };
  };
}

const CONSENT_MESSAGE =
  'This app needs your permission to generate with your Runway account. Allow it, then try again.';

/**
 * The consent page of a `RunwayBrokerError` (`@runway/bay/runway`) with
 * `code: 'grant_denied'` anywhere on `err`'s `cause` chain (at most 8 links),
 * so a route that rethrew it wrapped is still recognised. Matched by name and
 * code rather than `instanceof`: this module imports no SDK code, and the
 * match still holds if the app ends up with two copies of the SDK installed.
 */
function consentUrlFrom(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = err;
  for (let depth = 0; depth < 8; depth++) {
    if (!(current instanceof Error) || seen.has(current)) return undefined;
    seen.add(current);
    const { code, consentUrl } = current as {
      code?: unknown;
      consentUrl?: unknown;
    };
    if (current.name === 'RunwayBrokerError' && code === 'grant_denied') {
      return typeof consentUrl === 'string' && consentUrl !== ''
        ? consentUrl
        : undefined;
    }
    current = current.cause;
  }
  return undefined;
}

function answerConsentRequired(ctx: Koa.Context, consent: string): void {
  clearResponseHeaders(ctx);
  ctx.set('Cache-Control', 'no-store');
  ctx.status = 403;
  ctx.body = { error: 'consent_required', consent, message: CONSENT_MESSAGE };
}

/**
 * Discards every response header already set, the way Koa's `ctx.onerror`
 * does before it writes an error. Every answer the gate synthesizes over a
 * partially-run request goes through this first: a middleware under `/api`
 * that set `Cache-Control: public, max-age=3600` or a `Content-Disposition`
 * attachment filename and then delegated would otherwise have a CDN cache the
 * gate's JSON 404, or a browser save the JSON error as `report.csv`.
 */
function clearResponseHeaders(ctx: Koa.Context): void {
  for (const name of ctx.res.getHeaderNames()) ctx.res.removeHeader(name);
}

/**
 * Mirrors Koa's own error handling, in JSON: keep the error's status, use its
 * message only when it is meant to be public (`http-errors` sets `expose` on
 * the 4xx that `ctx.throw` mints), and fall back to the status' standard
 * reason phrase otherwise. Server errors still reach the app's `error`
 * listeners so they keep being logged.
 *
 * Like Koa's `ctx.onerror`, it discards every response header the failed
 * handler already set before writing the error — otherwise a route that set
 * `Cache-Control: public, max-age=3600` or a `Content-Disposition` attachment
 * filename and then threw would hand a CDN a cacheable 500, or a browser a
 * JSON error saved as `report.csv`. The error's own `headers` (a 405's
 * `Allow`, a 401's `WWW-Authenticate`) are then reapplied, again as Koa does.
 */
function answerErrorAsJson(ctx: Koa.Context, err: unknown): void {
  const e = err as {
    status?: unknown;
    expose?: unknown;
    message?: unknown;
    headers?: unknown;
  };
  const status =
    typeof e.status === 'number' &&
    Number.isInteger(e.status) &&
    e.status >= 400 &&
    e.status <= 599
      ? e.status
      : 500;
  if (status >= 500) ctx.app.emit('error', err, ctx);
  clearResponseHeaders(ctx);
  if (e.headers !== null && typeof e.headers === 'object') {
    ctx.set(e.headers as Record<string, string>);
  }
  ctx.status = status;
  ctx.body = {
    // `ctx.message` is the standard reason phrase for the status just set.
    error:
      e.expose === true && typeof e.message === 'string' && e.message !== ''
        ? e.message
        : ctx.message,
  };
}

/** Signed media URLs this pod handed out recently, kept well inside their expiry. */
const signedUrls = new Map<string, { url: string; exp: number }>();
const SIGNED_URL_TTL_MS = 4 * 60 * 1000;
const MAX_SIGNED_URLS = 1000;

function rememberSignedUrl(key: string, url: string) {
  signedUrls.delete(key);
  signedUrls.set(key, { url, exp: Date.now() + SIGNED_URL_TTL_MS });
  while (signedUrls.size > MAX_SIGNED_URLS) {
    signedUrls.delete(signedUrls.keys().next().value!);
  }
}

/**
 * The page the OAuth popup lands on: it tells the Settings page (same origin)
 * how it went, then closes. Opened without an opener, it just says so.
 */
function oauthDonePage(ok: boolean, message: string): string {
  const safe = message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const payload = JSON.stringify({ type: 'render-to-film:mcp-oauth', ok, message }).replaceAll('<', '\\u003c');
  return `<!doctype html><meta charset="utf-8"><title>${ok ? 'Signed in' : 'Sign-in failed'}</title>
<body style="font:14px system-ui;padding:32px;color:#222">
<p>${safe}</p><p>You can close this window.</p>
<script>
try { window.opener && window.opener.postMessage(${payload}, location.origin); } catch (e) {}
setTimeout(function () { window.close(); }, ${ok ? 600 : 4000});
</script></body>`;
}
