import React, { useState } from 'react';
import { getQuestionWaitMs, isQuestionOverdue } from '../../shared/status.js';
import {
  formatDateTimeGMT8,
  formatElapsed,
  parseTimestampMs,
} from '../../shared/time.js';
import type { ActivityPhase, ConversationItem } from '../../shared/types.js';
import { CopyIcon, FileTextIcon, FolderIcon, StatusGlyph } from './Icons.js';

interface ConversationRowProps {
  item: ConversationItem;
  nowMs: number;
  compact: boolean;
  expanded: boolean;
  onToggleExpand: (conversationId: string) => void;
  onOpenPath: (targetPath: string) => Promise<void>;
  onRevealFile: (targetPath: string) => Promise<void>;
  onCopyId: (conversationId: string) => Promise<void>;
}

const PHASE_LABEL: Record<ActivityPhase, string> = {
  running: 'Running',
  waiting_input: 'Needs Input',
  stalled: 'Stalled',
  idle: 'Finished',
};

const LONG_RUN_THRESHOLD_MS = 10 * 60 * 1000;

function formatStepSummary(item: ConversationItem): string {
  const parts: string[] = [];
  if (item.lastToolName) {
    parts.push(item.lastToolName);
  } else if (item.lastStepType) {
    parts.push(item.lastStepType.toLowerCase().replace(/_/g, ' '));
  }
  if (item.stepCount > 0) {
    parts.push(`${item.stepCount} steps`);
  }
  if (item.activeSubagents.length > 0) {
    const count = item.activeSubagents.length;
    parts.push(`+${count} subagent${count === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

const StackedDateTime: React.FC<{ raw: string | null }> = ({ raw }) => {
  const formatted = formatDateTimeGMT8(raw);
  if (!formatted) {
    return <span className="stacked-dt-secondary">Unavailable</span>;
  }
  return (
    <div className="stacked-dt">
      <span className="stacked-dt-primary">{formatted.time}</span>
      <span className="stacked-dt-secondary">{formatted.date} (GMT+8)</span>
    </div>
  );
};

export const ConversationRow: React.FC<ConversationRowProps> = ({
  item,
  nowMs,
  compact,
  expanded,
  onToggleExpand,
  onOpenPath,
  onRevealFile,
  onCopyId,
}) => {
  const [copied, setCopied] = useState(false);

  const turnStartMs = parseTimestampMs(item.lastUserInputAt);
  const lastModMs = parseTimestampMs(item.lastModifiedAt);
  const chatStartMs = parseTimestampMs(item.startedAt);

  let elapsedText = '--:--';
  let elapsedMs = 0;

  if (item.phase === 'idle') {
    if (turnStartMs !== null && lastModMs !== null && lastModMs >= turnStartMs) {
      elapsedMs = lastModMs - turnStartMs;
      elapsedText = formatElapsed(elapsedMs);
    }
  } else if (turnStartMs !== null) {
    elapsedMs = Math.max(0, nowMs - turnStartMs);
    elapsedText = formatElapsed(elapsedMs);
  }

  let totalElapsedMs: number | null = null;
  if (chatStartMs !== null) {
    if (item.phase === 'idle') {
      if (lastModMs !== null && lastModMs >= chatStartMs) {
        totalElapsedMs = lastModMs - chatStartMs;
      }
    } else {
      totalElapsedMs = Math.max(0, nowMs - chatStartMs);
    }
  } else if (item.phase === 'idle' && turnStartMs !== null && lastModMs !== null && lastModMs >= turnStartMs) {
    totalElapsedMs = lastModMs - turnStartMs;
  } else if (item.phase !== 'idle' && turnStartMs !== null) {
    totalElapsedMs = Math.max(0, nowMs - turnStartMs);
  }

  const totalElapsedText = totalElapsedMs !== null ? formatElapsed(totalElapsedMs) : '--:--';

  const workspaceLabel =
    item.workspaceName ?? (item.nestingDepth > 0 ? 'Subagent' : 'No Workspace');
  const stepSummary = formatStepSummary(item);
  const isLongRun =
    item.phase === 'running' &&
    turnStartMs !== null &&
    elapsedMs >= LONG_RUN_THRESHOLD_MS;
  const waitMs = getQuestionWaitMs(item, nowMs);
  const overdueQuestion = isQuestionOverdue(item, nowMs);

  const handleCopy = async () => {
    await onCopyId(item.conversationId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li
      className="conv-item"
      data-expanded={expanded}
      data-phase={item.phase}
      data-overdue={overdueQuestion}
    >
      <button
        type="button"
        className="conv-trigger"
        aria-expanded={expanded}
        onClick={() => onToggleExpand(item.conversationId)}
      >
        <div className="conv-top-row">
          <div className="conv-workspace-wrap">
            <span
              className="status-indicator"
              data-phase={item.phase}
              data-overdue={overdueQuestion}
            >
              <StatusGlyph phase={item.phase} />
            </span>
            <span className="workspace-name">{workspaceLabel}</span>
            {item.source === 'cli' && <span className="source-tag">CLI</span>}
            {!compact && (
              <span
                className="phase-tag"
                data-phase={item.phase}
                data-overdue={overdueQuestion}
              >
                {overdueQuestion ? 'No Reply >5m' : PHASE_LABEL[item.phase]}
              </span>
            )}
            {compact && item.title && (
              <span className="compact-title">— {item.title}</span>
            )}
          </div>

          <span
            className="elapsed-timer"
            data-phase={item.phase}
            data-overdue={overdueQuestion}
            data-long={isLongRun}
            aria-label={`Elapsed since last prompt ${elapsedText}`}
          >
            {elapsedText}
          </span>
        </div>

        {!compact && (
          <div className="conv-sub-row">
            <span className="conv-title" data-missing={!item.title}>
              {item.title ?? `Pending title (${item.conversationId.slice(0, 8)})…`}
            </span>
            {stepSummary && <span className="conv-meta-inline">{stepSummary}</span>}
          </div>
        )}
      </button>

      {expanded && (
        <div className="conv-details">
          <table className="meta-table">
            <tbody>
              <tr>
                <th scope="row">Conversation</th>
                <td>
                  <code>{item.conversationId}</code>
                </td>
              </tr>
              <tr>
                <th scope="row">Turn Elapsed</th>
                <td>
                  <code className="elapsed-inline">{elapsedText}</code>
                </td>
              </tr>
              <tr>
                <th scope="row">Total Elapsed</th>
                <td>
                  <code className="elapsed-inline">{totalElapsedText}</code>
                </td>
              </tr>
              {waitMs !== null && (
                <tr>
                  <th scope="row">Waiting Reply</th>
                  <td>
                    <code
                      className="elapsed-inline"
                      data-overdue={overdueQuestion}
                    >
                      {formatElapsed(waitMs)}
                      {overdueQuestion ? ' (>5m overdue)' : ''}
                    </code>
                  </td>
                </tr>
              )}
              <tr>
                <th scope="row">Turn Started</th>
                <td>
                  <StackedDateTime raw={item.lastUserInputAt} />
                </td>
              </tr>
              <tr>
                <th scope="row">Last Activity</th>
                <td>
                  <StackedDateTime raw={item.lastModifiedAt} />
                </td>
              </tr>
              {item.startedAt && (
                <tr>
                  <th scope="row">Chat Created</th>
                  <td>
                    <StackedDateTime raw={item.startedAt} />
                  </td>
                </tr>
              )}
              <tr>
                <th scope="row">Workspace</th>
                <td>{item.workspacePath ?? 'None attached'}</td>
              </tr>
              {item.lastStepType && (
                <tr>
                  <th scope="row">Latest Step</th>
                  <td>
                    {item.lastStepType}
                    {item.lastStepStatus ? ` (${item.lastStepStatus})` : ''}
                    {item.lastToolName ? ` · ${item.lastToolName}` : ''}
                  </td>
                </tr>
              )}
              {item.activeSubagents.length > 0 && (
                <tr>
                  <th scope="row">Subagents</th>
                  <td>
                    <ul className="subagent-list" role="list">
                      {item.activeSubagents.map((sub) => {
                        const subStart = parseTimestampMs(sub.lastUserInputAt);
                        const subElapsed =
                          subStart !== null ? formatElapsed(Math.max(0, nowMs - subStart)) : '--:--';
                        return (
                          <li key={sub.conversationId} className="subagent-row">
                            <span>
                              {sub.title ?? `Subagent ${sub.conversationId.slice(0, 8)}`}
                            </span>
                            <span className="subagent-timer">{subElapsed}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="detail-actions">
            <button type="button" className="action-btn" onClick={() => void handleCopy()}>
              <CopyIcon />
              {copied ? 'Copied ID' : 'Copy ID'}
            </button>

            <button
              type="button"
              className="action-btn"
              disabled={!item.workspacePath}
              onClick={() => {
                if (item.workspacePath) {
                  void onOpenPath(item.workspacePath);
                }
              }}
            >
              <FolderIcon />
              Workspace
            </button>

            <button
              type="button"
              className="action-btn"
              disabled={!item.transcriptPath}
              title="Show transcript.jsonl in Explorer"
              onClick={() => {
                if (item.transcriptPath) {
                  void onRevealFile(item.transcriptPath);
                }
              }}
            >
              <FileTextIcon />
              Transcript
            </button>
          </div>
        </div>
      )}
    </li>
  );
};
