import React, { useEffect, useId, useRef, useState } from 'react';
import { formatDateTimeGMT8 } from '../../shared/time.js';
import type { QuotaState } from '../../shared/types.js';
import { CloseIcon, MinimizeIcon, SettingsIcon } from './Icons.js';

export type HeaderSeverity = 'idle' | 'running' | 'unread' | 'warning' | 'overdue';

interface TitleBarProps {
  runningCount: number;
  severity: HeaderSeverity;
  statusSummary: string;
  quota: QuotaState;
  onOpenSettings: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

type QuotaLevel = 'normal' | 'low' | 'critical';

function getQuotaLevel(pct: number): QuotaLevel {
  if (pct <= 10) return 'critical';
  if (pct <= 25) return 'low';
  return 'normal';
}

const QuotaResetCell: React.FC<{ iso: string | null }> = ({ iso }) => {
  const formatted = formatDateTimeGMT8(iso);
  if (!formatted) {
    return <span className="quota-reset-missing">—</span>;
  }
  return (
    <div className="stacked-dt">
      <span className="stacked-dt-primary">{formatted.date}</span>
      <span className="stacked-dt-secondary">{formatted.time.slice(0, 5)}</span>
    </div>
  );
};

export const TitleBar: React.FC<TitleBarProps> = ({
  runningCount,
  severity,
  statusSummary,
  quota,
  onOpenSettings,
  onMinimize,
  onClose,
}) => {
  const rawId = useId();
  const safeId = rawId.replace(/:/g, '');
  const popoverId = `quota-popover-${safeId}`;
  const anchorStyle = { '--quota-anchor': `--quota-${safeId}` } as React.CSSProperties;

  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const handleToggle = (event: Event) => {
      const next = (event as ToggleEvent).newState === 'open';
      setPopoverOpen(next);
    };
    el.addEventListener('toggle', handleToggle);
    return () => el.removeEventListener('toggle', handleToggle);
  }, [quota.status]);

  const geminiLevel =
    quota.status === 'ok' ? getQuotaLevel(quota.gemini.weeklyRemainingPct) : 'normal';
  const thirdPartyLevel =
    quota.status === 'ok' ? getQuotaLevel(quota.thirdParty.weeklyRemainingPct) : 'normal';

  const quotaAriaLabel =
    quota.status === 'ok'
      ? `Weekly quota remaining: Gemini ${quota.gemini.weeklyRemainingPct} percent, Claude and GPT ${quota.thirdParty.weeklyRemainingPct} percent. Press for reset details.`
      : quota.status === 'error'
        ? `Quota read error: ${quota.error}`
        : undefined;

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

        {quota.status === 'ok' && (
          <>
            <button
              type="button"
              className="quota-pill"
              style={anchorStyle}
              popoverTarget={popoverId}
              popoverTargetAction="toggle"
              aria-expanded={popoverOpen}
              aria-label={quotaAriaLabel}
            >
              <span className="quota-pair">
                <span className="quota-key">G</span>
                <span className="quota-val" data-level={geminiLevel}>
                  {quota.gemini.weeklyRemainingPct}%
                </span>
              </span>
              <span className="quota-sep" aria-hidden="true">
                ·
              </span>
              <span className="quota-pair">
                <span className="quota-key">C</span>
                <span className="quota-val" data-level={thirdPartyLevel}>
                  {quota.thirdParty.weeklyRemainingPct}%
                </span>
              </span>
            </button>

            <div
              ref={popoverRef}
              id={popoverId}
              popover="auto"
              role="region"
              aria-label="Weekly model quota breakdown"
              className="quota-popover"
              style={anchorStyle}
            >
              <table className="quota-table">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Week</th>
                    <th scope="col">5h</th>
                    <th scope="col">Reset (GMT+8)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Gemini</th>
                    <td className="quota-num" data-level={geminiLevel}>
                      {quota.gemini.weeklyRemainingPct}%
                    </td>
                    <td className="quota-num">
                      {quota.gemini.fiveHourRemainingPct !== null
                        ? `${quota.gemini.fiveHourRemainingPct}%`
                        : '—'}
                    </td>
                    <td>
                      <QuotaResetCell iso={quota.gemini.weeklyResetAt} />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Claude/GPT</th>
                    <td className="quota-num" data-level={thirdPartyLevel}>
                      {quota.thirdParty.weeklyRemainingPct}%
                    </td>
                    <td className="quota-num">
                      {quota.thirdParty.fiveHourRemainingPct !== null
                        ? `${quota.thirdParty.fiveHourRemainingPct}%`
                        : '—'}
                    </td>
                    <td>
                      <QuotaResetCell iso={quota.thirdParty.weeklyResetAt} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {quota.status === 'error' && (
          <span
            className="quota-pill"
            data-state="error"
            title={quota.error}
            aria-label={quotaAriaLabel}
          >
            Quota !
          </span>
        )}
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
