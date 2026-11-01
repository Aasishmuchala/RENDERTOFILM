// Whole-file state that survives a crash and a damaged disk: tasks.json and the
// JSON documents of storage.js. A write lands by temp plus rename, flushed first,
// so the real name only ever holds a finished file. `<file>.bak` then becomes a
// copy of what was just written, so a restore loses nothing: a backup of the
// version before would lose the newest take. A file that will not read is kept
// as `<file>.corrupt-<time>` before the backup takes its name.
//
// Node built-ins only, because Electron's main process loads this (import.js).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const backupOf = (file) => `${file}.bak`;

export const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A backup or a kept damaged file: neither is a document, so neither is listed or imported. */
export const isSpareCopy = (name) => /\.(bak|corrupt-\d+)$/.test(name);

/** A failed backup costs a backup, not the write that came before it. */
function refreshBackup(file) {
  const backup = backupOf(file);
  const tmp = `${backup}.tmp`;
  try {
    fs.copyFileSync(file, tmp);
    fs.renameSync(tmp, backup);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    console.warn(`[durable] could not refresh ${path.basename(backup)}: ${err?.code ?? 'unknown error'}`);
  }
}

/** Replaces `file` in one step. `backup: false` is for sealed documents, which keep no second copy. */
export function writeDurable(file, data, { backup = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  if (backup) refreshBackup(file);
}

/** The backup's bytes, or null when there is none to read. */
export function readBackup(file) {
  try {
    return fs.readFileSync(backupOf(file));
  } catch {
    return null;
  }
}

/** Puts `bytes` (a backup already read as whole) under the real name. Returns the kept damaged file's name, if any. */
export function restoreDurable(file, bytes) {
  let kept = null;
  if (fs.existsSync(file)) {
    kept = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, kept);
  }
  writeDurable(file, bytes);
  return kept && path.basename(kept);
}
