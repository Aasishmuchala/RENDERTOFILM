// First run: brings an existing library into the data folder before the server
// starts, with platform/bay/import.js. The source is only ever read.
import { existsSync } from 'node:fs';
import path from 'node:path';

import { BrowserWindow, app, dialog } from 'electron';

import { findHarness, importLibrary } from '../platform/bay/import.js';

// Decision 5: the harness's stored owner, and the desktop's local one.
const HARNESS_OWNER = '1e8e02632378790840f76e9e';
const LOCAL_OWNER = '29b7dddadef2570e181d507c';
const PROGRESS_STEPS = 200;

const PROGRESS_PAGE = `<!doctype html><meta charset="utf-8"><title>Importing your library</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  body { margin: 0; padding: 24px; font: 13px system-ui; color: #f2f2f4; background: #0c0c0e; }
  progress { width: 100%; height: 8px; margin-top: 12px; accent-color: #ee9c6c; }
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
    backgroundColor: '#0c0c0e',
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
  const progress = progressWindow();
  let shown = 0;
  try {
    const result = await importLibrary({
      from: source,
      to: dataDir,
      fromOwner: HARNESS_OWNER,
      toOwner: LOCAL_OWNER,
      onProgress: ({ done, total }) => {
        const share = Math.floor((done / total) * PROGRESS_STEPS) / PROGRESS_STEPS;
        if (share === shown) return;
        shown = share;
        progress.update(share);
      },
    });
    progress.close();
    if (assumeYes) console.log(`[import] ${JSON.stringify(result)}`);
    else await dialog.showMessageBox({ type: 'info', message: summary(result), buttons: ['OK'] });
  } catch (error) {
    progress.close();
    const reason = error instanceof Error ? error.message : String(error);
    if (assumeYes) console.error(`[import] ${reason}`);
    else await dialog.showMessageBox({ type: 'error', message: `The import stopped: ${reason}`, buttons: ['OK'] });
  }
}
