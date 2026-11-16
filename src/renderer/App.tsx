import React, { useEffect, useMemo, useState } from 'react';
import { isQuestionOverdue, sortConversations } from '../shared/status.js';
import { formatElapsed, parseTimestampMs } from '../shared/time.js';
import type {
  ConversationItem,
  MonitorSnapshot,
  SortMode,
  WindowPreferences,
} from '../shared/types.js';
import { ConversationRow } from './components/ConversationRow.js';
import { AlertIcon, SortIcon } from './components/Icons.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { TitleBar, type HeaderSeverity } from './components/TitleBar.js';

const SORT_LABELS: Record<SortMode, string> = {
  duration: 'Longest first',
  action_needed: 'Action needed',
  activity: 'Recent step',
};

const SORT_CYCLE: SortMode[] = ['duration', 'action_needed', 'activity'];

const INITIAL_PREFS: WindowPreferences = {
  alwaysOnTop: true,
  compactMode: false,
  showIdleRecent: true,
  includeCli: true,
  sortMode: 'duration',
  themePreference: 'system',
  opacity: 0.96,
};

function computeTotalElapsedMs(item: ConversationItem, nowMs: number): number {
  const startMs = parseTimestampMs(item.startedAt) ?? parseTimestampMs(item.lastUserInputAt);
  if (startMs === null) return 0;
  if (item.phase === 'idle') {
    const endMs = parseTimestampMs(item.lastModifiedAt);
    return endMs !== null && endMs >= startMs ? endMs - startMs : 0;
  }
  return Math.max(0, nowMs - startMs);
}

