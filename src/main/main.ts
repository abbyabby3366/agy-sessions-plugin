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
import {
  isQuestionOverdue,
  resolveAlwaysOnTop,
  resolveStickyTransition,
  type AutoReturnAction,
} from '../shared/status.js';
import {
  loadPersistedState,
  savePersistedState,
  type PersistedState,
  type WindowBounds,
} from './preferences.js';
import { createAppIcon, createTrayIcon, getAppIconPath } from './trayIcon.js';
import { launchAntigravityApp, launchAntigravityIde } from './ideLauncher.js';
import { fetchModelQuota } from './quotaReader.js';
import type { ActionResult, MonitorSnapshot, QuotaState, WindowPreferences } from '../shared/types.js';

const POLL_INTERVAL_MS = 1500;
const WATCH_DEBOUNCE_MS = 220;
const QUOTA_POLL_INTERVAL_MS = 60_000;
const QUOTA_RUN_COMPLETE_MIN_GAP_MS = 15_000;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let persistedState: PersistedState;
let stateFilePath = '';
let pollTimer: NodeJS.Timeout | null = null;
let quotaTimer: NodeJS.Timeout | null = null;
let watchDebounceTimer: NodeJS.Timeout | null = null;
let boundsDebounceTimer: NodeJS.Timeout | null = null;
const activeWatchers: fs.FSWatcher[] = [];
let lastSnapshotSignature = '';
let lastTraySignature = '';
let latestSnapshot: MonitorSnapshot | null = null;
let latestQuota: QuotaState = { status: 'loading' };
let quotaInFlight: Promise<QuotaState> | null = null;
let lastQuotaFetchStartedMs = 0;
let prevRunningIds = new Set<string>();
let appliedAlwaysOnTop: boolean | null = null;
let autoReturnAction: AutoReturnAction = null;
let isProgrammaticHeightChange = false;

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
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    isProgrammaticHeightChange ||
    mainWindow.isMinimized()
  ) {
    return;
  }
  if (boundsDebounceTimer) clearTimeout(boundsDebounceTimer);
  boundsDebounceTimer = setTimeout(() => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      isProgrammaticHeightChange ||
      mainWindow.isMinimized()
    ) {
      return;
    }
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
  const unreadCount = snapshot.unread.length;
  const waitingCount = snapshot.running.filter((c) => c.phase === 'waiting_input').length;
  const stalledCount = snapshot.running.filter((c) => c.phase === 'stalled').length;
  const overdueCount = snapshot.running.filter((c) => isQuestionOverdue(c, nowMs)).length;
  const sig = `${runningCount}:${unreadCount}:${waitingCount}:${stalledCount}:${overdueCount}`;

  if (sig !== lastTraySignature) {
    lastTraySignature = sig;
    tray.setImage(
      createTrayIcon(
        runningCount > 0,
        waitingCount > 0 || stalledCount > 0 || unreadCount > 0,
        overdueCount > 0
      )
    );
    const unreadSuffix = unreadCount > 0 ? `, ${unreadCount} unread` : '';
    const tooltip =
      runningCount === 0
        ? unreadCount > 0
          ? `Antigravity Sessions — ${unreadCount} unread finished`
          : 'Antigravity Sessions — Idle'
        : overdueCount > 0
          ? `Antigravity Sessions — ${runningCount} active (${overdueCount} question >5m!${unreadSuffix})`
          : waitingCount > 0
            ? `Antigravity Sessions — ${runningCount} active (${waitingCount} waiting input${unreadSuffix})`
            : stalledCount > 0
              ? `Antigravity Sessions — ${runningCount} active (${stalledCount} stalled${unreadSuffix})`
              : unreadCount > 0
                ? `Antigravity Sessions — ${runningCount} active, ${unreadCount} unread`
                : `Antigravity Sessions — ${runningCount} active`;
    tray.setToolTip(tooltip);
  }
}

function computeSnapshot(): MonitorSnapshot {
  return readMonitorSnapshot({
    includeCli: persistedState.preferences.includeCli,
    dismissedUnread: persistedState.dismissedUnread,
  });
}

function buildSignature(snapshot: MonitorSnapshot): string {
  return JSON.stringify({
    running: snapshot.running,
    unread: snapshot.unread,
    recentIdle: snapshot.recentIdle,
    sources: snapshot.sources,
  });
}

