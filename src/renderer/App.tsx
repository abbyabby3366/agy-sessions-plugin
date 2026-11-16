import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isQuestionOverdue, sortConversations } from '../shared/status.js';
import type {
  MonitorSnapshot,
  WindowPreferences,
} from '../shared/types.js';
import { ConversationRow } from './components/ConversationRow.js';
import { AlertIcon, ChevronRightIcon } from './components/Icons.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { TitleBar, type HeaderSeverity } from './components/TitleBar.js';

const INITIAL_PREFS: WindowPreferences = {
  stickyMode: 'on_question',
  compactMode: false,
  showIdleRecent: true,
  idleExpanded: false,
  includeCli: true,
  sortMode: 'action_needed',
  themePreference: 'system',
  opacity: 0.96,
};

export const App: React.FC = () => {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [preferences, setPreferences] = useState<WindowPreferences>(INITIAL_PREFS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const contentRef = useRef<HTMLDivElement | null>(null);

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

  const failingSources = useMemo(
    () => (snapshot ? snapshot.sources.filter((s) => !s.ok) : []),
    [snapshot]
  );

  useLayoutEffect(() => {
    const syncHeight = () => {
      const contentEl = contentRef.current;
      if (!contentEl) return;
      const titlebarEl = document.querySelector('.titlebar');
      const titlebarHeight =
        titlebarEl instanceof HTMLElement ? titlebarEl.offsetHeight : 38;
      const naturalHeight = titlebarHeight + contentEl.offsetHeight + 2;
      const desired = settingsOpen ? Math.max(naturalHeight, 440) : naturalHeight;
      void window.stickyMonitor.setContentHeight(desired);
    };

    syncHeight();

    const contentEl = contentRef.current;
    if (!contentEl) return;
    const observer = new ResizeObserver(() => {
      syncHeight();
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [
    settingsOpen,
    preferences.compactMode,
    preferences.showIdleRecent,
    preferences.idleExpanded,
    sortedRunning.length,
    snapshot?.recentIdle.length,
    expandedId,
    loadError,
    actionError,
    failingSources.length,
  ]);

  return (
    <>
      <TitleBar
        runningCount={sortedRunning.length}
        severity={headerSeverity}
        statusSummary={statusSummary}
        onOpenSettings={() => setSettingsOpen(true)}
        onMinimize={() => void window.stickyMonitor.minimizeWindow()}
        onClose={() => void window.stickyMonitor.closeWindow()}
      />

      <main className="scroll-area">
        <div ref={contentRef} className="scroll-content">
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
          <span>Active Runs</span>
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
            <button
              type="button"
              className="section-toggle"
              aria-expanded={preferences.idleExpanded}
              onClick={() =>
                handleUpdatePrefs({ idleExpanded: !preferences.idleExpanded })
              }
            >
              <span className="section-toggle-label">
                <ChevronRightIcon className="section-chevron" />
                <span>Last {snapshot.recentIdle.length} Idle Runs</span>
              </span>
            </button>

            {preferences.idleExpanded && (
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
            )}
          </>
        )}
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        preferences={preferences}
        onUpdate={handleUpdatePrefs}
        onHideToTray={() => void window.stickyMonitor.hideToTray()}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
};
