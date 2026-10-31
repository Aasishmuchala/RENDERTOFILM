// @runway/bay/runway — the Runway platform, as the desktop app sees it.
//
// - runwayAuth() puts the guard (guard.js) in front of everything, signs each
//   request that passes in as the one local owner, and serves the app's own
//   files under /__mock/* (stills, the clip, uploads, storage).
// - RunwayClient (tasks.js) hands each task to the owner's provider. Tasks are
//   kept in memory and in <data>/storage/tasks.json, so a restarted API process
//   still answers for them and picks up what was running.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createGuard, currentToken, guardEnabled, readBoot } from './guard.js';
import { ASSETS_DIR, UPLOADS_DIR } from './paths.js';
import { assertSafeKey, isSealedKey, storagePath } from './storage.js';
import { RunwayClient, bootTasks } from './tasks.js';
import * as realgen from '../realgen/index.js';

export {
  RunwayClient,
  __mockFailNext,
  __mockResetTasks,
  lifestylePlanAnswer,
  lookFromPrompt,
} from './tasks.js';

export const SIGN_IN_REQUIRED = 'sign_in_required';

// ---------------------------------------------------------------- errors

export class RunwayApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'RunwayApiError';
    this.status = status;
    this.body = body;
  }
}

export class RunwayBrokerError extends RunwayApiError {
  constructor(message, { code, consentUrl, status = 403, body } = {}) {
    super(message, { status, body });
    this.name = 'RunwayBrokerError';
    this.code = code;
    this.consentUrl = consentUrl;
  }
}

export class RunwayCreditError extends Error {
  constructor(message, { reason } = {}) {
    super(message);
    this.name = 'RunwayCreditError';
    this.reason = reason;
  }
}

export class RunwayAuthError extends Error {
  constructor(message, { permissionDenied = false, reason } = {}) {
    super(message);
    this.name = 'RunwayAuthError';
    this.permissionDenied = permissionDenied;
    this.reason = reason;
  }
}

export class RunwayTaskError extends RunwayApiError {
  constructor(message, { status, body, issues = [] } = {}) {
    super(message, { status, body });
    this.name = 'RunwayTaskError';
    this.status = status;
    this.body = body;
    this.issues = issues;
  }
}

export function describeRunwayFailure(err) {
  const message = err && typeof err.message === 'string' && err.message;
  return { message: message || 'Runway could not run this.' };
}

export function parseRunwayApiErrorReason(body) {
  const nested = body?.error?.message;
  if (typeof nested === 'string') return nested;
  return typeof body?.message === 'string' ? body.message : undefined;
}

export function runwayCreditsRequired(err) {
  return { credits: typeof err?.credits === 'number' ? err.credits : 0 };
}

// ---------------------------------------------------------------- catalogue

export function listTaskTypes(_filter = {}) {
  return [];
}

const RATIOS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'];

/** The model ratio closest to width:height (compared in log space). */
export function snapAspectRatio(width, height, _alias) {
  if (!(width > 0) || !(height > 0)) return undefined;
  const target = Math.log(width / height);
  let best;
  let bestDist = Infinity;
  for (const r of RATIOS) {
    const [w, h] = r.split(':').map(Number);
    const d = Math.abs(Math.log(w / h) - target);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------- identity

function osUsername() {
  try {
    return os.userInfo().username || 'you';
  } catch {
    return 'you'; // userInfo throws for a uid with no passwd entry
  }
}

const USERNAME = osUsername();

/**
 * The one local owner. `id: 'local'` hashes to the owner key
 * 29b7dddadef2570e181d507c. The plain harness keeps the id its stored library
 * is keyed by (owner 1e8e02632378790840f76e9e), so that library stays its own.
 */
export const LOCAL_PROFILE = {
  id: guardEnabled() ? 'local' : 'user_mock_1',
  email: `${USERNAME}@local`,
  firstName: USERNAME,
};

/** The owner key src/library.ts's ownerFromRequest computes for this profile. */
export const LOCAL_OWNER = createHash('sha256').update(`id:${LOCAL_PROFILE.id}`).digest('hex').slice(0, 24);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const LOCAL_TOKEN = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  id: LOCAL_PROFILE.id,
  email: LOCAL_PROFILE.email,
})}.`;

const CLIENT = Symbol.for('runway.mock.client');
const GATED = Symbol.for('runway.mock.gated');

export function getRunwayClient(req) {
  return req?.[CLIENT];
}

export function getRunwayToken(req) {
  return req?.[CLIENT] ? LOCAL_TOKEN : undefined;
}

export function getBayViewer(req) {
  return req?.[GATED] ? 'member' : undefined;
}

export function getRunwaySignInUrl(_req) {
  return '/#settings';
}

export function runwayAuthGated(req) {
  return req?.[GATED] === true;
}

let loopbackOnly = false;

/**
 * src/index.ts calls `app.listen(port)` with no host, which would answer the
 * whole network. Done on Node's own class: there can be two copies of Koa (the
 * root's and desktop/'s), and only one of `http`.
 */
function bindLoopbackOnly() {
  if (loopbackOnly) return;
  loopbackOnly = true;
  const { listen } = http.Server.prototype;
  http.Server.prototype.listen = function (port, ...rest) {
    return typeof port === 'number' && typeof rest[0] !== 'string'
      ? listen.call(this, port, '127.0.0.1', ...rest)
      : listen.call(this, port, ...rest);
  };
}

export function runwayAuth(_options = {}) {
  readBoot();
  bootTasks();
  const guarded = guardEnabled();
  if (guarded) bindLoopbackOnly();
  const port = () => Number(process.env.PORT ?? 3000);
  const door = guarded
    ? createGuard({ token: currentToken, origin: () => `http://127.0.0.1:${port()}`, port })
    : (_ctx, next) => next();
  return (ctx, next) =>
    door(ctx, async () => {
      if (ctx.path.startsWith('/__mock/')) {
        await serveMock(ctx, { cors: !guarded });
        return;
      }
      const client = new RunwayClient(LOCAL_OWNER);
      await client.ready();
      ctx.req[GATED] = true;
      ctx.req[CLIENT] = client;
      ctx.state.runway = client;
      ctx.state.viewer = 'member';
      await next();
    });
}