function syncStickyOnTop(
  prefs: WindowPreferences,
  snapshot: MonitorSnapshot | null,
  options?: { isPreferenceChange?: boolean }
): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const nextOnTop = snapshot
    ? resolveAlwaysOnTop(prefs.stickyMode, snapshot.running, snapshot.unread)
    : prefs.stickyMode === 'always';

  const effect = resolveStickyTransition({
    stickyMode: prefs.stickyMode,
    prevOnTop: appliedAlwaysOnTop,
    nextOnTop,
    prevAutoReturn: autoReturnAction,
    windowState: {
      isVisible: mainWindow.isVisible(),
      isMinimized: mainWindow.isMinimized(),
      isFocused: mainWindow.isFocused(),
    },
    isPreferenceChange: options?.isPreferenceChange === true,
  });

  autoReturnAction = effect.nextAutoReturn;
  if (effect.setAlwaysOnTop !== null) {
    appliedAlwaysOnTop = effect.setAlwaysOnTop;
  }

  switch (effect.windowAction) {
    case 'show_inactive':
    case 'restore_inactive':
      mainWindow.showInactive();
      if (effect.setAlwaysOnTop !== null) {
        mainWindow.setAlwaysOnTop(effect.setAlwaysOnTop, 'floating');
        mainWindow.setVisibleOnAllWorkspaces(effect.setAlwaysOnTop, {
          visibleOnFullScreen: true,
        });
      }
      mainWindow.moveTop();
      rebuildTrayMenu();
      break;
    case 'move_top':
      if (effect.setAlwaysOnTop !== null) {
        mainWindow.setAlwaysOnTop(effect.setAlwaysOnTop, 'floating');
        mainWindow.setVisibleOnAllWorkspaces(effect.setAlwaysOnTop, {
          visibleOnFullScreen: true,
        });
      }
      mainWindow.moveTop();
      break;
    case 'minimize':
      if (effect.setAlwaysOnTop !== null) {
        mainWindow.setAlwaysOnTop(effect.setAlwaysOnTop, 'floating');
        mainWindow.setVisibleOnAllWorkspaces(effect.setAlwaysOnTop, {
          visibleOnFullScreen: true,
        });
      }
      mainWindow.minimize();
      break;
    case 'hide':
      if (effect.setAlwaysOnTop !== null) {
        mainWindow.setAlwaysOnTop(effect.setAlwaysOnTop, 'floating');
        mainWindow.setVisibleOnAllWorkspaces(effect.setAlwaysOnTop, {
          visibleOnFullScreen: true,
        });
      }
      mainWindow.hide();
      rebuildTrayMenu();
      break;
    case 'none':
      if (effect.setAlwaysOnTop !== null) {
        mainWindow.setAlwaysOnTop(effect.setAlwaysOnTop, 'floating');
        mainWindow.setVisibleOnAllWorkspaces(effect.setAlwaysOnTop, {
          visibleOnFullScreen: true,
        });
      }
      break;
  }
}

function refreshQuota(): Promise<QuotaState> {
  if (quotaInFlight) return quotaInFlight;
  lastQuotaFetchStartedMs = Date.now();
  quotaInFlight = fetchModelQuota()
    .then((nextQuota) => {
      latestQuota = nextQuota;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('quota:snapshot', nextQuota);
      }
      return nextQuota;
    })
    .finally(() => {
      quotaInFlight = null;
    });
  return quotaInFlight;
}

function pushSnapshot(force = false): MonitorSnapshot {
  const snapshot = computeSnapshot();
  latestSnapshot = snapshot;
  updateTrayStatus(snapshot);
  syncStickyOnTop(persistedState.preferences, snapshot);

  const currIds = new Set(snapshot.running.map((c) => c.conversationId));
  let finishedRun = false;
  for (const prevId of prevRunningIds) {
    if (!currIds.has(prevId)) {
      finishedRun = true;
      break;
    }
  }
  prevRunningIds = currIds;
  if (
    finishedRun &&
    !quotaInFlight &&
    Date.now() - lastQuotaFetchStartedMs >= QUOTA_RUN_COMPLETE_MIN_GAP_MS
  ) {
    void refreshQuota();
  }

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

  const schedulePush = () => {
    if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
    watchDebounceTimer = setTimeout(() => {
      pushSnapshot(false);
    }, WATCH_DEBOUNCE_MS);
  };

  for (const src of sources) {
    if (!fs.existsSync(src.dirPath)) continue;
    try {
      const watcher = fs.watch(src.dirPath, (_eventType, filename) => {
        if (!filename || filename.startsWith('conversation_summaries.db')) {
          schedulePush();
        }
      });
      activeWatchers.push(watcher);
    } catch (err) {
      console.error(`[sticky-monitor] Watch error for ${src.dirPath}:`, err);
    }

    const annotationsDir = path.join(src.dirPath, 'annotations');
    if (fs.existsSync(annotationsDir)) {
      try {
        const annWatcher = fs.watch(annotationsDir, (_eventType, filename) => {
          if (!filename || filename.endsWith('.pbtxt')) {
            schedulePush();
          }
        });
        activeWatchers.push(annWatcher);
      } catch (err) {
        console.error(`[sticky-monitor] Watch error for ${annotationsDir}:`, err);
      }
    }
  }
}

