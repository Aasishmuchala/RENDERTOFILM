// The Electron shell around the app's own server: one window on a loopback
// origin, everything else in the system browser. The launch flags are for CI and
// tests: --simulate, --port N, --token T, --data-dir D, --import FROM, and the
// hidden --import-yes and --screenshot FILE. --simulate keeps to a mock keychain.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  crashReporter,
  dialog,
  ipcMain,
  nativeImage,
  powerMonitor,
  powerSaveBlocker,
  screen,
  session,
  shell,
  type WebContents,
} from 'electron';

import { firstRunImport, importFromPicker } from './import.ts';
import { installMenu } from './menu.ts';
import { DataKeyError, dataKey } from './secrets.ts';
import { ServerHost, permissionAllowed } from './server.ts';

const APP_NAME = 'Render to Film';
const WINDOW = { width: 1440, height: 900, minWidth: 1024, minHeight: 640 };
const BACKGROUND = '#0b0b0b';
const SCREENSHOT_DELAY_MS = 5_000;
const ABORTED = -3; // a navigation main itself cancelled
const RETRY_URL = 'rtf-retry://reload/';
const TRAY_ICON_PX = 16;
const IDLE_QUIT_MS = 15_000; // a crashed server needs this long to come back and say it is still busy

const RETRY_PAGE = `<!doctype html><meta charset="utf-8"><title>${APP_NAME}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  body { display: grid; place-content: center; height: 100vh; margin: 0; font: 14px system-ui; text-align: center; color: #f5f5f5; background: ${BACKGROUND}; }
  a { display: inline-block; margin-top: 16px; padding: 8px 16px; border-radius: 8px; color: inherit; background: #2a2a2a; text-decoration: none; }
</style>
<body><div>${APP_NAME} is not answering.<br><a href="${RETRY_URL}">Try again</a></div></body>`;

function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  if (at !== -1) return process.argv[at + 1];
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const flagSet = (name: string) => process.argv.includes(`--${name}`);

const portFlag = Number(flagValue('port'));
const cli = {
  simulate: flagSet('simulate'),
  port: Number.isInteger(portFlag) && portFlag > 0 && portFlag < 65536 ? portFlag : undefined,
  token: flagValue('token'),
  dataDir: flagValue('data-dir'),
  importFrom: flagValue('import'),
  importYes: flagSet('import-yes'),
  screenshot: flagValue('screenshot'),
};

let server: ServerHost | undefined;
let mainWindow: BrowserWindow | null = null;
let dataDir = '';
let token = '';
let booted = false;
let stopped = false;
let quitting = false;
let importing = false;
let tray: Tray | null = null;
let suspensionBlocker: number | null = null;
let idleQuit: NodeJS.Timeout | undefined;

const webPreferences = () => ({
  preload: path.join(app.getAppPath(), 'preload', 'dist', 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
});

function isOwnOrigin(url: string): boolean {
  try {
    return new URL(url).origin === server?.origin;
  } catch {
    return false;
  }
}

/** Only web links leave the app: a `file:` or custom scheme stays refused. */
function openOutside(url: string) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url);
  } catch {
    // not a URL: nothing to open
  }
}

function loadApp(win: BrowserWindow) {
  return win.loadURL(`${server?.origin}/__desktop/open?t=${encodeURIComponent(token)}`);
}

