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
  dismissedUnread?: Record<string, number>;
}

const CURRENT_STATE_VERSION = 5;

export const DEFAULT_PREFERENCES: WindowPreferences = {
  stickyMode: 'on_question',
  compactMode: false,
  showIdleRecent: true,
  idleExpanded: false,
  includeCli: true,
  sortMode: 'action_needed',
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
  const stickyMode =
    obj.stickyMode === 'on_question' ||
    obj.stickyMode === 'always' ||
    obj.stickyMode === 'off'
      ? obj.stickyMode
      : DEFAULT_PREFERENCES.stickyMode;

  return {
    stickyMode,
    compactMode:
      typeof obj.compactMode === 'boolean' ? obj.compactMode : DEFAULT_PREFERENCES.compactMode,
    showIdleRecent:
      typeof obj.showIdleRecent === 'boolean'
        ? obj.showIdleRecent
        : DEFAULT_PREFERENCES.showIdleRecent,
    idleExpanded:
      typeof obj.idleExpanded === 'boolean'
        ? obj.idleExpanded
        : DEFAULT_PREFERENCES.idleExpanded,
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

function sanitizeDismissedUnread(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const out: Record<string, number> = {};
  for (const [id, ts] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof ts === 'number' && Number.isFinite(ts) && ts > cutoff) {
      out[id] = ts;
    }
  }
  return out;
}

export function loadPersistedState(stateFilePath: string): PersistedState {
  if (!fs.existsSync(stateFilePath)) {
    return {
      version: CURRENT_STATE_VERSION,
      preferences: { ...DEFAULT_PREFERENCES },
      bounds: { ...DEFAULT_BOUNDS },
      dismissedUnread: {},
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8')) as Record<string, unknown>;
    const version = typeof raw.version === 'number' ? raw.version : 1;
    const preferences = sanitizePreferences(raw.preferences);
    if (version < 2) {
      preferences.showIdleRecent = true;
    }
    if (version < 3) {
      preferences.idleExpanded = false;
    }
    if (version < 4) {
      preferences.stickyMode = 'on_question';
    }
    if (version < 5) {
      preferences.sortMode = 'action_needed';
    }
    return {
      version: CURRENT_STATE_VERSION,
      preferences,
      bounds: sanitizeBounds(raw.bounds),
      dismissedUnread: sanitizeDismissedUnread(raw.dismissedUnread),
    };
  } catch (err) {
    console.error('[sticky-monitor] Failed to parse saved window state:', err);
    return {
      version: CURRENT_STATE_VERSION,
      preferences: { ...DEFAULT_PREFERENCES },
      bounds: { ...DEFAULT_BOUNDS },
      dismissedUnread: {},
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