function applyPreferencesToWindow(prefs: WindowPreferences): void {
  nativeTheme.themeSource = prefs.themePreference;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  syncStickyOnTop(prefs, latestSnapshot, { isPreferenceChange: true });
  mainWindow.setOpacity(prefs.opacity);
  mainWindow.setBackgroundColor(resolveRendererBackground(prefs.themePreference));
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const prefs = persistedState.preferences;
  const setSticky = (stickyMode: WindowPreferences['stickyMode']) => {
    persistedState.preferences = { ...persistedState.preferences, stickyMode };
    applyPreferencesToWindow(persistedState.preferences);
    persistStateNow();
    rebuildTrayMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('prefs:changed', persistedState.preferences);
    }
  };

  const menu = Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? 'Hide Widget' : 'Show Widget',
      click: () => toggleWindowVisibility(),
    },
    { type: 'separator' },
    {
      label: 'Sticky on Top',
      submenu: [
        {
          label: 'Question or Unread',
          type: 'radio',
          checked: prefs.stickyMode === 'on_question',
          click: () => setSticky('on_question'),
        },
        {
          label: 'Always',
          type: 'radio',
          checked: prefs.stickyMode === 'always',
          click: () => setSticky('always'),
        },
        {
          label: 'Off',
          type: 'radio',
          checked: prefs.stickyMode === 'off',
          click: () => setSticky('off'),
        },
      ],
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
      label: 'Quit Antigravity Sessions',
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

  const initialOnTop = prefs.stickyMode === 'always';
  mainWindow = new BrowserWindow({
    x: safeBounds.x,
    y: safeBounds.y,
    width: safeBounds.width,
    height: safeBounds.height,
    minWidth: 310,
    minHeight: 110,
    frame: false,
    resizable: true,
    alwaysOnTop: initialOnTop,
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
  appliedAlwaysOnTop = null;
  autoReturnAction = null;
  mainWindow.setAlwaysOnTop(initialOnTop, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(initialOnTop, { visibleOnFullScreen: true });

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
    latestSnapshot = snapshot;
    prevRunningIds = new Set(snapshot.running.map((c) => c.conversationId));
    updateTrayStatus(snapshot);
    syncStickyOnTop(persistedState.preferences, snapshot);
    lastSnapshotSignature = buildSignature(snapshot);
    return snapshot;
  });

  ipcMain.handle('quota:get', () => latestQuota);

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

  ipcMain.handle('window:set-content-height', (_event, desiredHeight: number) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    if (!Number.isFinite(desiredHeight)) return;
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const maxHeight = Math.min(620, Math.max(240, display.workArea.height - 40));
    const targetHeight = Math.round(Math.min(maxHeight, Math.max(110, desiredHeight)));
    const targetWidth = persistedState.bounds.width;
    if (Math.abs(bounds.height - targetHeight) <= 1 && Math.abs(bounds.width - targetWidth) <= 1) {
      return;
    }
    const maxY = display.workArea.y + display.workArea.height - targetHeight;
    const clampedY = Math.min(bounds.y, Math.max(display.workArea.y, maxY));
    isProgrammaticHeightChange = true;
    try {
      if (clampedY !== bounds.y) {
        mainWindow.setBounds({
          x: bounds.x,
          y: clampedY,
          width: targetWidth,
          height: targetHeight,
        });
      } else {
        mainWindow.setSize(targetWidth, targetHeight);
      }
    } finally {
      setImmediate(() => {
        isProgrammaticHeightChange = false;
      });
    }
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

  ipcMain.handle(
    'ide:open-workspace',
    (_event, workspacePath: string): Promise<ActionResult> => launchAntigravityIde(workspacePath)
  );

  ipcMain.handle('app:focus-antigravity', (): Promise<ActionResult> => launchAntigravityApp());

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

  ipcMain.handle(
    'monitor:mark-unread-read',
    (_event, conversationIds: string[]): ActionResult => {
      try {
        if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
          return { ok: true };
        }
        const now = Date.now();
        const cutoff = now - 2 * 60 * 60 * 1000;
        const nextDismissed: Record<string, number> = {};
        for (const [id, ts] of Object.entries(persistedState.dismissedUnread ?? {})) {
          if (ts > cutoff) {
            nextDismissed[id] = ts;
          }
        }
        for (const id of conversationIds) {
          if (typeof id === 'string' && id.trim().length > 0) {
            nextDismissed[id] = now;
          }
        }
        persistedState.dismissedUnread = nextDismissed;
        persistStateNow();
        pushSnapshot(true);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
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
    tray.setToolTip('Antigravity Sessions');
    tray.on('click', () => toggleWindowVisibility());
    rebuildTrayMenu();

    setupWatchers();
    void refreshQuota();
    pollTimer = setInterval(() => {
      pushSnapshot(false);
    }, POLL_INTERVAL_MS);
    quotaTimer = setInterval(() => {
      void refreshQuota();
    }, QUOTA_POLL_INTERVAL_MS);

    nativeTheme.on('updated', () => {
      if (persistedState.preferences.themePreference === 'system') {
        applyPreferencesToWindow(persistedState.preferences);
      }
    });
  });

  app.on('before-quit', () => {
    if (pollTimer) clearInterval(pollTimer);
    if (quotaTimer) clearInterval(quotaTimer);
    if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
    if (boundsDebounceTimer) clearTimeout(boundsDebounceTimer);
    closeWatchers();
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
      const b = mainWindow.getBounds();
      persistedState.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      persistStateNow();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