/** The navigation policy, for every window: the popup's OAuth redirect has to leave too. */
function applyPolicy(contents: WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isOwnOrigin(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { backgroundColor: BACKGROUND, webPreferences: webPreferences() } };
    }
    openOutside(url);
    return { action: 'deny' };
  });
  const leaving = (event: { preventDefault: () => void }, url: string) => {
    if (isOwnOrigin(url)) return;
    event.preventDefault();
    const owner = BrowserWindow.fromWebContents(contents);
    if (url === RETRY_URL) {
      if (owner) void loadApp(owner);
      return;
    }
    openOutside(url);
    if (owner && owner !== mainWindow) owner.close();
  };
  contents.on('will-navigate', leaving);
  contents.on('will-redirect', leaving);
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function capture(win: BrowserWindow, file: string) {
  setTimeout(() => {
    void win.webContents.capturePage().then((image) => {
      writeFileSync(file, image.toPNG());
      app.quit();
    });
  }, SCREENSHOT_DELAY_MS);
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    ...WINDOW,
    width: Math.min(WINDOW.width, Math.max(width, WINDOW.minWidth)),
    height: Math.min(WINDOW.height, Math.max(height, WINDOW.minHeight)),
    show: false,
    title: APP_NAME,
    backgroundColor: BACKGROUND,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 17 } }
      : {}),
    webPreferences: webPreferences(),
  });
  mainWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === ABORTED || url.startsWith('data:')) return;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(RETRY_PAGE)}`);
  });
  if (cli.screenshot) {
    const file = path.resolve(cli.screenshot);
    win.webContents.once('did-finish-load', () => capture(win, file));
  }
  void loadApp(win);
}

function showWindow() {
  if (!booted) return;
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  app.focus({ steal: true });
}

/** While work runs: a way back once the windows are gone, and no app suspension under it. */
function holdForWork() {
  clearTimeout(idleQuit);
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'icon.png'));
  tray = new Tray(icon.resize({ width: TRAY_ICON_PX, height: TRAY_ICON_PX }));
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: showWindow },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
  suspensionBlocker = powerSaveBlocker.start('prevent-app-suspension');
}

function releaseWork() {
  tray?.destroy();
  tray = null;
  if (suspensionBlocker !== null) powerSaveBlocker.stop(suspensionBlocker);
  suspensionBlocker = null;
  // With no window and no tray, nothing could reach the app any more.
  if (process.platform !== 'darwin') idleQuit = setTimeout(quitIfNothingLeft, IDLE_QUIT_MS);
}

function quitIfNothingLeft() {
  if (!server?.busy && BrowserWindow.getAllWindows().length === 0) app.quit();
}

async function confirmQuit(): Promise<boolean> {
  const active = server?.active ?? 0;
  if (active === 0) return true;
  const where = server?.provider || 'your provider';
  const message =
    active === 1
      ? `1 generation is still running on ${where}. It continues there and is picked up when you reopen ${APP_NAME}.`
      : `${active} generations are still running on ${where}. They continue there and are picked up when you reopen ${APP_NAME}.`;
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message,
    buttons: ['Quit', 'Keep open'],
    defaultId: 1,
    cancelId: 1,
  });
  return response === 0;
}

async function quitInOrder() {
  if (quitting) return;
  quitting = true;
  if (!(await confirmQuit())) {
    quitting = false;
    // Windows quits with its last window, so that window may need bringing back.
    if (!mainWindow && process.platform !== 'darwin') createWindow();
    return;
  }
  await server?.stop();
  stopped = true;
  app.quit();
}

/** The server stops for the import and comes back after it, so it reads what came in. */
async function aroundImport(work: () => Promise<void>) {
  await server?.stop();
  try {
    await work();
  } finally {
    if (!(await server?.start())) failStart(`The server did not start. The log is at ${server?.logFile}`);
    else if (mainWindow) await loadApp(mainWindow).catch(() => undefined);
  }
}

async function importFolder() {
  if (!booted || importing) return;
  importing = true;
  try {
    const imported = await importFromPicker(dataDir, aroundImport);
    if (imported) mainWindow?.webContents.send('navigate', '#library');
  } finally {
    importing = false;
  }
}

async function crashLoop(logFile: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    message: `${APP_NAME} keeps stopping.`,
    detail: `Its server stopped three times in a minute. The log is at ${logFile}`,
    buttons: ['Try again', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 1) app.quit();
  return response === 0;
}

function failStart(message: string) {
  dialog.showErrorBox(APP_NAME, message);
  stopped = true;
  app.quit();
}

async function boot() {
  await app.whenReady();
  const userData = app.getPath('userData');
  dataDir = cli.dataDir ? path.resolve(cli.dataDir) : path.join(userData, 'data');
  mkdirSync(dataDir, { recursive: true });

  let secretKey: string;
  try {
    secretKey = await dataKey(userData);
  } catch (error) {
    failStart(error instanceof DataKeyError ? error.message : 'Your saved keys could not be read.');
    return;
  }

  await firstRunImport({
    dataDir,
    from: cli.importFrom ? path.resolve(cli.importFrom) : undefined,
    offerHarness: !app.isPackaged && !cli.dataDir,
    assumeYes: cli.importYes,
  });

  token = cli.token ?? randomBytes(32).toString('hex');
  const host = new ServerHost(
    { port: cli.port, token, secretKey, dataDir, logDir: path.join(userData, 'logs'), simulate: cli.simulate },
    {
      onOriginChange: () => {
        if (mainWindow) void loadApp(mainWindow);
      },
      onCrashLoop: crashLoop,
      onBusyChange: (busy) => (busy ? holdForWork() : releaseWork()),
    }
  );
  server = host;
  installMenu({
    openSettings: () => mainWindow?.webContents.send('navigate', '#settings'),
    importLibrary: () => void importFolder(),
    dataDir,
    logFile: () => host.logFile,
  });
  session.defaultSession.setPermissionRequestHandler((_contents, permission, answer, { requestingUrl }) => {
    answer(permissionAllowed(permission, requestingUrl, host.origin));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => permissionAllowed(permission, origin, host.origin));
  powerMonitor.on('resume', () => host.wake());
  ipcMain.handle('reveal-data-dir', (event) => {
    if (isOwnOrigin(event.senderFrame?.url ?? '')) void shell.openPath(dataDir);
  });

  if (!(await host.start())) {
    await host.stop();
    failStart(`The server did not start. The log is at ${host.logFile}`);
    return;
  }
  booted = true;
  createWindow();
}

app.setName(APP_NAME);
if (cli.dataDir) {
  // Everything a launch writes stays with its data folder, and so does its
  // single-instance lock: a test run never touches the person's real profile.
  const profile = path.join(path.resolve(cli.dataDir), 'profile');
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
  app.setPath('crashDumps', path.join(profile, 'crashes'));
}
crashReporter.start({ uploadToServer: false, submitURL: '' }); // dumps stay in crashDumps, nothing is sent
if (cli.simulate) app.commandLine.appendSwitch('use-mock-keychain'); // never saves a real key
if (process.platform === 'win32') app.setAppUserModelId('com.sthyra.rendertofilm');

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('web-contents-created', (_event, contents) => applyPolicy(contents));
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && booted && !server?.busy) app.quit();
  });
  app.on('render-process-gone', (_event, _contents, { reason, exitCode }) => {
    server?.note(`render process gone: ${reason} (exit ${exitCode})`);
  });
  app.on('child-process-gone', (_event, { type, name, reason, exitCode }) => {
    server?.note(`${type} process gone: ${name ?? 'unnamed'} ${reason} (exit ${exitCode})`);
  });
  app.on('before-quit', (event) => {
    if (stopped || !server) return;
    event.preventDefault();
    // An import is moving files into place: the progress window stays until it ends.
    if (!importing) void quitInOrder();
  });
  boot().catch((error: unknown) => {
    failStart(`${APP_NAME} could not start: ${error instanceof Error ? error.message : String(error)}`);
  });
} else {
  app.quit();
}
