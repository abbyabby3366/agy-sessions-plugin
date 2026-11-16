import React from 'react';
import { CloseIcon, MinimizeIcon, SettingsIcon } from './Icons.js';

export type HeaderSeverity = 'idle' | 'running' | 'warning' | 'overdue';

interface TitleBarProps {
  runningCount: number;
  severity: HeaderSeverity;
  statusSummary: string;
  onOpenSettings: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  runningCount,
  severity,
  statusSummary,
  onOpenSettings,
  onMinimize,
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
          aria-label="Open settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <SettingsIcon />
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
          aria-label="Quit Antigravity Sessions"
          title="Quit"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
};
