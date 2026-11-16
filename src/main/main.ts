import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell,
  Tray,
} from 'electron';
import {
  getDefaultGeminiRootDir,
  getSourceDirs,
  readMonitorSnapshot,
} from './antigravityReader.js';
import { isQuestionOverdue } from '../shared/status.js';
import {
  loadPersistedState,
  savePersistedState,
  type PersistedState,
  type WindowBounds,
} from './preferences.js';
import { createAppIcon, createTrayIcon, getAppIconPath } from './trayIcon.js';
import type { ActionResult, MonitorSnapshot, WindowPreferences } from '../shared/types.js';

const POLL_INTERVAL_MS = 1500;
const WATCH_DEBOUNCE_MS = 220;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let persistedState: PersistedState;
let stateFilePath = '';
let pollTimer: NodeJS.Timeout | null = null;
let watchDebounceTimer: NodeJS.Timeout | null = null;
let boundsDebounceTimer: NodeJS.Timeout | null = null;
const activeWatchers: fs.FSWatcher[] = [];
let lastSnapshotSignature = '';
let lastTraySignature = '';

function resolveRendererBackground(pref: WindowPreferences['themePreference']): string {
  const isDark =
    pref === 'dark' || (pref === 'system' && nativeTheme.shouldUseDarkColors);
  return isDark ? '#111317' : '#f8f9fb';
}

function clampBoundsToDisplays(bounds: WindowBounds): WindowBounds {
  if (bounds.x === undefined || bounds.y === undefined) {
    const primary = screen.getPrimaryDisplay().workArea;
    return {
      width: bounds.width,
      height: bounds.height,
      x: Math.max(primary.x, primary.x + primary.width - bounds.width - 20),
      y: Math.max(primary.y, primary.y + 20),
    };
  }

  const targetDisplay = screen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
  const area = targetDisplay.workArea;
  const maxX = Math.max(area.x, area.x + area.width - 120);
  const maxY = Math.max(area.y, area.y + area.height - 80);

  return {
    width: Math.min(bounds.width, area.width),
    height: Math.min(bounds.height, area.height),
    x: Math.min(Math.max(area.x - bounds.width + 120, bounds.x), maxX),
    y: Math.min(Math.max(area.y, bounds.y), maxY),
  };
}

function persistStateNow(): void {
  if (!stateFilePath) return;
  try {
    savePersistedState(stateFilePath, persistedState);
  } catch (err) {
    console.error('[sticky-monitor] Failed to persist window state:', err);
  }
}

function scheduleBoundsSave(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (boundsDebounceTimer) clearTimeout(boundsDebounceTimer);
  boundsDebounceTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const b = mainWindow.getBounds();
    persistedState.bounds = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    };
    persistStateNow();
  }, 300);
}

function updateTrayStatus(snapshot: MonitorSnapshot): void {
  if (!tray) return;
  const nowMs = Date.now();
  const runningCount = snapshot.running.length;
  const waitingCount = snapshot.running.filter((c) => c.phase === 'waiting_input').length;
  const stalledCount = snapshot.running.filter((c) => c.phase === 'stalled').length;
  const overdueCount = snapshot.running.filter((c) => isQuestionOverdue(c, nowMs)).length;
  const sig = `${runningCount}:${waitingCount}:${stalledCount}:${overdueCount}`;

  if (sig !== lastTraySignature) {
    lastTraySignature = sig;
    tray.setImage(
      createTrayIcon(runningCount > 0, waitingCount > 0 || stalledCount > 0, overdueCount > 0)
    );
    const tooltip =
      runningCount === 0
        ? 'Antigravity Sessions — Idle'
        : overdueCount > 0
          ? `Antigravity Sessions — ${runningCount} active (${overdueCount} question >5m!)`
          : waitingCount > 0
            ? `Antigravity Sessions — ${runningCount} active (${waitingCount} waiting input)`
            : stalledCount > 0
              ? `Antigravity Sessions — ${runningCount} active (${stalledCount} stalled)`
              : `Antigravity Sessions — ${runningCount} active`;
    tray.setToolTip(tooltip);
  }
}

function computeSnapshot(): MonitorSnapshot {
  return readMonitorSnapshot({
    includeCli: persistedState.preferences.includeCli,
  });
}

function buildSignature(snapshot: MonitorSnapshot): string {
  return JSON.stringify({
    running: snapshot.running,
    recentIdle: snapshot.recentIdle,
    sources: snapshot.sources,
  });
}

function pushSnapshot(force = false): MonitorSnapshot {
  const snapshot = computeSnapshot();
  updateTrayStatus(snapshot);

  const signature = buildSignature(snapshot);
  if (force || signature !== lastSnapshotSignature) {
    lastSnapshotSignature = signature;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('monitor:snapshot', snapshot);
    }
  }
  return snapshot;
}

function closeWatchers(): void {
  while (activeWatchers.length > 0) {
    const w = activeWatchers.pop();
    try {
      w?.close();
    } catch {
      // Ignore watcher close failures
    }
  }
}

function setupWatchers(): void {
  closeWatchers();
  const rootDir = getDefaultGeminiRootDir();
  const sources = getSourceDirs(rootDir, persistedState.preferences.includeCli);

  for (const src of sources) {
    if (!fs.existsSync(src.dirPath)) continue;
    try {
      const watcher = fs.watch(src.dirPath, (_eventType, filename) => {
        if (
          !filename ||
          filename.startsWith('conversation_summaries.db')
        ) {
          if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
          watchDebounceTimer = setTimeout(() => {
            pushSnapshot(false);
          }, WATCH_DEBOUNCE_MS);
        }
      });
      activeWatchers.push(watcher);
    } catch (err) {
      console.error(`[sticky-monitor] Watch error for ${src.dirPath}:`, err);
    }
  }
}

