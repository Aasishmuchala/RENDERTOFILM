// Sidecars: optional command-line editors at one pinned version each. The app
// works without them; the user points at one or asks for a download.
//
// - resolve(id): the binary to run, null when there is none.
// - status(id): what is there and whether it is the pinned version. It runs the
//   binary with `--version`, so it is asynchronous.
// - download(id, { onProgress }): fetches the pinned release asset and checks its
//   sha256 before anything is unpacked. A file that does not match is deleted, and
//   a failed download leaves whatever was installed before in place. The one
//   exception is an old copy that can be neither moved nor copied back, and the
//   error says so.
// - setPath(id, file): saves a file the user chose, if it is the pinned version.
// - remove(id): deletes our download and forgets a saved path.
//
// Nothing here uses a shell: every program is run with execFile and an argument
// array. `<data>/sidecars/<id>.json` holds `{ path }` (the user's choice) or
// `{ quarantined: true }` (our copy's macOS flag would not come off).
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

import { writeDurable } from './bay/durable.js';
import { DATA_DIR } from './bay/paths.js';

// One version of each tool, because alpha CLIs rename commands. Every hash below
// matches the release's SHA256SUMS.txt and GitHub's digest for that asset. Windows
// has no CLI-only archive, so its portable zip is pinned; it also holds the
// desktop editor. A null asset reads 'Not available for this platform yet.'.
const PINS = {
  filmcraft: {
    version: '0.15.0',
    cli: 'filmcraft-cli',
    repo: 'storytold/filmcraft',
    assets: {
      'darwin-arm64': {
        name: 'filmcraft-cli-0.15.0-macos-universal.zip',
        sha256: 'e34e2356ff7629b67f2aee092d7a1b7ea5e649f54354d2804909e33e67777512',
      },
      'win32-x64': {
        name: 'filmcraft-0.15.0-windows-x64-portable.zip',
        sha256: 'e0894f28b191ebb63bd7fe1cf1f4761508c45262ea8ba9fd561bc6e9c24d2cd1',
      },
    },
  },
  lightcraft: {
    version: '0.16.0',
    cli: 'lightcraft-cli',
    repo: 'storytold/lightcraft',
    assets: {
      'darwin-arm64': {
        name: 'lightcraft-cli-0.16.0-macos-universal.zip',
        sha256: '64f127f132a1a59074d3d4746cfbd265ed4ad30abc6fa74f15fa3591cce5dc3e',
      },
      'win32-x64': {
        name: 'lightcraft-0.16.0-windows-x64-portable.zip',
        sha256: '5c1f1329594f28f6a4dc44a404b065a4aac656b3b02219b69c740a23141a9403',
      },
    },
  },
};

const BIN_ENV = { filmcraft: 'RTF_FILMCRAFT_BIN', lightcraft: 'RTF_LIGHTCRAFT_BIN' };
const SIDECARS_DIR = path.join(DATA_DIR, 'sidecars');
// macOS scans a new file before its first run: 0.16.0's lightcraft-cli took 4 to 8
// seconds to answer `--version` once, then 50 ms. Too short, and a good download or a
// good chosen file reads as one that did not run.
const VERSION_MS = 30_000;
const CLEAR_FLAG_MS = 5000;
const DOWNLOAD_MS = 10 * 60 * 1000;
const MOVE_TRIES = 8;
const MOVE_WAIT_MS = 250;

const NOT_INSTALLED = 'Not installed.';
const NOT_AVAILABLE = 'Not available for this platform yet.';
const WOULD_NOT_RUN = 'Found this file, but it did not run.';
const NO_PROGRAM = 'There is no program at that path.';
const READY = 'Ready.';
const QUARANTINE_STUCK = 'macOS may still block this file: its quarantine flag could not be cleared.';
const HASH_MISMATCH = 'Download did not match the pinned hash; nothing was installed.';
const BUSY = 'This tool is already downloading.';
const OFFLINE = 'The download failed. Check your connection and try again.';
const TOO_SLOW = 'The download took too long and was stopped. Try it again.';
const BAD_ARCHIVE = 'The download could not be unpacked; nothing was installed.';
const NO_SPACE = 'There is not enough disk space to finish this. Free some space and try again.';
const NOT_PLACED = 'The new copy could not be put in place; nothing was installed. Close anything using this tool and try again.';
const OLD_LOST = 'The new copy could not be put in place and the old one could not be put back. Download it again.';
const NOT_SAVED = 'The tool could not be saved on this computer. Try it again.';
const NOT_REMOVED = 'This tool could not be removed. Close anything using it and try again.';

