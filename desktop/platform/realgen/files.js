// Real-mode file helpers — the stub's /__mock/* URLs <-> files on disk.
// Pure path arithmetic plus a hash; nothing here touches the disk or the network.
//
// - stripOrigin turns a mock URL on any host/port into its /__mock/... path.
// - localFileForUrl maps that path to the media file the stub would serve for it.
// - refusesInput finds a task input that may not leave this computer.
// - resultPathFor says where a downloaded Higgsfield result is kept and served.
import crypto from 'node:crypto';
import path from 'node:path';

const MOCK = '/__mock/';
const RESULT_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'mp4']);
// bay/guard.js's list of media, plus the photo formats Recreate sends as they are
// (uploadImageFull) and the sound a music bed can be (POST /api/upload-audio).
// `.bin` is a result whose type was not known.
const MEDIA_NAME = /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp|mp4|mov|m4v|webm|mp3|wav|m4a|aac|flac)$/i;
const RESULTS = 'storage/realgen/results/';
// The app's uploads, the simulator's bundled stills, and what the app made: its
// results and a marked edit's composite (src/composite.ts). Compared exactly, so
// a spelling the app never writes is simply not on this list.
const OUTBOUND = ['uploads/', 'assets/', RESULTS, 'storage/composites/'];
// This computer and its own network, as `new URL` writes them.
const LOCAL_HOST =
  /^(localhost|.+\.localhost|127(\.\d+){3}|0\.0\.0\.0|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|169\.254(\.\d+){2}|\[::1?\]|\[::ffff:.+\]|\[f[cd][0-9a-f]{2}:.*\]|\[fe[89ab][0-9a-f]:.*\])\.?$/i;

/** `/__mock/...` for a mock URL on any host or port (query dropped), else null. */
export function stripOrigin(url) {
  if (typeof url !== 'string') return null;
  const text = url.trim();
  if (text.startsWith(MOCK)) return text.split(/[?#]/)[0];
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.pathname.startsWith(MOCK) ? parsed.pathname : null;
}

/**
 * The decoded segments of a /__mock/ path, or null for a spelling the app never
 * writes. Each segment is decoded alone, so an encoded slash stays inside its
 * segment and is refused here instead of climbing a folder further on.
 */
function plainSegments(mockPath) {
  if (!mockPath?.startsWith(MOCK)) return null;
  let segments;
  try {
    segments = mockPath.slice(MOCK.length).split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  return segments.every((s) => s !== '' && s !== '.' && s !== '..' && !/[/\\\0]/.test(s)) ? segments : null;
}

const isMediaPath = (plain) => MEDIA_NAME.test(plain) || (plain.startsWith(RESULTS) && plain.endsWith('.bin'));

/** `name` under `dir`, or a throw when it climbs out (the stub's own check). */
function inside(dir, name) {
  if (name.includes('\0')) throw new Error('outside');
  const file = path.resolve(dir, name);
  if (!file.startsWith(dir + path.sep)) throw new Error('outside');
  return file;
}

/**
 * The media file behind a mock URL, or null for anything else (remote, data:, an
 * unknown area, a path that escapes its folder, a document, the sealed folder).
 * `dirs` is { ASSETS_DIR, UPLOADS_DIR, STORAGE_DIR, storagePath? }; storage goes
 * through the stub's `storagePath` (own argument or `dirs.storagePath`), whose
 * throw means null.
 */
export function localFileForUrl(url, dirs, storagePath = dirs?.storagePath) {
  const segments = plainSegments(stripOrigin(url));
  if (!segments || !isMediaPath(segments.join('/'))) return null;
  const [area, ...parts] = segments;
  const name = parts.join('/');
  // Folded as bay/storage.js's isSealedKey does: a case-insensitive disk reaches it by any spelling.
  if (area === 'storage' && parts[0].normalize('NFKC').toLowerCase() === 'connections') return null;
  try {
    if (area === 'assets') return inside(dirs.ASSETS_DIR, name);
    if (area === 'uploads') return inside(dirs.UPLOADS_DIR, name);
    if (area === 'storage') {
      return typeof storagePath === 'function'
        ? storagePath(name)
        : inside(dirs.STORAGE_DIR, name.replace(/^\/+/, ''));
    }
  } catch {
    return null;
  }
  return null;
}

/** Whether a string is a URL to this computer or its network: a mock path, however cased, a file, a local host. */
function pointsHere(text) {
  if (text.trimStart().toLowerCase().startsWith(MOCK)) return true;
  let parsed;
  try {
    parsed = new URL(text.trim());
  } catch {
    return false;
  }
  if (parsed.protocol === 'file:') return true;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return LOCAL_HOST.test(parsed.hostname) || parsed.pathname.toLowerCase().startsWith(MOCK);
}

function mayLeave(url) {
  const plain = plainSegments(stripOrigin(url))?.join('/');
  return !!plain && isMediaPath(plain) && OUTBOUND.some((folder) => plain.startsWith(folder));
}

/**
 * Whether any URL in a task's options points at something on this computer that
 * is not media from `OUTBOUND`. A remote URL is the provider's or the fetch's
 * business; nothing about it says a local file. Checked once, where every task
 * comes in (bay/tasks.js), so a refusal needs no upload to have started.
 */
export function refusesInput(options) {
  const queue = [options];
  while (queue.length > 0) {
    const value = queue.pop();
    if (typeof value === 'string') {
      if (pointsHere(value) && !mayLeave(value)) return true;
    } else if (value && typeof value === 'object') {
      queue.push(...Object.values(value));
    }
  }
  return false;
}

/** Where a result lives on disk and the /__mock path that serves it. */
export function resultPathFor(taskId, url, STORAGE_DIR) {
  let ext = 'bin';
  let pathname = String(url ?? '').split(/[?#]/)[0];
  try {
    pathname = new URL(url).pathname;
  } catch {
    // not absolute: the split above stands
  }
  const found = path.extname(pathname).slice(1).toLowerCase();
  if (RESULT_EXTS.has(found)) ext = found;
  const name = `${String(taskId).replace(/[^\w.-]/g, '_')}.${ext}`;
  return {
    file: path.join(STORAGE_DIR, 'realgen', 'results', name),
    path: `${MOCK}storage/realgen/results/${name}`,
  };
}

/** Hex SHA-1 of the bytes (the key of an uploaded input). */
export function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}
