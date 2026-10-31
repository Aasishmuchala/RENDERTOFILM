// Real-mode file helpers — the stub's /__mock/* URLs <-> files on disk.
// Pure path arithmetic plus a hash; nothing here touches the disk or the network.
//
// - stripOrigin turns a mock URL on any host/port into its /__mock/... path.
// - localFileForUrl maps that path to the file the stub would serve for it.
// - resultPathFor says where a downloaded Higgsfield result is kept and served.
import crypto from 'node:crypto';
import path from 'node:path';

const MOCK = '/__mock/';
const RESULT_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'mp4']);

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

/** `name` under `dir`, or a throw when it climbs out (the stub's own check). */
function inside(dir, name) {
  if (name.includes('\0')) throw new Error('outside');
  const file = path.resolve(dir, name);
  if (!file.startsWith(dir + path.sep)) throw new Error('outside');
  return file;
}

/**
 * The file behind a mock URL, or null for anything else (remote, data:, an
 * unknown area, a path that escapes its folder). `dirs` is { ASSETS_DIR,
 * UPLOADS_DIR, STORAGE_DIR, storagePath? }; storage goes through the stub's
 * `storagePath` (own argument or `dirs.storagePath`), whose throw means null.
 */
export function localFileForUrl(url, dirs, storagePath = dirs?.storagePath) {
  const mockPath = stripOrigin(url);
  if (!mockPath) return null;
  const [area, ...parts] = mockPath.slice(MOCK.length).split('/');
  let name;
  try {
    name = decodeURIComponent(parts.join('/'));
  } catch {
    return null;
  }
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