const QUARANTINE = 'com.apple.quarantine';
// Zip format: the signatures, and the two compression methods release archives use.
const ZIP_END = Buffer.from('PK\x05\x06', 'latin1');
const ZIP_ROW = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const ZIP_TAIL_BYTES = 22 + 0xffff;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;
const FILE_TYPE = 0o170000;
const SYMLINK = 0o120000;
// What Windows answers a rename while something still holds a file inside.
const HELD = ['EPERM', 'EBUSY', 'EACCES'];

let pins = PINS;
let versionMs = VERSION_MS;
// Tools with a download or a removal under way. One at a time per tool: a
// removal sweeps leftover folders, and a download's work folder must not be one.
const busy = new Set();

function pinOf(id) {
  if (!Object.hasOwn(pins, id)) throw new Error('Unknown sidecar.');
  return pins[id];
}

/** This computer's asset, null when the pin has none or no hash for it. */
function assetOf(pin) {
  const asset = pin.assets[`${process.platform}-${process.arch}`];
  return asset?.sha256 ? asset : null;
}

const exeName = (pin) => (process.platform === 'win32' ? `${pin.cli}.exe` : pin.cli);
const installDir = (id) => path.join(SIDECARS_DIR, id);
const ourCopy = (id, pin) => path.join(installDir(id), exeName(pin));
const recordFile = (id) => path.join(SIDECARS_DIR, `${id}.json`);
const writeRecord = (id, record) => writeDurable(recordFile(id), JSON.stringify(record), { backup: false });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** Deletes a folder that is only in the way; one that will not go is swept by the next download. */
const discard = (dir) => fsp.rm(dir, { recursive: true, force: true }).catch(() => {});

function usable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** `<data>/sidecars/<id>.json`; `{}` when it is missing or will not read. */
function readRecord(id) {
  try {
    const record = JSON.parse(fs.readFileSync(recordFile(id), 'utf8'));
    return record && typeof record === 'object' ? record : {};
  } catch {
    return {};
  }
}

/** The tool on PATH. Only the real binary name is tried, so a Windows `.cmd` shim is never picked up. */
function onPath(name) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return dirs.map((dir) => path.join(dir, name)).find(usable);
}

/**
 * The binary to run, null when there is none. The env name is final when set
 * (tests pin their fake there): falling through from it could run the wrong
 * tool. Then the path the user saved, then our download, then PATH.
 */
export function resolve(id) {
  const pin = pinOf(id);
  const own = process.env[BIN_ENV[id]]?.trim();
  if (own) return usable(own) ? own : null;
  return [readRecord(id).path, ourCopy(id, pin), onPath(exeName(pin))].find((file) => file && usable(file)) ?? null;
}

/**
 * `<cli> --version` -> '0.15.0'; null when it refuses to run or is still running
 * at the limit. The stop is SIGKILL: a tool that ignores SIGTERM would hold
 * status() for as long as it lived. Windows rejects a `.cmd` by throwing.
 */
function versionOf(file) {
  const options = { timeout: versionMs, killSignal: 'SIGKILL', windowsHide: true, encoding: 'utf8' };
  return new Promise((done) => {
    try {
      execFile(file, ['--version'], options, (error, stdout) => {
        done(error ? null : (/\d+\.\d+\.\d+/.exec(String(stdout))?.[0] ?? null));
      });
    } catch {
      done(null);
    }
  });
}

