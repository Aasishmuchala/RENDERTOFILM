// The desktop server's front door, mounted inside runwayAuth() so src/index.ts
// stays as it is. It is the only thing stopping another process on this machine,
// or a website open in a browser, from calling the app on its loopback port.
//
// Per request, in this order:
//   1. Host must be this server (DNS rebinding) and the peer this machine: 421.
//   2. GET /__desktop/open?t=<token> trades the token for the cookie, once per window.
//   3. GET|HEAD of a media file under /__mock/ with no cross-site marker is
//      served without the cookie: the server's own fetch sends none.
//   4. GET /api/mcp/oauth/callback passes: it lands in the system browser, which
//      has no cookie, and state + PKCE guard it.
//   5. A cross-site request, by Sec-Fetch-Site or Origin: 403.
//   6. The cookie or `Authorization: Bearer` must equal the token: 401.
//
// Answers that pass are finished on the way out: a CSP on HTML, and the live
// origin in every /__mock/ URL (see `rewriteMockUrls`).
import { createHash, timingSafeEqual } from 'node:crypto';

import { SecretsError, devKeyFile, keyFromHex } from './secrets.js';

const COOKIE = 'rtf_desktop';
const OPEN_PATH = '/__desktop/open';
const OAUTH_CALLBACK = '/api/mcp/oauth/callback';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https: blob: data:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

// The files step 3 serves. Documents (library, tasks.json, the realgen status)
// are not among them: their names are what would let a process find the rest.
// Audio is a music bed's preview, and those live in uploads alone.
const MEDIA_PATH =
  /^\/__mock\/(?:(?:assets|uploads|storage)\/.*\.(?:jpe?g|png|webp|gif|avif|mp4|mov|m4v|webm|bin)|uploads\/.*\.(?:mp3|wav|m4a|aac|flac))$/i;

// The two routes whose HTML is the OAuth result page, and its one inline script.
const OAUTH_PAGES = '/api/mcp/oauth/';
const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/g;

// The lookbehind keeps a longer scheme from matching (`xhttp://`).
const MOCK_URL = /(?<![\w+.-])http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/__mock\//g;

// ---------------------------------------------------------------- boot

const isPackaged = () => process.env.RTF_PACKAGED === '1';

let token;
let secretKey;
let devKey;
let bootListening = false;
let bootDone;

/** Settles when main's boot message has been read, or at import from the env. */
export const bootReady = new Promise((resolve) => {
  bootDone = resolve;
});

export function setBoot({ token: nextToken, secretKey: nextKey } = {}) {
  // The key first: a bad one must leave the door shut.
  if (nextKey !== undefined) secretKey = keyFromHex(nextKey);
  if (nextToken) token = String(nextToken);
  bootDone();
}

if (!process.parentPort && (process.env.RTF_DESKTOP_TOKEN || process.env.RTF_SECRET_KEY)) {
  setBoot({ token: process.env.RTF_DESKTOP_TOKEN, secretKey: process.env.RTF_SECRET_KEY || undefined });
}

/** The per-launch token, undefined until boot. */
export function currentToken() {
  return token;
}

function refuseToStart() {
  console.error('Render to Film: no secret key; refusing to start.');
  process.exit(1);
}

/** Boot from main over `process.parentPort`; with no parent port a packaged app needs its key in the env. */
export function readBoot(parentPort = process.parentPort) {
  if (!parentPort) {
    if (isPackaged() && !secretKey) refuseToStart();
    return;
  }
  if (bootListening) return;
  bootListening = true;
  parentPort.on('message', ({ data }) => {
    if (data?.type !== 'boot') return;
    try {
      setBoot(data);
    } catch {
      refuseToStart();
    }
    if (isPackaged() && !secretKey) refuseToStart();
  });
}

/**
 * The key that seals documents: boot's, else the harness's dev key file, which
 * a packaged app never falls back to. Throws `SecretsError` when there is none.
 */
export async function dataKey(dataDir) {
  if (process.parentPort) await bootReady;
  if (secretKey) return secretKey;
  if (isPackaged()) throw new SecretsError('no secret key');
  devKey ??= devKeyFile(dataDir);
  return devKey;
}

/**
 * Whether this run has a door at all. One run does not: the plain harness
 * (`BAY_ENV=development`, no token, not under Electron), whose Vite pair and
 * stress scripts send no token. Anything else fails closed, so a desktop server
 * that lost its token answers 401, not 200.
 */
export function guardEnabled() {
  return process.env.BAY_ENV !== 'development' || !!process.parentPort || isPackaged() || !!token;
}

// ---------------------------------------------------------------- checks

function tokenMatches(given, expected) {
  if (!expected || typeof given !== 'string' || !given) return false;
  const digest = (text) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

function cookieTokens(req) {
  return (req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c.startsWith(`${COOKIE}=`))
    .map((c) => c.slice(COOKIE.length + 1));
}

function bearerToken(req) {
  return /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
}

/** A connection from this machine. No address means the socket has already closed. */
function isLocalPeer(req) {
  const peer = req.socket?.remoteAddress;
  return !peer || peer === '::1' || /^(::ffff:)?127\./.test(peer);
}

function isMediaPath(urlPath) {
  try {
    return MEDIA_PATH.test(decodeURIComponent(urlPath));
  } catch {
    return false;
  }
}

function refuse(ctx, status, error) {
  ctx.status = status;
  ctx.body = { error };
}

// ---------------------------------------------------------------- answers

/**
 * Every local /__mock/ URL now on `origin`. Stored and freshly minted URLs name
 * `http://localhost:<port>`, and the window lives on `http://127.0.0.1:<port>`:
 * a different site, so an <img> would be refused by the CSP and by step 5 even
 * when the port is right. So this rewrites on any difference, not only the port.
 */
export function rewriteMockUrls(body, origin) {
  return body.replace(MOCK_URL, () => `${origin}/__mock/`);
}

const asBuffer = (chunk, encoding) => (typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk));