function applyPreferencesToWindow(prefs: WindowPreferences): void {
  nativeTheme.themeSource = prefs.themePreference;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.setAlwaysOnTop(prefs.alwaysOnTop, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(prefs.alwaysOnTop, { visibleOnFullScreen: true });
  mainWindow.setOpacity(prefs.opacity);
  mainWindow.setBackgroundColor(resolveRendererBackground(prefs.themePreference));
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const prefs = persistedState.preferences;
  const menu = Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? 'Hide Widget' : 'Show Widget',
      click: () => toggleWindowVisibility(),
    },
    { type: 'separator' },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: prefs.alwaysOnTop,
      click: (item) => {
        persistedState.preferences = { ...persistedState.preferences, alwaysOnTop: item.checked };
        applyPreferencesToWindow(persistedState.preferences);
        persistStateNow();
        rebuildTrayMenu();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('prefs:changed', persistedState.preferences);
        }
      },
    },
    {
      label: 'Compact Mode',
      type: 'checkbox',
      checked: prefs.compactMode,
      click: (item) => {
        persistedState.preferences = { ...persistedState.preferences, compactMode: item.checked };
        persistStateNow();
        rebuildTrayMenu();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('prefs:changed', persistedState.preferences);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Antigravity Monitor',
      click: () => {
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function toggleWindowVisibility(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
  rebuildTrayMenu();
}

function createWindow(): void {
  const safeBounds = clampBoundsToDisplays(persistedState.bounds);
  const prefs = persistedState.preferences;
  nativeTheme.themeSource = prefs.themePreference;
  const appIcon = createAppIcon();

  mainWindow = new BrowserWindow({
    x: safeBounds.x,
    y: safeBounds.y,
    width: safeBounds.width,
    height: safeBounds.height,
    minWidth: 310,
    minHeight: 160,
    frame: false,
    resizable: true,
    alwaysOnTop: prefs.alwaysOnTop,
    skipTaskbar: false,
    show: false,
    icon: getAppIconPath(),
    backgroundColor: resolveRendererBackground(prefs.themePreference),
    opacity: prefs.opacity,
    title: 'Antigravity Sessions',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }
  mainWindow.setAlwaysOnTop(prefs.alwaysOnTop, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(prefs.alwaysOnTop, { visibleOnFullScreen: true });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    pushSnapshot(true);
  });

  mainWindow.on('move', scheduleBoundsSave);
  mainWindow.on('resize', scheduleBoundsSave);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    const indexHtml = path.join(app.getAppPath(), 'dist', 'index.html');
    void mainWindow.loadFile(indexHtml);
  }
}

function setupIpc(): void {
  ipcMain.handle('monitor:get-snapshot', () => {
    const snapshot = computeSnapshot();
    updateTrayStatus(snapshot);
    lastSnapshotSignature = buildSignature(snapshot);
    return snapshot;
  });

  ipcMain.handle('prefs:get', () => persistedState.preferences);

  ipcMain.handle('prefs:update', (_event, patch: Partial<WindowPreferences>) => {
    const prevIncludeCli = persistedState.preferences.includeCli;
    persistedState.preferences = {
      ...persistedState.preferences,
      ...patch,
      opacity:
        typeof patch.opacity === 'number'
          ? Math.min(1, Math.max(0.65, patch.opacity))
          : persistedState.preferences.opacity,
    };
    applyPreferencesToWindow(persistedState.preferences);
    persistStateNow();
    rebuildTrayMenu();

    if (prevIncludeCli !== persistedState.preferences.includeCli) {
      setupWatchers();
      pushSnapshot(true);
    }

    return persistedState.preferences;
  });

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:hide', () => {
    mainWindow?.hide();
    rebuildTrayMenu();
  });

  ipcMain.handle('window:close', () => {
    app.quit();
  });

  ipcMain.handle('shell:open-path', async (_event, targetPath: string): Promise<ActionResult> => {
    if (!targetPath || !fs.existsSync(targetPath)) {
      return { ok: false, error: `Path does not exist: ${targetPath}` };
    }
    const errMsg = await shell.openPath(targetPath);
    if (errMsg) {
      return { ok: false, error: errMsg };
    }
    return { ok: true };
  });

  ipcMain.handle('shell:reveal-file', (_event, targetPath: string): ActionResult => {
    if (!targetPath || !fs.existsSync(targetPath)) {
      return { ok: false, error: `File does not exist: ${targetPath}` };
    }
    shell.showItemInFolder(targetPath);
    return { ok: true };
  });

  ipcMain.handle('clipboard:write', (_event, text: string): ActionResult => {
    try {
      clipboard.writeText(text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.desmond.antigravity-monitor');
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    stateFilePath = path.join(app.getPath('userData'), 'window-state.json');
    persistedState = loadPersistedState(stateFilePath);

    setupIpc();
    createWindow();

    tray = new Tray(createTrayIcon(false, false));
    tray.setToolTip('Antigravity Monitor');
    tray.on('click', () => toggleWindowVisibility());
    rebuildTrayMenu();

    setupWatchers();
    pollTimer = setInterval(() => {
      pushSnapshot(false);
    }, POLL_INTERVAL_MS);

    nativeTheme.on('updated', () => {
      if (persistedState.preferences.themePreference === 'system') {
        applyPreferencesToWindow(persistedState.preferences);
      }
    });
  });

  app.on('before-quit', () => {
    if (pollTimer) clearInterval(pollTimer);
    if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
    if (boundsDebounceTimer) clearTimeout(boundsDebounceTimer);
    closeWatchers();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const b = mainWindow.getBounds();
      persistedState.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      persistStateNow();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
