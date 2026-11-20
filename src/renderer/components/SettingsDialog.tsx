import React, { useEffect, useRef } from 'react';
import type { SortMode, StickyMode, WindowPreferences } from '../../shared/types.js';
import { CloseIcon, HideTrayIcon } from './Icons.js';

interface SettingsDialogProps {
  open: boolean;
  preferences: WindowPreferences;
  onUpdate: (patch: Partial<WindowPreferences>) => void;
  onHideToTray: () => void;
  onClose: () => void;
}

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'action_needed', label: 'Action' },
  { value: 'duration', label: 'Longest' },
  { value: 'activity', label: 'Recent' },
];

const STICKY_OPTIONS: Array<{ value: StickyMode; label: string }> = [
  { value: 'on_question', label: 'Alerts' },
  { value: 'always', label: 'Always' },
  { value: 'off', label: 'Off' },
];

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  preferences,
  onUpdate,
  onHideToTray,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="settings-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
    >
      <div className="dialog-header">
        <h2 id="settings-dialog-title" className="dialog-title">
          Settings
        </h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close settings"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="dialog-body">
        <div className="setting-row">
          <div>
            <span className="setting-label">Sort Active Runs</span>
            <span className="setting-hint">Order in the main list</span>
          </div>
          <div className="segmented-group" role="group" aria-label="Sort active runs">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="segmented-btn"
                aria-pressed={preferences.sortMode === opt.value}
                onClick={() => onUpdate({ sortMode: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div>
            <span className="setting-label">Sticky on Top</span>
            <span className="setting-hint">Pin on questions or unread</span>
          </div>
          <div className="segmented-group" role="group" aria-label="Sticky on top mode">
            {STICKY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="segmented-btn"
                aria-pressed={preferences.stickyMode === opt.value}
                onClick={() => onUpdate({ stickyMode: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="setting-row" htmlFor="setting-compact">
          <div>
            <span className="setting-label">Compact Mode</span>
            <span className="setting-hint">Single-line conversation rows</span>
          </div>
          <input
            id="setting-compact"
            type="checkbox"
            checked={preferences.compactMode}
            onChange={(e) => onUpdate({ compactMode: e.target.checked })}
          />
        </label>

        <label className="setting-row" htmlFor="setting-recent-idle">
          <div>
            <span className="setting-label">Show Last 10 Idle Summary</span>
            <span className="setting-hint">Collapsible footer summary</span>
          </div>
          <input
            id="setting-recent-idle"
            type="checkbox"
            checked={preferences.showIdleRecent}
            onChange={(e) => onUpdate({ showIdleRecent: e.target.checked })}
          />
        </label>

        <label className="setting-row" htmlFor="setting-cli">
          <div>
            <span className="setting-label">Include CLI (agy)</span>
            <span className="setting-hint">Monitor ~/.gemini/antigravity-cli</span>
          </div>
          <input
            id="setting-cli"
            type="checkbox"
            checked={preferences.includeCli}
            onChange={(e) => onUpdate({ includeCli: e.target.checked })}
          />
        </label>

        <div className="setting-row">
          <div>
            <span className="setting-label">Appearance</span>
            <span className="setting-hint">Theme mode</span>
          </div>
          <div className="segmented-group" role="group" aria-label="Theme preference">
            {(['system', 'light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className="segmented-btn"
                aria-pressed={preferences.themePreference === mode}
                onClick={() => onUpdate({ themePreference: mode })}
              >
                {mode === 'system' ? 'Auto' : mode === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>

        <label className="setting-row" htmlFor="setting-opacity">
          <div>
            <span className="setting-label">Window Opacity</span>
            <span className="setting-hint">
              {Math.round(preferences.opacity * 100)}%
            </span>
          </div>
          <input
            id="setting-opacity"
            className="range-input"
            type="range"
            min={0.65}
            max={1}
            step={0.05}
            value={preferences.opacity}
            onChange={(e) => onUpdate({ opacity: Number(e.target.value) })}
          />
        </label>

        <div className="dialog-footer">
          <button
            type="button"
            className="action-btn"
            onClick={() => {
              onClose();
              onHideToTray();
            }}
          >
            <HideTrayIcon />
            Hide to System Tray
          </button>
        </div>
      </div>
    </dialog>
  );
};
