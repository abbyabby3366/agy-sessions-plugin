import fs from 'node:fs';
import path from 'node:path';
import type { WindowPreferences } from '../shared/types.js';

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface PersistedState {
  version?: number;
  preferences: WindowPreferences;
  bounds: WindowBounds;
}

const CURRENT_STATE_VERSION = 2;

export const DEFAULT_PREFERENCES: WindowPreferences = {
  alwaysOnTop: true,
  compactMode: false,
  showIdleRecent: true,
  includeCli: true,
  sortMode: 'duration',
  themePreference: 'system',
  opacity: 0.96,
};

export const DEFAULT_BOUNDS: WindowBounds = {
  width: 410,
  height: 560,
};

function sanitizePreferences(raw: unknown): WindowPreferences {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const opacityRaw = typeof obj.opacity === 'number' ? obj.opacity : DEFAULT_PREFERENCES.opacity;
  const opacity = Math.min(1, Math.max(0.65, opacityRaw));
  const themePref =
    obj.themePreference === 'light' ||
    obj.themePreference === 'dark' ||
    obj.themePreference === 'system'
      ? obj.themePreference
      : DEFAULT_PREFERENCES.themePreference;
  const sortMode =
    obj.sortMode === 'duration' ||
    obj.sortMode === 'action_needed' ||
    obj.sortMode === 'activity'
      ? obj.sortMode
      : DEFAULT_PREFERENCES.sortMode;

  return {
    alwaysOnTop:
      typeof obj.alwaysOnTop === 'boolean' ? obj.alwaysOnTop : DEFAULT_PREFERENCES.alwaysOnTop,
    compactMode:
      typeof obj.compactMode === 'boolean' ? obj.compactMode : DEFAULT_PREFERENCES.compactMode,
    showIdleRecent:
      typeof obj.showIdleRecent === 'boolean'
        ? obj.showIdleRecent
        : DEFAULT_PREFERENCES.showIdleRecent,
    includeCli:
      typeof obj.includeCli === 'boolean' ? obj.includeCli : DEFAULT_PREFERENCES.includeCli,
    sortMode,
    themePreference: themePref,
    opacity,
  };
}

function sanitizeBounds(raw: unknown): WindowBounds {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const width =
    typeof obj.width === 'number' && obj.width >= 300 && obj.width <= 1200
      ? Math.round(obj.width)
      : DEFAULT_BOUNDS.width;
  const height =
    typeof obj.height === 'number' && obj.height >= 160 && obj.height <= 1400
      ? Math.round(obj.height)
      : DEFAULT_BOUNDS.height;

  const bounds: WindowBounds = { width, height };
  if (typeof obj.x === 'number' && Number.isFinite(obj.x)) bounds.x = Math.round(obj.x);
  if (typeof obj.y === 'number' && Number.isFinite(obj.y)) bounds.y = Math.round(obj.y);
  return bounds;
}

export function loadPersistedState(stateFilePath: string): PersistedState {
  if (!fs.existsSync(stateFilePath)) {
    return {
      version: CURRENT_STATE_VERSION,
      preferences: { ...DEFAULT_PREFERENCES },
      bounds: { ...DEFAULT_BOUNDS },
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8')) as Record<string, unknown>;
    const version = typeof raw.version === 'number' ? raw.version : 1;
    const preferences = sanitizePreferences(raw.preferences);
    if (version < CURRENT_STATE_VERSION) {
      preferences.showIdleRecent = true;
    }
    return {
      version: CURRENT_STATE_VERSION,
      preferences,
      bounds: sanitizeBounds(raw.bounds),
    };
  } catch (err) {
    console.error('[sticky-monitor] Failed to parse saved window state:', err);
    return {
      version: CURRENT_STATE_VERSION,
      preferences: { ...DEFAULT_PREFERENCES },
      bounds: { ...DEFAULT_BOUNDS },
    };
  }
}

export function savePersistedState(stateFilePath: string, state: PersistedState): void {
  fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
  fs.writeFileSync(
    stateFilePath,
    JSON.stringify({ ...state, version: CURRENT_STATE_VERSION }, null, 2),
    'utf-8'
  );
}