/**
 * Rewrites a JSON answer at `res`, because tRPC's adapter writes there itself
 * and never sets `ctx.body`. Koa's own answers end up here as well, so this one
 * path covers /trpc and /api. Anything but JSON goes straight through, chunk by
 * chunk, which is what keeps an event stream (text/event-stream) unbuffered.
 */
function rewriteJsonAnswer(res, origin) {
  const { write, end } = res;
  const chunks = [];
  const isJson = () => /^application\/json\b/i.test(String(res.getHeader('content-type') ?? ''));
  res.write = (chunk, encoding, callback) => {
    if (!isJson()) return write.call(res, chunk, encoding, callback);
    chunks.push(asBuffer(chunk, typeof encoding === 'string' ? encoding : undefined));
    (typeof encoding === 'function' ? encoding : callback)?.();
    return true;
  };
  res.end = (chunk, encoding, callback) => {
    const last = typeof chunk === 'function' || chunk == null ? undefined : chunk;
    if (!isJson() || (last === undefined && chunks.length === 0)) return end.call(res, chunk, encoding, callback);
    if (last !== undefined) chunks.push(asBuffer(last, typeof encoding === 'string' ? encoding : undefined));
    const body = rewriteMockUrls(Buffer.concat(chunks).toString('utf8'), origin);
    if (res.hasHeader('content-length')) res.setHeader('content-length', Buffer.byteLength(body));
    const done = [chunk, encoding, callback].find((arg) => typeof arg === 'function');
    return end.call(res, body, 'utf8', done);
  };
}

/**
 * The CSP for an HTML answer. The OAuth result page (oauthDonePage in
 * src/api-routes.ts) is the app's only inline script: it tells its opener how
 * sign-in went, then closes, and its text carries that outcome, so a fixed hash
 * cannot allow it. It is allowed by its own hash, only on those two routes and
 * only as the page's one script: anything injected beside it blocks both.
 */
function cspFor(ctx) {
  if (!ctx.path.startsWith(OAUTH_PAGES) || typeof ctx.body !== 'string') return CSP;
  const scripts = [...ctx.body.matchAll(INLINE_SCRIPT)];
  if (scripts.length !== 1) return CSP;
  const hash = createHash('sha256').update(scripts[0][1]).digest('base64');
  return CSP.replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`);
}

async function pass(ctx, next, origin) {
  // Refuses a no-cors load that slipped past Sec-Fetch-Site in an older browser.
  ctx.set('Cross-Origin-Resource-Policy', 'same-origin');
  ctx.set('X-Content-Type-Options', 'nosniff');
  if (/^\/(trpc|api)(\/|$)/i.test(ctx.path)) rewriteJsonAnswer(ctx.res, origin);
  await next();
  // /api/library answers a 302 to the file, so the URL travels in this header.
  const location = ctx.response.get('Location');
  if (location) ctx.set('Location', rewriteMockUrls(location, origin));
  if (ctx.response.is('html')) ctx.set('Content-Security-Policy', cspFor(ctx));
}

// ---------------------------------------------------------------- guard

export function createGuard({ token: expectedToken, origin: liveOrigin, port }) {
  return async (ctx, next) => {
    const { req } = ctx;
    // The raw header: the app sets `proxy`, so `ctx.host` would read X-Forwarded-Host.
    const host = req.headers.host;
    const hosts = [`127.0.0.1:${port()}`, `localhost:${port()}`, `[::1]:${port()}`];
    if (!hosts.includes(host) || !isLocalPeer(req)) return refuse(ctx, 421, 'wrong_host');
    const origin = `http://${host}`;

    if (ctx.method === 'GET' && ctx.path === OPEN_PATH) {
      const expected = expectedToken();
      if (!tokenMatches(ctx.query.t, expected)) return refuse(ctx, 403, 'bad_token');
      ctx.set('Set-Cookie', `${COOKIE}=${expected}; HttpOnly; SameSite=Strict; Path=/`);
      ctx.set('Cache-Control', 'no-store');
      ctx.redirect('/');
      return undefined;
    }

    const site = ctx.get('Sec-Fetch-Site').toLowerCase();
    const sentOrigin = req.headers.origin;
    const ownOrigin = sentOrigin === undefined || sentOrigin === origin || sentOrigin === liveOrigin();

    if (
      (ctx.method === 'GET' || ctx.method === 'HEAD') &&
      isMediaPath(ctx.path) &&
      (site === '' || site === 'same-origin' || site === 'none') &&
      ownOrigin
    ) {
      return pass(ctx, next, origin);
    }

    if (ctx.method === 'GET' && ctx.path === OAUTH_CALLBACK) return pass(ctx, next, origin);

    if (site === 'cross-site' || site === 'same-site' || !ownOrigin) return refuse(ctx, 403, 'cross_site');

    const expected = expectedToken();
    const allowed =
      cookieTokens(req).some((given) => tokenMatches(given, expected)) || tokenMatches(bearerToken(req), expected);
    if (!allowed) return refuse(ctx, 401, 'desktop_token_required');
    return pass(ctx, next, origin);
  };
}
