// Brings an existing library into the data folder with platform/bay/import.js:
// on first run before the server starts, or later from the folder picker with
// the server stopped. The source is only ever read, and nothing already in the
// data folder is overwritten.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { BrowserWindow, app, dialog } from 'electron';

import { findHarness, importLibrary } from '../platform/bay/import.js';

// Decision 5: the harness's stored owner, and the desktop's local one.
const HARNESS_OWNER = '1e8e02632378790840f76e9e';
const LOCAL_OWNER = '29b7dddadef2570e181d507c';
const PROGRESS_STEPS = 200;
const IMPORT_AREAS = ['storage', 'uploads'];

const NO_LIBRARY = 'That folder has no library. Pick the folder that holds storage and uploads.';
const OWN_FOLDER = "That is this app's own data folder. Pick the folder you want to bring in.";
const OTHER_OWNER = "That folder's library could not be read. Nothing was imported.";
const HAS_WORK =
  'Nothing was imported, because this app already has work in it. An import never mixes into a library or overwrites one.';

const PROGRESS_PAGE = `<!doctype html><meta charset="utf-8"><title>Importing your library</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  body { margin: 0; padding: 24px; font: 13px system-ui; color: #f5f5f5; background: #0b0b0b; }
  progress { width: 100%; height: 8px; margin-top: 12px; accent-color: #f5f5f5; }
</style>
<body>Importing your library. This can take a few minutes.<progress max="1" value="0"></progress></body>`;

