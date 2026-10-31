// The Electron shell around the app's own server: one window on a loopback
// origin, everything else in the system browser. The launch flags are for CI and
// tests: --simulate, --port N, --token T, --data-dir D, --import FROM, and the
// hidden --import-yes and --screenshot FILE. --simulate keeps to a mock keychain.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { BrowserWindow, app, dialog, ipcMain, screen, session, shell, type WebContents } from 'electron';

import { firstRunImport } from './import.ts';
import { installMenu } from './menu.ts';
import { DataKeyError, dataKey } from './secrets.ts';
import { ServerHost } from './server.ts';

const APP_NAME = 'Render to Film';
const WINDOW = { width: 1440, height: 900, minWidth: 1024, minHeight: 640 };
const BACKGROUND = '#0c0c0e';
const SCREENSHOT_DELAY_MS = 5_000;
const ABORTED = -3; // a navigation main itself cancelled
const RETRY_URL = 'rtf-retry://reload/';

const RETRY_PAGE = `<!doctype html><meta charset="utf-8"><title>${APP_NAME}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  body { display: grid; place-content: center; height: 100vh; margin: 0; font: 14px system-ui; text-align: center; color: #f2f2f4; background: ${BACKGROUND}; }
  a { display: inline-block; margin-top: 16px; padding: 8px 16px; border-radius: 8px; color: inherit; background: #2a2a2e; text-decoration: none; }
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
  void win.loadURL(`${server?.origin}/__desktop/open?t=${encodeURIComponent(token)}`);
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
      if (owner) loadApp(owner);
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
  loadApp(win);
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
        if (mainWindow) loadApp(mainWindow);
      },
      onCrashLoop: crashLoop,
    }
  );
  server = host;
  installMenu({
    openSettings: () => mainWindow?.webContents.send('navigate', '#settings'),
    dataDir,
    logFile: () => host.logFile,
  });
  session.defaultSession.setPermissionRequestHandler((contents, _permission, answer) => answer(isOwnOrigin(contents.getURL())));
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
}
if (cli.simulate) app.commandLine.appendSwitch('use-mock-keychain'); // never saves a real key
if (process.platform === 'win32') app.setAppUserModelId('com.sthyra.rendertofilm');

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('web-contents-created', (_event, contents) => applyPolicy(contents));
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && booted) app.quit();
  });
  app.on('before-quit', (event) => {
    if (stopped || !server) return;
    event.preventDefault();
    void quitInOrder();
  });
  boot().catch((error: unknown) => {
    failStart(`${APP_NAME} could not start: ${error instanceof Error ? error.message : String(error)}`);
  });
} else {
  app.quit();
}