/** What `file` is, measured against the pin. */
async function inspect(id, pin, file) {
  const found = { id, installed: true, path: file, pinned: pin.version };
  const version = await versionOf(file);
  if (!version) return { ...found, ok: false, message: WOULD_NOT_RUN };
  if (version !== pin.version) {
    return { ...found, version, ok: false, message: `Found ${version}; this app works with ${pin.version} only.` };
  }
  return { ...found, version, ok: true, message: READY };
}

/** The sidecar's state for Settings and for whatever is about to run it. */
export async function status(id) {
  const pin = pinOf(id);
  const file = resolve(id);
  if (!file) {
    const message = assetOf(pin) ? NOT_INSTALLED : NOT_AVAILABLE;
    return { id, installed: false, pinned: pin.version, ok: false, message };
  }
  const seen = await inspect(id, pin, file);
  const stuck = readRecord(id).quarantined === true && file === ourCopy(id, pin);
  return stuck ? { ...seen, message: `${seen.message} ${QUARANTINE_STUCK}` } : seen;
}

/**
 * Saves a file the user chose, once it answers with the pinned version, and
 * answers what it found either way: anything else is reported and not saved.
 * A save that fails is one sentence, like a download's.
 */
export async function setPath(id, file) {
  const pin = pinOf(id);
  const chosen = path.resolve(String(file).trim());
  if (!usable(chosen)) return { id, installed: false, pinned: pin.version, ok: false, message: NO_PROGRAM };
  const seen = await inspect(id, pin, chosen);
  if (!seen.ok) return seen;
  try {
    writeRecord(id, { path: chosen });
  } catch (err) {
    throw plainFailure(err);
  }
  return seen;
}

/** Only the test seam sets `asset.url`; a real pin always comes from its GitHub release over https. */
const assetUrl = (pin, asset) =>
  asset.url ?? `https://github.com/${pin.repo}/releases/download/v${pin.version}/${asset.name}`;

/** A failed transfer as a sentence. A full disk stays as it is, for download() to name. */
function transferError(err) {
  if (err?.code === 'ENOSPC') return err;
  return new Error(err?.name === 'TimeoutError' ? TOO_SLOW : OFFLINE);
}

