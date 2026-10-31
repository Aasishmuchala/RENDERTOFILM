// The window's one bridge to main. Sandboxed, so nothing else is reachable here.
import { contextBridge, ipcRenderer } from 'electron';

declare const __APP_VERSION__: string;

contextBridge.exposeInMainWorld('rtfDesktop', {
  version: __APP_VERSION__,
  platform: process.platform,
  revealDataDir: () => ipcRenderer.invoke('reveal-data-dir'),
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset['desktop'] = process.platform;
});

ipcRenderer.on('navigate', (_event, hash: string) => {
  location.hash = hash;
});
