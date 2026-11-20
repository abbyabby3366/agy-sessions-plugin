import { contextBridge, ipcRenderer } from 'electron';
import type {
  ActionResult,
  MonitorSnapshot,
  QuotaState,
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
  getQuota: (): Promise<QuotaState> => ipcRenderer.invoke('quota:get'),
  onQuotaChanged: (callback: (quota: QuotaState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: QuotaState) => {
      callback(payload);
    };
    ipcRenderer.on('quota:snapshot', listener);
    return () => {
      ipcRenderer.removeListener('quota:snapshot', listener);
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
  setContentHeight: (height: number): Promise<void> =>
    ipcRenderer.invoke('window:set-content-height', height),
  openPath: (targetPath: string): Promise<ActionResult> =>
    ipcRenderer.invoke('shell:open-path', targetPath),
  openInIde: (workspacePath: string): Promise<ActionResult> =>
    ipcRenderer.invoke('ide:open-workspace', workspacePath),
  focusAntigravityApp: (): Promise<ActionResult> =>
    ipcRenderer.invoke('app:focus-antigravity'),
  revealFile: (targetPath: string): Promise<ActionResult> =>
    ipcRenderer.invoke('shell:reveal-file', targetPath),
  copyText: (text: string): Promise<ActionResult> =>
    ipcRenderer.invoke('clipboard:write', text),
  markUnreadRead: (conversationIds: string[]): Promise<ActionResult> =>
    ipcRenderer.invoke('monitor:mark-unread-read', conversationIds),
};

contextBridge.exposeInMainWorld('stickyMonitor', api);