/** Streams `url` to `file` and answers its sha256. The timeout covers the whole transfer. */
async function fetchTo(url, file, onProgress) {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_MS) }).catch((err) => {
    throw transferError(err);
  });
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}). Try it again.`);
  const total = Number(res.headers.get('content-length')) || null;
  const hash = createHash('sha256');
  let received = 0;
  async function* counted(chunks) {
    for await (const chunk of chunks) {
      hash.update(chunk);
      received += chunk.length;
      onProgress?.({ received, total });
      yield chunk;
    }
  }
  await pipeline(Readable.fromWeb(res.body), counted, fs.createWriteStream(file)).catch((err) => {
    throw transferError(err);
  });
  return hash.digest('hex');
}

async function readAt(handle, length, position) {
  const { buffer, bytesRead } = await handle.read(Buffer.alloc(length), 0, length, position);
  if (bytesRead < length) throw new Error('zip: read past the end');
  return buffer;
}

/** The rows of a zip's central directory, the only place the macOS archives keep their sizes. */
function* zipRows(directory, count) {
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    if (directory.readUInt32LE(at) !== ZIP_ROW) throw new Error('zip: bad directory');
    const nameEnd = at + 46 + directory.readUInt16LE(at + 28);
    yield {
      method: directory.readUInt16LE(at + 10),
      packed: directory.readUInt32LE(at + 20),
      mode: directory.readUInt32LE(at + 38) >>> 16,
      offset: directory.readUInt32LE(at + 42),
      name: directory.toString('utf8', at + 46, nameEnd),
    };
    at = nameEnd + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32);
  }
}

/** Where an entry lands under `into`. A name that would land anywhere else fails the whole archive. */
function zipTarget(into, name) {
  const parts = name.split(/[\\/]/);
  if (/^[\\/]|^[a-zA-Z]:/.test(name) || parts.includes('..')) throw new Error('zip: path outside the archive');
  return path.join(into, ...parts);
}

/** Unpacks stored and deflated entries, one stream at a time. Zip64 is not read: no asset nears 4 GB. */
async function unzip(file, into) {
  const handle = await fsp.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const tail = await readAt(handle, Math.min(size, ZIP_TAIL_BYTES), Math.max(0, size - ZIP_TAIL_BYTES));
    const end = tail.lastIndexOf(ZIP_END);
    if (end < 0) throw new Error('zip: no directory');
    const directory = await readAt(handle, tail.readUInt32LE(end + 12), tail.readUInt32LE(end + 16));
    for (const row of zipRows(directory, tail.readUInt16LE(end + 10))) {
      const target = zipTarget(into, row.name);
      if (row.name.endsWith('/')) {
        await fsp.mkdir(target, { recursive: true });
        continue;
      }
      if ((row.mode & FILE_TYPE) === SYMLINK) continue;
      if (row.method !== ZIP_STORED && row.method !== ZIP_DEFLATED) throw new Error('zip: unknown method');
      const local = await readAt(handle, 30, row.offset);
      if (local.readUInt32LE(0) !== ZIP_LOCAL) throw new Error('zip: bad entry');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      if (row.packed === 0) {
        await fsp.writeFile(target, '');
        continue;
      }
      const start = row.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const source = fs.createReadStream(file, { start, end: start + row.packed - 1 });
      const out = fs.createWriteStream(target);
      await pipeline(row.method === ZIP_DEFLATED ? [source, zlib.createInflateRaw(), out] : [source, out]);
    }
  } finally {
    await handle.close();
  }
}

function untar(file, into) {
  return new Promise((done, fail) => {
    execFile('tar', ['-xzf', file, '-C', into], { timeout: DOWNLOAD_MS, windowsHide: true }, (error) => {
      if (error) fail(error);
      else done();
    });
  });
}

/** Opens the checked download into `into`, a zip or a tarball by its name, a bare binary otherwise. */
async function unpack(fetched, asset, into, exe) {
  try {
    if (/\.zip$/i.test(asset.name)) await unzip(fetched, into);
    else if (/\.(tar\.gz|tgz)$/i.test(asset.name)) await untar(fetched, into);
    else await fsp.rename(fetched, path.join(into, exe));
  } catch (err) {
    throw err?.code === 'ENOSPC' ? err : new Error(BAD_ARCHIVE);
  }
}

/** Release archives wrap everything in one folder; what gets installed is that folder's contents. */
async function archiveRoot(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries.length === 1 && entries[0].isDirectory() ? path.join(dir, entries[0].name) : dir;
}

/** Takes the flag off; false only if it could not be. A file that never had it is fine. */
function clearQuarantine(file) {
  if (process.platform !== 'darwin') return Promise.resolve(true);
  return new Promise((done) => {
    const options = { timeout: CLEAR_FLAG_MS, encoding: 'utf8' };
    execFile('xattr', ['-d', QUARANTINE, file], options, (error, _stdout, stderr) => {
      done(!error || /No such xattr/i.test(String(stderr)));
    });
  });
}

/** What an unfinished download or swap left behind: `.<id>-<random>` and `.<id>-old-<random>` folders. */
async function clearLeftovers(id) {
  const names = await fsp.readdir(SIDECARS_DIR).catch(() => []);
  const stale = names.filter((name) => name.startsWith(`.${id}-`));
  await Promise.all(stale.map((name) => discard(path.join(SIDECARS_DIR, name))));
}

/** A rename. Windows refuses one while a virus scanner still holds a file inside, so it asks again. */
async function moveFolder(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      if (process.platform !== 'win32' || attempt >= MOVE_TRIES || !HELD.includes(err?.code)) throw err;
      await sleep(MOVE_WAIT_MS * attempt);
    }
  }
}

/**
 * Puts the old folder back, false when it could not. One that will not move can
 * still be read, so it is copied, and half a copy is not left to be run.
 */
async function putBack(aside, dir) {
  try {
    await moveFolder(aside, dir);
    return true;
  } catch {
    try {
      await fsp.cp(aside, dir, { recursive: true, verbatimSymlinks: true });
    } catch {
      await discard(dir);
      return false;
    }
    await discard(aside);
    return true;
  }
}

/**
 * Puts the finished folder at `<data>/sidecars/<id>/`. Nothing can rename over a
 * folder, so the old one moves aside first and is deleted only once the new one
 * is in. If the new one will not go, the old one goes back.
 */
async function swapIn(fresh, id) {
  const dir = installDir(id);
  const aside = path.join(SIDECARS_DIR, `.${id}-old-${randomBytes(6).toString('hex')}`);
  let moved = false;
  try {
    if (await fsp.lstat(dir).catch(() => null)) {
      await moveFolder(dir, aside);
      moved = true;
    }
    await moveFolder(fresh, dir);
  } catch (err) {
    if (moved && !(await putBack(aside, dir))) throw new Error(OLD_LOST);
    throw err?.code === 'ENOSPC' ? err : new Error(NOT_PLACED);
  }
  await discard(aside);
}

/** One sentence for the user. This file's own errors carry no code; a raw system error does, and it names full paths. */
function plainFailure(err) {
  if (err?.code === 'ENOSPC') return new Error(NO_SPACE);
  return err?.code ? new Error(NOT_SAVED) : err;
}

/**
 * Fetches, checks and installs the pinned asset into `<data>/sidecars/<id>/`, and
 * answers the installed binary's path. Everything happens in a folder of its own
 * beside the install, which is swapped in only once the whole thing is good. The
 * user asked for this copy, so it replaces any saved path.
 */
export async function download(id, { onProgress } = {}) {
  const pin = pinOf(id);
  const asset = assetOf(pin);
  if (!asset) throw new Error(NOT_AVAILABLE);
  if (busy.has(id)) throw new Error(BUSY);
  busy.add(id);
  const work = path.join(SIDECARS_DIR, `.${id}-${randomBytes(6).toString('hex')}`);
  try {
    await clearLeftovers(id);
    const unpacked = path.join(work, 'unpacked');
    await fsp.mkdir(unpacked, { recursive: true });
    const fetched = path.join(work, 'download');
    const sha256 = await fetchTo(assetUrl(pin, asset), fetched, onProgress);
    if (sha256 !== asset.sha256.toLowerCase()) throw new Error(HASH_MISMATCH);
    await unpack(fetched, asset, unpacked, exeName(pin));
    const root = await archiveRoot(unpacked);
    const binary = await fsp.lstat(path.join(root, exeName(pin))).catch(() => null);
    if (!binary?.isFile()) throw new Error(`The download did not contain ${pin.cli}; nothing was installed.`);
    await fsp.chmod(path.join(root, exeName(pin)), 0o755);
    await swapIn(root, id);
    const file = ourCopy(id, pin);
    await fsp.rm(recordFile(id), { force: true });
    if (!(await clearQuarantine(file))) writeRecord(id, { quarantined: true });
    return file;
  } catch (err) {
    throw plainFailure(err);
  } finally {
    busy.delete(id);
    await discard(work);
  }
}

/** Our folder and the record. A refusal is one sentence, with no path in it. */
async function deleteInstall(id) {
  try {
    await fsp.rm(installDir(id), { recursive: true, force: true });
    await fsp.rm(recordFile(id), { force: true });
  } catch {
    throw new Error(NOT_REMOVED);
  }
}

/**
 * Deletes our download and forgets a saved path. The user's own file at that
 * path stays where it is. The tool is held busy throughout, so no download
 * starts while the sweep below could take its work folder.
 */
export async function remove(id) {
  pinOf(id);
  if (busy.has(id)) throw new Error(BUSY);
  busy.add(id);
  try {
    await deleteInstall(id);
    await clearLeftovers(id);
  } finally {
    busy.delete(id);
  }
}

/** Test seam: replaces the pins; `null` puts the real ones back. */
export function __setPins(next) {
  pins = next ?? PINS;
}

/** Test seam: how long `--version` gets; `null` puts the real limit back. */
export function __setVersionLimit(ms) {
  versionMs = ms ?? VERSION_MS;
}
