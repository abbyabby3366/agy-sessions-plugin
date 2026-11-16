import { contextBridge, ipcRenderer } from 'electron';
import type {
  ActionResult,
  MonitorSnapshot,
  StickyMonitorApi,
  WindowPreferences,
} from '../shared/types.js';

const api: StickyMonitorApi = {
  getSnapshot: (): Promise<MonitorSnapshot> => ipcRenderer.invoke('monitor:get-snapshot'),
  onSnapshot: (callback: (snapshot: MonitorSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MonitorSnapshot) => {
      callback(payload);
    };
    ipcRenderer.on('monitor:snapshot', listener);
    return () => {
      ipcRenderer.removeListener('monitor:snapshot', listener);
    };
  },
  getPreferences: (): Promise<WindowPreferences> => ipcRenderer.invoke('prefs:get'),
  updatePreferences: (patch: Partial<WindowPreferences>): Promise<WindowPreferences> =>
    ipcRenderer.invoke('prefs:update', patch),
  onPreferencesChanged: (callback: (prefs: WindowPreferences) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WindowPreferences) => {
      callback(payload);
    };
    ipcRenderer.on('prefs:changed', listener);
    return () => {
      ipcRenderer.removeListener('prefs:changed', listener);
    };
  },
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  hideToTray: (): Promise<void> => ipcRenderer.invoke('window:hide'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  openPath: (targetPath: string): Promise<ActionResult> =>
    ipcRenderer.invoke('shell:open-path', targetPath),
  revealFile: (targetPath: string): Promise<ActionResult> =>
    ipcRenderer.invoke('shell:reveal-file', targetPath),
  copyText: (text: string): Promise<ActionResult> =>
    ipcRenderer.invoke('clipboard:write', text),
};

contextBridge.exposeInMainWorld('stickyMonitor', api);
