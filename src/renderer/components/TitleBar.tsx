import React from 'react';
import type { WindowPreferences } from '../../shared/types.js';
import {
  CloseIcon,
  CompactIcon,
  HideTrayIcon,
  MinimizeIcon,
  PinIcon,
  SettingsIcon,
} from './Icons.js';

interface TitleBarProps {
  runningCount: number;
  waitingCount: number;
  preferences: WindowPreferences;
  onTogglePin: () => void;
  onToggleCompact: () => void;
  onOpenSettings: () => void;
  onMinimize: () => void;
  onHideToTray: () => void;
  onClose: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  runningCount,
  waitingCount,
  preferences,
  onTogglePin,
  onToggleCompact,
  onOpenSettings,
  onMinimize,
  onHideToTray,
  onClose,
}) => {
  const brandState =
    waitingCount > 0 ? 'waiting' : runningCount > 0 ? 'running' : 'idle';

  return (
    <header className="titlebar">
      <div className="titlebar-identity">
        <span className="brand-mark" data-state={brandState} aria-hidden="true" />
        <h1 className="app-title">Antigravity</h1>
        <span
          className="count-pill"
          data-active={runningCount > 0}
          aria-label={`${runningCount} active conversations`}
        >
          {runningCount}
        </span>
        {waitingCount > 0 && (
          <span
            className="count-pill"
            data-waiting="true"
            aria-label={`${waitingCount} waiting for input`}
          >
            {waitingCount} input
          </span>
        )}
      </div>

      <div className="titlebar-actions">
        <button
          type="button"
          className="icon-btn"
          aria-pressed={preferences.alwaysOnTop}
          aria-label={
            preferences.alwaysOnTop ? 'Unpin always on top' : 'Pin always on top'
          }
          title={preferences.alwaysOnTop ? 'Pinned on top' : 'Pin on top'}
          onClick={onTogglePin}
        >
          <PinIcon pinned={preferences.alwaysOnTop} />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-pressed={preferences.compactMode}
          aria-label={
            preferences.compactMode ? 'Switch to standard view' : 'Switch to compact view'
          }
          title={preferences.compactMode ? 'Standard density' : 'Compact density'}
          onClick={onToggleCompact}
        >
          <CompactIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="Open monitor settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <SettingsIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="Hide to system tray"
          title="Hide to tray"
          onClick={onHideToTray}
        >
          <HideTrayIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="Minimize window"
          title="Minimize"
          onClick={onMinimize}
        >
          <MinimizeIcon />
        </button>

        <button
          type="button"
          className="icon-btn danger"
          aria-label="Quit Antigravity Monitor"
          title="Quit"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
};