export const App: React.FC = () => {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [preferences, setPreferences] = useState<WindowPreferences>(INITIAL_PREFS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (preferences.themePreference === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', preferences.themePreference);
    }
  }, [preferences.themePreference]);

  useEffect(() => {
    let active = true;
    const api = window.stickyMonitor;

    void api
      .getPreferences()
      .then((prefs) => {
        if (active) setPreferences(prefs);
      })
      .catch((err: unknown) => {
        if (active) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to load window preferences'
          );
        }
      });

    void api
      .getSnapshot()
      .then((snap) => {
        if (active) {
          setSnapshot(snap);
          setLoadError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to read Antigravity database'
          );
        }
      });

    const unsubSnapshot = api.onSnapshot((snap) => {
      if (!active) return;
      setSnapshot(snap);
      setLoadError(null);
    });

    const unsubPrefs = api.onPreferencesChanged((prefs) => {
      if (!active) return;
      setPreferences(prefs);
    });

    return () => {
      active = false;
      unsubSnapshot();
      unsubPrefs();
    };
  }, []);

  const handleUpdatePrefs = (patch: Partial<WindowPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
    void window.stickyMonitor.updatePreferences(patch).then(
      (saved) => setPreferences(saved),
      (err: unknown) => {
        setActionError(
          err instanceof Error ? err.message : 'Could not update monitor settings'
        );
      }
    );
  };

  const handleOpenPath = async (targetPath: string) => {
    setActionError(null);
    const res = await window.stickyMonitor.openPath(targetPath);
    if (!res.ok) {
      setActionError(res.error ?? `Failed to open ${targetPath}`);
    }
  };

  const handleRevealFile = async (targetPath: string) => {
    setActionError(null);
    const res = await window.stickyMonitor.revealFile(targetPath);
    if (!res.ok) {
      setActionError(res.error ?? `Failed to reveal ${targetPath}`);
    }
  };

  const handleCopyId = async (conversationId: string) => {
    setActionError(null);
    const res = await window.stickyMonitor.copyText(conversationId);
    if (!res.ok) {
      setActionError(res.error ?? 'Failed to copy conversation ID');
    }
  };

  const sortMode = preferences.sortMode;

  const sortedRunning = useMemo(
    () => (snapshot ? sortConversations(snapshot.running, sortMode, nowMs) : []),
    [snapshot, sortMode, nowMs]
  );

  const waitingCount = useMemo(
    () => sortedRunning.filter((c) => c.phase === 'waiting_input').length,
    [sortedRunning]
  );

  const stalledCount = useMemo(
    () => sortedRunning.filter((c) => c.phase === 'stalled').length,
    [sortedRunning]
  );

  const overdueCount = useMemo(
    () => sortedRunning.filter((c) => isQuestionOverdue(c, nowMs)).length,
    [sortedRunning, nowMs]
  );

  const headerSeverity: HeaderSeverity =
    overdueCount > 0
      ? 'overdue'
      : waitingCount > 0 || stalledCount > 0
        ? 'warning'
        : sortedRunning.length > 0
          ? 'running'
          : 'idle';

  const statusSummary = useMemo(() => {
    if (sortedRunning.length === 0) return '0 active conversations';
    const notes: string[] = [];
    if (overdueCount > 0) notes.push(`${overdueCount} overdue >5m`);
    const freshWaiting = waitingCount - overdueCount;
    if (freshWaiting > 0) notes.push(`${freshWaiting} waiting input`);
    if (stalledCount > 0) notes.push(`${stalledCount} stalled`);
    return notes.length > 0
      ? `${sortedRunning.length} active (${notes.join(', ')})`
      : `${sortedRunning.length} active`;
  }, [sortedRunning.length, overdueCount, waitingCount, stalledCount]);

  const cycleSortMode = () => {
    const idx = SORT_CYCLE.indexOf(sortMode);
    const next = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length];
    handleUpdatePrefs({ sortMode: next });
  };

  const failingSources = useMemo(
    () => (snapshot ? snapshot.sources.filter((s) => !s.ok) : []),
    [snapshot]
  );

  const activeTotalMs = useMemo(
    () => sortedRunning.reduce((sum, item) => sum + computeTotalElapsedMs(item, nowMs), 0),
    [sortedRunning, nowMs]
  );

  const idleTotalMs = useMemo(
    () =>
      snapshot
        ? snapshot.recentIdle.reduce((sum, item) => sum + computeTotalElapsedMs(item, nowMs), 0)
        : 0,
    [snapshot, nowMs]
  );

  return (
    <>
      <TitleBar
        runningCount={sortedRunning.length}
        severity={headerSeverity}
        statusSummary={statusSummary}
        preferences={preferences}
        onTogglePin={() => handleUpdatePrefs({ alwaysOnTop: !preferences.alwaysOnTop })}
        onToggleCompact={() =>
          handleUpdatePrefs({ compactMode: !preferences.compactMode })
        }
        onOpenSettings={() => setSettingsOpen(true)}
        onMinimize={() => void window.stickyMonitor.minimizeWindow()}
        onHideToTray={() => void window.stickyMonitor.hideToTray()}
        onClose={() => void window.stickyMonitor.closeWindow()}
      />

      <main className="scroll-area">
        {loadError && (
          <div className="error-banner" role="alert">
            <AlertIcon />
            <div className="error-banner-body">
              <span className="error-banner-title">Monitor Read Error</span>
              <span className="error-banner-detail">{loadError}</span>
            </div>
          </div>
        )}

        {actionError && (
          <div className="error-banner" role="alert">
            <AlertIcon />
            <div className="error-banner-body">
              <span className="error-banner-title">Action Failed</span>
              <span className="error-banner-detail">{actionError}</span>
            </div>
          </div>
        )}

        {failingSources.map((src) => (
          <div key={src.source} className="error-banner" role="alert">
            <AlertIcon />
            <div className="error-banner-body">
              <span className="error-banner-title">{src.label} Unavailable</span>
              <span className="error-banner-detail">
                {src.error ?? `Unable to read ${src.dbPath}`}
              </span>
            </div>
          </div>
        ))}

        <div className="section-header">
          <span>
            Active Runs
            {sortedRunning.length > 0 ? ` · Total ${formatElapsed(activeTotalMs)}` : ''}
          </span>
          <button
            type="button"
            className="sort-btn"
            data-mode={sortMode}
            aria-label={`Sort order: ${SORT_LABELS[sortMode]}. Click to switch`}
            onClick={cycleSortMode}
          >
            <SortIcon />
            {SORT_LABELS[sortMode]}
          </button>
        </div>

        {!snapshot && !loadError ? (
          <div className="empty-state" role="status">
            <p className="empty-title">Connecting to local Antigravity state…</p>
            <p className="empty-subtitle">Reading conversation summaries.</p>
          </div>
        ) : sortedRunning.length === 0 ? (
          <div className="empty-state" role="status">
            <p className="empty-title">No conversations currently running</p>
            <p className="empty-subtitle">
              Active sessions appear here automatically as soon as a turn starts.
            </p>
          </div>
        ) : (
          <ul
            className="conv-list"
            role="list"
            data-compact={preferences.compactMode}
          >
            {sortedRunning.map((item) => (
              <ConversationRow
                key={`${item.source}:${item.conversationId}`}
                item={item}
                nowMs={nowMs}
                compact={preferences.compactMode}
                expanded={expandedId === item.conversationId}
                onToggleExpand={(id) =>
                  setExpandedId((curr) => (curr === id ? null : id))
                }
                onOpenPath={handleOpenPath}
                onRevealFile={handleRevealFile}
                onCopyId={handleCopyId}
              />
            ))}
          </ul>
        )}

        {preferences.showIdleRecent && snapshot && snapshot.recentIdle.length > 0 && (
          <>
            <div className="section-header">
              <span>Last {snapshot.recentIdle.length} Idle Runs</span>
              <span className="section-sum">Total {formatElapsed(idleTotalMs)}</span>
            </div>
            <ul
              className="conv-list"
              role="list"
              data-compact={preferences.compactMode}
            >
              {snapshot.recentIdle.map((item) => (
                <ConversationRow
                  key={`idle:${item.source}:${item.conversationId}`}
                  item={item}
                  nowMs={nowMs}
                  compact={preferences.compactMode}
                  expanded={expandedId === item.conversationId}
                  onToggleExpand={(id) =>
                    setExpandedId((curr) => (curr === id ? null : id))
                  }
                  onOpenPath={handleOpenPath}
                  onRevealFile={handleRevealFile}
                  onCopyId={handleCopyId}
                />
              ))}
            </ul>
          </>
        )}
      </main>

      <SettingsDialog
        open={settingsOpen}
        preferences={preferences}
        onUpdate={handleUpdatePrefs}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
};
