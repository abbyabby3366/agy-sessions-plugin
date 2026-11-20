import { parseTimestampMs } from './time.js';
import type { ActivityPhase, ConversationItem, SortMode, StickyMode } from './types.js';

export const QUESTION_OVERDUE_MS = 5 * 60 * 1000;

export function resolveAlwaysOnTop(
  stickyMode: StickyMode,
  runningItems: ConversationItem[],
  unreadItems: ConversationItem[] = []
): boolean {
  if (stickyMode === 'always') return true;
  if (stickyMode === 'off') return false;
  return (
    runningItems.some((item) => item.phase === 'waiting_input') ||
    unreadItems.length > 0
  );
}

export type AutoReturnAction = 'minimize' | 'hide' | null;

export interface StickyWindowState {
  isVisible: boolean;
  isMinimized: boolean;
  isFocused: boolean;
}

export interface StickyTransitionInput {
  stickyMode: StickyMode;
  prevOnTop: boolean | null;
  nextOnTop: boolean;
  prevAutoReturn: AutoReturnAction;
  windowState: StickyWindowState;
  isPreferenceChange: boolean;
}

export interface StickyTransitionEffect {
  setAlwaysOnTop: boolean | null;
  windowAction: 'none' | 'show_inactive' | 'restore_inactive' | 'move_top' | 'minimize' | 'hide';
  nextAutoReturn: AutoReturnAction;
}

export function resolveStickyTransition(input: StickyTransitionInput): StickyTransitionEffect {
  const {
    stickyMode,
    prevOnTop,
    nextOnTop,
    prevAutoReturn,
    windowState,
    isPreferenceChange,
  } = input;

  // Initial sync before any snapshot has been processed: apply always-on-top only.
  if (prevOnTop === null) {
    return {
      setAlwaysOnTop: nextOnTop,
      windowAction: 'none',
      nextAutoReturn: null,
    };
  }

  // No change in sticky state.
  if (prevOnTop === nextOnTop) {
    return {
      setAlwaysOnTop: null,
      windowAction: 'none',
      nextAutoReturn: stickyMode === 'on_question' && nextOnTop ? prevAutoReturn : null,
    };
  }

  // Preference changes (e.g. toggling Sticky Mode in Settings/Tray) should only
  // update always-on-top without unexpectedly popping or minimizing the window.
  if (isPreferenceChange || stickyMode !== 'on_question') {
    return {
      setAlwaysOnTop: nextOnTop,
      windowAction: 'none',
      nextAutoReturn: null,
    };
  }

  // Alert arrived (false -> true) under 'on_question' mode.
  // Check isMinimized before !isVisible because on Windows Electron reports
  // isVisible() === false while a window is minimized to the taskbar.
  if (nextOnTop) {
    if (windowState.isMinimized) {
      return {
        setAlwaysOnTop: true,
        windowAction: 'restore_inactive',
        nextAutoReturn: 'minimize',
      };
    }
    if (!windowState.isVisible) {
      return {
        setAlwaysOnTop: true,
        windowAction: 'show_inactive',
        nextAutoReturn: 'hide',
      };
    }
    if (!windowState.isFocused) {
      return {
        setAlwaysOnTop: true,
        windowAction: 'move_top',
        nextAutoReturn: 'minimize',
      };
    }
    return {
      setAlwaysOnTop: true,
      windowAction: 'none',
      nextAutoReturn: null,
    };
  }

  // All alerts cleared (true -> false) under 'on_question' mode.
  if (prevAutoReturn === 'hide') {
    return {
      setAlwaysOnTop: false,
      windowAction: windowState.isVisible ? 'hide' : 'none',
      nextAutoReturn: null,
    };
  }
  if (prevAutoReturn === 'minimize') {
    return {
      setAlwaysOnTop: false,
      windowAction: windowState.isVisible && !windowState.isMinimized ? 'minimize' : 'none',
      nextAutoReturn: null,
    };
  }
  return {
    setAlwaysOnTop: false,
    windowAction: 'none',
    nextAutoReturn: null,
  };
}

export function getQuestionWaitMs(item: ConversationItem, nowMs: number): number | null {
  if (item.phase !== 'waiting_input') return null;
  const sinceMs =
    parseTimestampMs(item.waitingSinceAt) ??
    parseTimestampMs(item.lastModifiedAt) ??
    parseTimestampMs(item.lastUserInputAt);
  if (sinceMs === null) return null;
  return Math.max(0, nowMs - sinceMs);
}

export function isQuestionOverdue(item: ConversationItem, nowMs: number): boolean {
  const waitMs = getQuestionWaitMs(item, nowMs);
  return waitMs !== null && waitMs > QUESTION_OVERDUE_MS;
}

const ACTION_PRIORITY: Record<ActivityPhase, number> = {
  waiting_input: 1,
  stalled: 2,
  running: 3,
  idle: 4,
};

function getActionRank(item: ConversationItem, nowMs: number): number {
  if (isQuestionOverdue(item, nowMs)) return 0;
  return ACTION_PRIORITY[item.phase];
}

export function sortConversations(
  items: ConversationItem[],
  mode: SortMode,
  nowMs: number
): ConversationItem[] {
  return [...items].sort((a, b) => {
    // Unanswered questions always stay first regardless of selected sort mode,
    // ordered by longest waiting time (overdue >5m naturally rises to the top).
    const aIsQuestion = a.phase === 'waiting_input';
    const bIsQuestion = b.phase === 'waiting_input';
    if (aIsQuestion !== bIsQuestion) {
      return aIsQuestion ? -1 : 1;
    }
    if (aIsQuestion && bIsQuestion) {
      const aWait = getQuestionWaitMs(a, nowMs) ?? 0;
      const bWait = getQuestionWaitMs(b, nowMs) ?? 0;
      if (aWait !== bWait) return bWait - aWait;
    }

    if (mode === 'action_needed') {
      const rankDiff = getActionRank(a, nowMs) - getActionRank(b, nowMs);
      if (rankDiff !== 0) return rankDiff;

      const aStart =
        parseTimestampMs(a.lastUserInputAt) ??
        parseTimestampMs(a.startedAt) ??
        Number.MAX_SAFE_INTEGER;
      const bStart =
        parseTimestampMs(b.lastUserInputAt) ??
        parseTimestampMs(b.startedAt) ??
        Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
    }

    if (mode === 'duration') {
      const aStart =
        parseTimestampMs(a.lastUserInputAt) ??
        parseTimestampMs(a.startedAt) ??
        Number.MAX_SAFE_INTEGER;
      const bStart =
        parseTimestampMs(b.lastUserInputAt) ??
        parseTimestampMs(b.startedAt) ??
        Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
    }

    const aMod = parseTimestampMs(a.lastModifiedAt) ?? 0;
    const bMod = parseTimestampMs(b.lastModifiedAt) ?? 0;
    return bMod - aMod;
  });
}
