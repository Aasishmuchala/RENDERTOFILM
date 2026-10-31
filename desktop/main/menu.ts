// The native menu. On macOS the app menu holds Settings; on Windows, File does.
import { Menu, app, shell, type MenuItemConstructorOptions } from 'electron';

export const RELEASES_URL = 'https://github.com/Aasishmuchala/RENDERTOFILM/releases';

export type MenuActions = {
  openSettings: () => void;
  dataDir: string;
  logFile: () => string;
};

export function installMenu({ openSettings, dataDir, logFile }: MenuActions) {
  const isMac = process.platform === 'darwin';
  const settings: MenuItemConstructorOptions = {
    label: 'Settings',
    accelerator: 'CmdOrCtrl+,',
    click: openSettings,
  };
  const macApp: MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        settings,
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
  ];
  const file: MenuItemConstructorOptions[] = [{ label: 'File', submenu: [settings, { type: 'separator' }, { role: 'quit' }] }];
  const devTools: MenuItemConstructorOptions[] =
    process.env['RTF_DEVTOOLS'] === '1' ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : [];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? macApp : file),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...devTools,
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Open data folder', click: () => void shell.openPath(dataDir) },
        { label: 'Open server log', click: () => void shell.openPath(logFile()) },
        { label: 'Releases on GitHub', click: () => void shell.openExternal(RELEASES_URL) },
        { type: 'separator' },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