function progressWindow() {
  const win = new BrowserWindow({
    width: 440,
    height: 120,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    title: 'Importing your library',
    backgroundColor: '#0b0b0b',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PROGRESS_PAGE)}`);
  return {
    update(share: number) {
      win.setProgressBar(share);
      void win.webContents
        .executeJavaScript(`document.querySelector('progress').value = ${share}`)
        .catch(() => undefined);
    },
    close() {
      win.setClosable(true);
      win.destroy();
    },
  };
}

function summary(result: Awaited<ReturnType<typeof importLibrary>>): string {
  if (result.skipped !== undefined) return 'There was nothing to import from that folder.';
  const files = `Imported ${result.files} files.`;
  if (result.sealedSkipped === 0) return files;
  return `${files} Saved keys from another install stay behind: add them again in Settings.`;
}

/** Runs the import behind the progress window. */
async function importWithProgress(from: string, to: string, fromOwner: string) {
  const progress = progressWindow();
  let shown = 0;
  try {
    return await importLibrary({
      from,
      to,
      fromOwner,
      toOwner: LOCAL_OWNER,
      onProgress: ({ done, total }) => {
        const share = Math.floor((done / total) * PROGRESS_STEPS) / PROGRESS_STEPS;
        if (share === shown) return;
        shown = share;
        progress.update(share);
      },
    });
  } finally {
    progress.close();
  }
}

/**
 * Offers the import when the data folder has no library yet, and `--import FROM`
 * or (in a dev run on the default data folder) the harness names a source.
 * `assumeYes` skips the question, for CI.
 */
export async function firstRunImport({
  dataDir,
  from,
  offerHarness,
  assumeYes,
}: {
  dataDir: string;
  from: string | undefined;
  offerHarness: boolean;
  assumeYes: boolean;
}): Promise<void> {
  if (existsSync(path.join(dataDir, 'storage', 'library'))) return;
  const source = from ?? (offerHarness ? findHarness(path.resolve(app.getAppPath(), '..')) : null);
  if (!source) return;
  if (!assumeYes) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      message: `Import your existing library from ${source}?`,
      buttons: ['Import', 'Start empty'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
  }
  try {
    const result = await importWithProgress(source, dataDir, HARNESS_OWNER);
    if (assumeYes) console.log(`[import] ${JSON.stringify(result)}`);
    else await dialog.showMessageBox({ type: 'info', message: summary(result), buttons: ['OK'] });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (assumeYes) console.error(`[import] ${reason}`);
    else await dialog.showMessageBox({ type: 'error', message: `The import stopped: ${reason}`, buttons: ['OK'] });
  }
}

function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}

/** The library document's owner, when the folder holds one this app can read. A desktop install is already local. */
function readableOwner(from: string): string | undefined {
  return [LOCAL_OWNER, HARNESS_OWNER].find((owner) => {
    try {
      const doc = JSON.parse(readFileSync(path.join(from, 'storage', 'library', `${owner}.json`), 'utf8'));
      return Array.isArray(doc?.stills) && Array.isArray(doc?.clips);
    } catch {
      return false;
    }
  });
}

/** The picked folder, or a repo that holds the harness, checked before anything stops. */
function checkFolder(picked: string, dataDir: string): { from: string; owner: string } | { problem: string } {
  const from = existsSync(path.join(picked, 'storage', 'library')) ? picked : findHarness(picked);
  if (!from) return { problem: NO_LIBRARY };
  if (overlaps(realpathSync(from), realpathSync(dataDir))) return { problem: OWN_FOLDER };
  const owner = readableOwner(from);
  return owner ? { from, owner } : { problem: OTHER_OWNER };
}

/**
 * What an import would strand. importLibrary refuses over a library, and it keeps
 * a tasks.json already here, so stills that came with a library of their own
 * would lose their results.
 */
function hasWork(dataDir: string): boolean {
  return ['library', 'tasks.json'].some((name) => existsSync(path.join(dataDir, 'storage', name)));
}

async function isSealedFile(file: string): Promise<boolean> {
  try {
    return JSON.parse(await readFile(file, 'utf8'))?.alg === 'aes-256-gcm';
  } catch {
    return false;
  }
}

/** Source files already in the data folder: importLibrary leaves those be and still counts them as copied. */
async function filesAlreadyHere(from: string, dataDir: string, owner: string): Promise<number> {
  let found = 0;
  for (const area of IMPORT_AREAS) {
    const root = path.join(from, area);
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(entry.parentPath, entry.name);
      const here = path.join(dataDir, path.relative(from, file).replaceAll(owner, LOCAL_OWNER));
      const sealed = path.basename(entry.parentPath) === 'connections' && (await isSealedFile(file));
      if (existsSync(here) && !sealed) found += 1;
    }
  }
  return found;
}

const count = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

const tell = (type: 'info' | 'warning' | 'error', message: string, detail?: string) =>
  dialog.showMessageBox({ type, message, ...(detail ? { detail } : {}), buttons: ['OK'] });

/**
 * Import library…: picks a folder, checks it, and imports with the server
 * stopped, because the server keeps tasks.json in memory and would write over an
 * imported one. `aroundImport` stops it, runs the work and brings it back; the
 * answer is whether anything came in.
 */
export async function importFromPicker(
  dataDir: string,
  aroundImport: (work: () => Promise<void>) => Promise<void>
): Promise<boolean> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import library',
    message: 'Choose the folder that holds your library.',
    buttonLabel: 'Import',
    properties: ['openDirectory'],
  });
  const picked = filePaths[0];
  if (canceled || !picked) return false;
  const source = checkFolder(picked, dataDir);
  if ('problem' in source) {
    await tell('warning', source.problem);
    return false;
  }
  if (hasWork(dataDir)) {
    await tell('warning', HAS_WORK);
    return false;
  }
  let report: () => Promise<unknown> = () => tell('warning', HAS_WORK);
  let imported = false;
  try {
    await aroundImport(async () => {
      const kept = await filesAlreadyHere(source.from, dataDir, source.owner);
      const result = await importWithProgress(source.from, dataDir, source.owner);
      if (result.skipped !== undefined) return;
      imported = true;
      const lines = [
        `Imported: ${count(result.files - kept)}`,
        `Skipped, already here and left as they were: ${count(kept)}`,
        `Saved keys left behind: ${result.sealedSkipped}${result.sealedSkipped ? '. Add them again in Settings.' : ''}`,
      ];
      report = () => tell('info', `Imported your library from ${source.from}.`, lines.join('\n'));
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    report = () => tell('error', `The import stopped: ${reason}`, 'Nothing already here was changed, and the folder you picked is as it was.');
  }
  await report();
  return imported;
}