export function requireRunwayUser() {
  return async (_ctx, next) => next();
}

// ---------------------------------------------------------------- mock files

const TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
};

/**
 * Serves /__mock/*: assets, uploads, storage. `cors` is the plain harness only,
 * whose client runs on Vite's port; with the guard up the window is same-origin,
 * and `*` would let any website read what a no-cors load cannot.
 */
async function serveMock(ctx, { cors }) {
  if (cors) {
    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.set('Access-Control-Allow-Headers', 'Range, Content-Type');
    ctx.set('Access-Control-Allow-Methods', 'GET, HEAD, PUT, OPTIONS');
    ctx.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  }
  if (ctx.method === 'OPTIONS') {
    ctx.status = 204;
    return;
  }
  const rest = ctx.path.slice('/__mock/'.length);
  if (rest === 'sign-in') {
    ctx.redirect('/#settings');
    return;
  }
  if (rest === 'realgen/status') {
    ctx.type = 'json';
    ctx.body = realgen.status();
    return;
  }
  const [area, ...parts] = rest.split('/');
  let file;
  try {
    const name = decodeURIComponent(parts.join('/'));
    if (area === 'assets') file = inside(ASSETS_DIR, name);
    else if (area === 'uploads') file = inside(UPLOADS_DIR, name);
    // Sealed documents never leave over HTTP: the client only ever gets `publicView`.
    else if (area === 'storage' && !isSealedKey(name)) file = storagePath(name);
  } catch {
    file = undefined;
  }
  if (!file) {
    ctx.status = 404;
    ctx.body = { error: 'Not found' };
    return;
  }
  if (area === 'storage' && ctx.method === 'PUT') {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const chunks = [];
    for await (const c of ctx.req) chunks.push(c);
    await fsp.writeFile(file, Buffer.concat(chunks));
    ctx.status = 200;
    ctx.body = '';
    return;
  }
  await sendFile(ctx, file);
}

function inside(dir, name) {
  assertSafeKey(name);
  const file = path.resolve(dir, name);
  if (!file.startsWith(dir + path.sep)) throw new Error('outside');
  return file;
}

/** GET/HEAD a file, honouring a single `bytes=a-b` Range. */
async function sendFile(ctx, file) {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    stat = undefined;
  }
  if (!stat?.isFile()) {
    ctx.status = 404;
    ctx.body = { error: 'Not found' };
    return;
  }
  ctx.type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  ctx.set('Accept-Ranges', 'bytes');
  ctx.set('Cache-Control', 'public, max-age=60');
  if (ctx.query.download !== undefined) ctx.attachment(path.basename(file));
  const size = stat.size;
  let start = 0;
  let end = size - 1;
  const m = /^bytes=(\d*)-(\d*)$/.exec(ctx.get('Range'));
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - Number(m[2]));
    }
    if (start > end || start >= size) {
      ctx.status = 416;
      ctx.set('Content-Range', `bytes */${size}`);
      ctx.body = '';
      return;
    }
    ctx.status = 206;
    ctx.set('Content-Range', `bytes ${start}-${end}/${size}`);
  } else {
    ctx.status = 200;
  }
  ctx.length = end - start + 1;
  if (ctx.method === 'HEAD') return;
  ctx.body = fs.createReadStream(file, { start, end });
}
