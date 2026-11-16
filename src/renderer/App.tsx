import React, { useEffect, useMemo, useState } from 'react';
import { formatDateTimeGMT8, parseTimestampMs } from '../shared/time.js';
import type {
  ConversationItem,
  MonitorSnapshot,
  WindowPreferences,
} from '../shared/types.js';
import { ConversationRow } from './components/ConversationRow.js';
import { AlertIcon, SortIcon } from './components/Icons.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { TitleBar } from './components/TitleBar.js';

type SortMode = 'duration' | 'activity';

const INITIAL_PREFS: WindowPreferences = {
  alwaysOnTop: true,
  compactMode: false,
  showIdleRecent: false,
  includeCli: true,
  themePreference: 'system',
  opacity: 0.96,
};

function sortConversations(items: ConversationItem[], mode: SortMode): ConversationItem[] {
  return [...items].sort((a, b) => {
    if (mode === 'duration') {
      const aStart = parseTimestampMs(a.lastUserInputAt) ?? Number.MAX_SAFE_INTEGER;
      const bStart = parseTimestampMs(b.lastUserInputAt) ?? Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
    }
    const aMod = parseTimestampMs(a.lastModifiedAt) ?? 0;
    const bMod = parseTimestampMs(b.lastModifiedAt) ?? 0;
    return bMod - aMod;
  });
}

export const App: React.FC = () => {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [preferences, setPreferences] = useState<WindowPreferences>(INITIAL_PREFS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('duration');
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

  const sortedRunning = useMemo(
    () => (snapshot ? sortConversations(snapshot.running, sortMode) : []),
    [snapshot, sortMode]
  );

  const waitingCount = useMemo(
    () => sortedRunning.filter((c) => c.phase === 'waiting_input').length,
    [sortedRunning]
  );

  const failingSources = useMemo(
    () => (snapshot ? snapshot.sources.filter((s) => !s.ok) : []),
    [snapshot]
  );

  const capturedGmt8 = snapshot ? formatDateTimeGMT8(snapshot.capturedAt) : null;

  return (
    <>
      <TitleBar
        runningCount={sortedRunning.length}
        waitingCount={waitingCount}
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
          <span>Active Runs</span>
          <button
            type="button"
            className="sort-btn"
            aria-label={`Sort order: ${sortMode === 'duration' ? 'Longest running' : 'Latest step'}`}
            onClick={() =>
              setSortMode((m) => (m === 'duration' ? 'activity' : 'duration'))
            }
          >
            <SortIcon />
            {sortMode === 'duration' ? 'Longest first' : 'Recent step'}
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
              <span>Recently Finished (30m)</span>
              <span>{snapshot.recentIdle.length}</span>
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

      <footer className="footer-strip">
        <span>Auto-sync active</span>
        <span className="footer-tz">
          {capturedGmt8
            ? `${capturedGmt8.date} · ${capturedGmt8.time} GMT+8`
            : 'Waiting…'}
        </span>
      </footer>

      <SettingsDialog
        open={settingsOpen}
        preferences={preferences}
        onUpdate={handleUpdatePrefs}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
};
