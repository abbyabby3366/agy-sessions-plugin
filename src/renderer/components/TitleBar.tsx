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

export type HeaderSeverity = 'idle' | 'running' | 'warning' | 'overdue';

interface TitleBarProps {
  runningCount: number;
  severity: HeaderSeverity;
  statusSummary: string;
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
  severity,
  statusSummary,
  preferences,
  onTogglePin,
  onToggleCompact,
  onOpenSettings,
  onMinimize,
  onHideToTray,
  onClose,
}) => {
  return (
    <header className="titlebar">
      <div className="titlebar-identity">
        <span className="brand-mark" data-state={severity} aria-hidden="true" />
        <h1 className="app-title">Antigravity Sessions</h1>
        <span
          className="count-pill"
          data-state={severity}
          title={statusSummary}
          aria-label={statusSummary}
        >
          {runningCount}
        </span>
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
