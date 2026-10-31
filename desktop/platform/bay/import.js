// First-run import: brings an existing library (the harness, or a folder the
// person picks) into the app's data folder under the local owner. The source is
// only ever read. Everything is built in a staging folder inside the target and
// moved into place at the end, `library/` last, so a run that stops halfway
// leaves no library behind and the next run starts clean.
//
// This runs in Electron's main process, which has no RTF_DATA_DIR, so it takes
// both folders as arguments and must not import paths.js or storage.js.
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';

import { isSealed } from './secrets.js';

const OWNER_KEY = /^[0-9a-f]{24}$/;
const STAGING = '.import-staging';
// Uploads land first: `storage/library` is what says an import has finished.
const AREAS = ['uploads', 'storage'];
const CONNECTIONS = `storage${path.sep}connections${path.sep}`;

/** `<repo>/.localdev/harness` when it holds a library, else null. */
export function findHarness(repoGuess) {
  const dir = path.join(repoGuess, '.localdev', 'harness');
  return existsSync(path.join(dir, 'storage', 'library')) ? dir : null;
}

function overlaps(a, b) {
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}

/** Every file and folder under `dir`, as paths from the data folder. Symlinks stay behind: they could point anywhere. */
async function walk(dir, rel, found = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) {
      found.push({ rel: child, folder: true });
      await walk(path.join(dir, entry.name), child, found);
    } else if (entry.isFile()) {
      found.push({ rel: child, folder: false });
    }
  }
  return found;
}

function sealedText(text) {
  try {
    return isSealed(JSON.parse(text));
  } catch {
    return false;
  }
}

/** Copies a `.jsonl` line by line (the ledger can be large). Whether a line changed. */
async function copyLines(src, dest, fromOwner, toOwner) {
  let changed = false;
  const lines = readline.createInterface({ input: createReadStream(src), crlfDelay: Infinity });
  await pipeline(async function* () {
    for await (const line of lines) {
      const next = line.replaceAll(fromOwner, toOwner);
      changed ||= next !== line;
      yield `${next}\n`;
    }
  }, createWriteStream(dest));
  return changed;
}

/** Moves a staged tree into place. A file already in the data folder stays; `library` goes last. */
async function moveInto(src, dst) {
  if (!existsSync(src)) return;
  if (!existsSync(dst)) {
    await fs.rename(src, dst);
    return;
  }
  if (!(await fs.stat(src)).isDirectory()) return;
  const names = await fs.readdir(src);
  names.sort((a, b) => (a === 'library') - (b === 'library'));
  for (const name of names) await moveInto(path.join(src, name), path.join(dst, name));
}

/**
 * Copies `storage/` and `uploads/` from `from` into `to`, renaming every file or
 * folder that names `fromOwner` and rewriting it inside every `.json` and
 * `.jsonl`. Returns `{ files, renamed, rewritten, sealedSkipped }`, or
 * `{ skipped }` without touching anything.
 *
 * `sealedSkipped` counts connections documents sealed under another install's
 * key. This install could never open one, and the store refuses (rather than
 * wipes) a document it cannot open, so copying it would lock Settings for good.
 * The person adds those keys again.
 */
export async function importLibrary({ from, to, fromOwner, toOwner, onProgress }) {
  if (!OWNER_KEY.test(fromOwner) || !OWNER_KEY.test(toOwner)) {
    throw new Error('An owner key must be 24 hex characters.');
  }
  const source = path.resolve(from);
  const target = path.resolve(to);
  if (overlaps(source, target)) throw new Error('The folder to import from overlaps the data folder.');
  if (existsSync(path.join(target, 'storage', 'library'))) return { skipped: 'not empty' };
  if (!existsSync(path.join(source, 'storage'))) return { skipped: 'nothing to import' };

  const entries = [];
  for (const area of AREAS) {
    if (existsSync(path.join(source, area))) entries.push(...(await walk(path.join(source, area), area)));
  }
  const total = entries.filter((e) => !e.folder).length;
  const result = { files: 0, renamed: 0, rewritten: 0, sealedSkipped: 0 };

  const staging = path.join(target, STAGING);
  await fs.rm(staging, { recursive: true, force: true });
  try {
    let done = 0;
    for (const { rel, folder } of entries) {
      if (path.basename(rel).includes(fromOwner)) result.renamed += 1;
      const renamed = rel
        .split(path.sep)
        .map((segment) => segment.replaceAll(fromOwner, toOwner))
        .join(path.sep);
      const dest = path.join(staging, renamed);
      if (folder) {
        await fs.mkdir(dest, { recursive: true });
        continue;
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const src = path.join(source, rel);
      const ext = path.extname(rel).toLowerCase();
      let copied = true;
      if (ext === '.jsonl') {
        if (await copyLines(src, dest, fromOwner, toOwner)) result.rewritten += 1;
      } else if (ext === '.json') {
        const text = await fs.readFile(src, 'utf8');
        if (rel.startsWith(CONNECTIONS) && sealedText(text)) {
          result.sealedSkipped += 1;
          copied = false;
        } else if (text.includes(fromOwner)) {
          await fs.writeFile(dest, text.replaceAll(fromOwner, toOwner));
          result.rewritten += 1;
        } else {
          await fs.copyFile(src, dest);
        }
      } else {
        await fs.copyFile(src, dest);
      }
      if (copied) result.files += 1;
      done += 1;
      onProgress?.({ done, total, file: renamed });
    }
    for (const area of AREAS) await moveInto(path.join(staging, area), path.join(target, area));
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  return result;
}
