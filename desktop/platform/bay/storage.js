// @runway/bay/storage — the app's S3 prefix, simulated as plain files under
// <data>/storage/. Keys map 1:1 to paths below that directory, on every OS, so
// a key has to be a legal Windows path as well as a POSIX one (`assertSafeKey`).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { dataKey } from './guard.js';
import { DATA_DIR, STORAGE_DIR, mockOrigin } from './paths.js';
import { SecretsError, isSealed, open, seal } from './secrets.js';

export const STORAGE_UPLOAD_FAILURE_HINT = 'mock';

/** Documents under these prefixes are sealed on disk (./secrets.js). */
export const SEALED_PREFIXES = ['connections/'];

/**
 * %AppData%\Render to Film\data\storage\ runs to about 70 characters and
 * `writeAtomic` adds 41, and Windows tools stop at 260. The longest key the app
 * writes is 77 (`ai-text/<owner>/ai_<uuid>.json`).
 */
const MAX_KEY_LENGTH = 140;
const MAX_SEGMENT_BYTES = 255;

// `\\` on top of Windows' own list: a separator there and a name here, so the
// same key would be a different path on each OS.
const UNSAFE_CHARS = /[<>:"|?*\\\x00-\x1f]/;
// Windows reserves these with any extension, and before a space (`NUL .txt`).
const RESERVED_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])\s*(\..*)?$/i;

const invalidKey = (key) =>
  Object.assign(new Error(`Invalid storage key: ${key}`), { status: 400, expose: true });

/** Refuses a key that is not one safe path on Windows, macOS and Linux alike. */
export function assertSafeKey(key) {
  const text = String(key);
  const safe =
    text.length <= MAX_KEY_LENGTH &&
    !UNSAFE_CHARS.test(text) &&
    text.split('/').every(
      (segment) =>
        segment !== '' &&
        !/[. ]$/.test(segment) &&
        !RESERVED_NAME.test(segment) &&
        Buffer.byteLength(segment) <= MAX_SEGMENT_BYTES
    );
  if (!safe) throw invalidKey(key);
}

/** The file for a key; refuses an unsafe key and one that climbs out of the storage dir. */
export function storagePath(key) {
  const clean = String(key).replace(/^\/+/, '');
  assertSafeKey(clean);
  const file = path.resolve(STORAGE_DIR, clean);
  if (!file.startsWith(STORAGE_DIR + path.sep)) throw invalidKey(key);
  return file;
}

/**
 * Whether a key is a sealed document. Compared folded, because a case-insensitive
 * disk (macOS, Windows) reaches `connections/` by `CONNECTIONS/` too.
 */
export function isSealedKey(key) {
  const folded = String(key).replace(/^\/+/, '').normalize('NFKC').toLowerCase();
  return SEALED_PREFIXES.some((prefix) => folded.startsWith(prefix));
}

async function writeAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

async function readOrNull(file) {
  try {
    return await fs.readFile(file);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

function unlockFailed(reason) {
  return new SecretsError(`Your saved connections could not be unlocked (${reason}). Nothing was changed.`);
}

/** A sealed key's document: opened, or a plaintext legacy one as is (sealed by its next `update`). */
async function readSealed(buf) {
  let doc;
  try {
    doc = JSON.parse(buf.toString('utf8'));
  } catch {
    // Not the parser's own error: it quotes the text, and this text is a credential file.
    throw unlockFailed('corrupt document');
  }
  if (!isSealed(doc)) return doc;
  try {
    return open(await dataKey(DATA_DIR), doc);
  } catch (err) {
    throw err instanceof SecretsError ? unlockFailed(err.message) : err;
  }
}

/**
 * One JSON document per key. `update` is serialised per key inside this
 * process, which stands in for the real store's re-read-and-retry. Documents
 * under `SEALED_PREFIXES` are sealed on disk; a read that cannot open one
 * throws `SecretsError`, so `update` never runs and the file stays.
 */
export function documentStore({ prefix }) {
  const locks = new Map();
  const fileFor = (key) => storagePath(`${prefix}${key}`);
  const parse = (key, buf) =>
    isSealedKey(`${prefix}${key}`) ? readSealed(buf) : JSON.parse(buf.toString('utf8'));
  const format = async (key, value) =>
    JSON.stringify(isSealedKey(`${prefix}${key}`) ? seal(await dataKey(DATA_DIR), value) : value, null, 2);
  return {
    async get(key) {
      const buf = await readOrNull(fileFor(key));
      return buf ? { value: await parse(key, buf) } : null;
    },
    update(key, fn) {
      const prev = locks.get(key) ?? Promise.resolve();
      const run = prev
        .catch(() => {})
        .then(async () => {
          const buf = await readOrNull(fileFor(key));
          const current = buf ? await parse(key, buf) : undefined;
          const next = await fn(current);
          await writeAtomic(fileFor(key), await format(key, next));
          return next;
        });
      locks.set(key, run);
      return run;
    },
    async delete(key) {
      await fs.rm(fileFor(key), { force: true });
    },
  };
}

export async function putObject(key, body, _opts = {}) {
  await writeAtomic(storagePath(key), typeof body === 'string' ? body : Buffer.from(body));
}

export async function getObject(key) {
  return readOrNull(storagePath(key));
}

export async function deleteObject(key) {
  await fs.rm(storagePath(key), { force: true });
}

/** One level of keys under `prefix`: files as objects, subdirectories as folders. */
export async function list(prefix = '') {
  // A prefix is a folder plus the start of a name: 'a/b' lists 'a', 'a/b/' lists 'a/b'.
  const folder = prefix.slice(0, prefix.lastIndexOf('/') + 1).replace(/\/$/, '');
  const dir = folder ? storagePath(folder) : STORAGE_DIR;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  const base = path.relative(STORAGE_DIR, dir).split(path.sep).filter(Boolean).join('/');
  const join = (name) => (base ? `${base}/${name}` : name);
  return {
    objects: entries
      .filter((e) => e.isFile() && !e.name.endsWith('.tmp') && join(e.name).startsWith(prefix))
      .map((e) => ({ key: join(e.name) })),
    folders: entries
      .filter((e) => e.isDirectory() && join(e.name).startsWith(prefix))
      .map((e) => `${join(e.name)}/`),
  };
}

/**
 * The real helper mints a presigned S3 PUT. The mock answers PUT on
 * /__mock/storage/<key> itself (see runwayAuth's mock router).
 */
export async function presignUpload(key, _opts = {}) {
  storagePath(key);
  return { url: `${mockOrigin()}/__mock/storage/${encodeURI(key)}` };
}

/** `/media/<key>` → 302 to the mock's file server instead of a presigned GET. */
export function mediaRedirect(keyFromCtx) {
  return async (ctx) => {
    const key = keyFromCtx(ctx);
    if (!key) {
      ctx.status = 404;
      ctx.body = { error: 'Not found' };
      return;
    }
    const download = ctx.query.download !== undefined ? '?download' : '';
    ctx.redirect(`/__mock/storage/${encodeURI(key)}${download}`);
  };
}

/** Metadata for a key, or null when it isn't stored. */
export async function headObject(key) {
  try {
    const st = await fs.stat(storagePath(key));
    return st.isFile() ? { size: st.size, lastModified: st.mtime } : null;
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/** The real helper mints a presigned S3 GET; the mock serves the file itself. */
export async function presignGet(key, _opts = {}) {
  storagePath(key);
  return `${mockOrigin()}/__mock/storage/${encodeURI(key)}`;
}
